import { parseUnits } from 'viem';
import { Agent, extractJsonBlock } from '../lib/groq.js';
import { getRates } from '../lib/aave.js';
import { getRoute } from '../lib/lifi.js';
import { jobBoard } from '../lib/jobBoard.js';
import { CHAIN_KEYS } from '../lib/chains.js';
import type { AgentContext, DecisionOutput } from '../lib/types.js';

const GAMMA_PROMPT = "You are GAMMA, a disciplined AI yield optimizer managing a real USDC wallet across Ethereum L2s. You monitor Aave V3 lending rates on Optimism, Base, and Arbitrum. Your mandate is to maximize risk-adjusted yield. You only bridge when the APY spread exceeds your cost of bridging (Zebra fee + gas). You never overbid. Calculate explicitly: expected yield gain over 24h minus total bridge cost. Only move if the number is positive and material. Output your reasoning in 2-3 sentences, then output a JSON block: `{ shouldBridge: bool, targetChain: string, bidFee: number, reasoning: string }`.";

export function startGamma(ctx: AgentContext) {
  const { stateManager, chainClients, walletContext, broadcast, isPaused } = ctx;
  const gammaAgent = new Agent(GAMMA_PROMPT);

  let lastYieldAt = Date.now();

  async function tick(): Promise<void> {
    if (isPaused()) return;

    const now = Date.now();
    try {
      const rates = await getRates(chainClients);

      await stateManager.update(async (state) => {
        const gammaState = state.agents.gamma;
        if (gammaState.currentChain && gammaState.deployedAmount > 0) {
          const dt = (now - lastYieldAt) / 1000;
          const chainRate = rates[gammaState.currentChain] || 0;
          const gain = gammaState.deployedAmount * chainRate * (dt / 31536000);
          gammaState.yieldEarned += gain;
          gammaState.balance += gain;
        }

        state.cycle += 1;
        state.rates = rates;
      });
      lastYieldAt = now;

      broadcast({
        type: 'state',
        agent: 'system',
        message: 'Rates updated',
        state: stateManager.get(),
      });

      const s = stateManager.get();
      const gamma = s.agents.gamma;
      const current = gamma.currentChain;
      const bestChain = CHAIN_KEYS.reduce((acc, key) => (s.rates[key] > s.rates[acc] ? key : acc), 'optimism');

      if (!current) {
        await stateManager.update(async (state) => {
          state.agents.gamma.currentChain = bestChain;
          state.agents.gamma.deployedAmount = state.agents.gamma.balance;
        });
        broadcast({
          type: 'log',
          agent: 'gamma',
          message: `Initial deployment set to ${bestChain}.`,
          state: stateManager.get(),
        });
        return;
      }

      const spread = (s.rates[bestChain] || 0) - (s.rates[current] || 0);
      const spreadBps = spread * 10000;
      if (spreadBps < 50 || bestChain === current) {
        broadcast({
          type: 'log',
          agent: 'gamma',
          message: `No action. Spread ${spreadBps.toFixed(2)} basis points is below threshold.`,
          state: stateManager.get(),
        });
        return;
      }

      const amount = Number(gamma.deployedAmount || gamma.balance);
      if (!amount || amount <= 0) {
        broadcast({
          type: 'log',
          agent: 'gamma',
          message: 'No deployable USDC available; skipping bid.',
          state: stateManager.get(),
        });
        return;
      }

      let route;
      try {
        route = await getRoute(current, bestChain, amount.toFixed(6), walletContext.agents.gamma.address);
      } catch (error) {
        broadcast({
          type: 'log',
          agent: 'gamma',
          message: `Quote failed: ${(error as Error).message}`,
          state: stateManager.get(),
        });
        return;
      }

      const expectedGain24h = (amount * spread) / 365;

      const prompt = [
        `Current chain: ${current}`,
        `Current deployed amount (USDC): ${amount.toFixed(6)}`,
        `P&L: ${JSON.stringify(gamma)}`,
        `Rates: ${JSON.stringify(s.rates)}`,
        `Target chain candidate: ${bestChain}`,
        `Spread bps: ${spreadBps.toFixed(2)}`,
        `Estimated bridge gas USD (approx USDC): ${Number(route.estimatedCosts || 0).toFixed(6)}`,
        `Expected 24h yield gain (USDC): ${expectedGain24h.toFixed(6)}`,
        'Output required JSON fields exactly.',
      ].join('\n');

      const agentResponse = await gammaAgent.ask(prompt);
      const parsed = extractJsonBlock<DecisionOutput>(agentResponse);

      if (!parsed.shouldBridge) {
        broadcast({
          type: 'log',
          agent: 'gamma',
          message: parsed.reasoning || 'Gamma declined to bridge.',
          state: stateManager.get(),
        });
        return;
      }

      const requestedFee = Math.max(0, Number(parsed.bidFee || 0));
      const net24h = expectedGain24h - Number(route.estimatedCosts || 0) - requestedFee;
      if (net24h <= 0) {
        broadcast({
          type: 'log',
          agent: 'gamma',
          message: `Declined by policy. Net 24h gain ${net24h.toFixed(6)} <= 0 after costs.`,
          state: stateManager.get(),
        });
        return;
      }

      if (requestedFee >= gamma.balance) {
        broadcast({
          type: 'log',
          agent: 'gamma',
          message: 'Fee would exceed available balance. Skipping bridge offer.',
          state: stateManager.get(),
        });
        return;
      }

      const offer = {
        from: 'gamma' as const,
        fromChain: current,
        targetChain: parsed.targetChain || bestChain,
        amount,
        amountRaw: parseUnits(amount.toFixed(6), 6).toString(),
        timestamp: new Date().toISOString(),
        reasoning: parsed.reasoning
      };

      jobBoard.postJob(offer);
      broadcast({
        type: 'log',
        agent: 'gamma',
        message: `Posted bridge bid for ${current} -> ${offer.targetChain}.`,
        state: stateManager.get(),
      });
    } catch (error) {
      broadcast({
        type: 'log',
        agent: 'gamma',
        message: `Cycle failed: ${(error as Error).message}`,
        state: stateManager.get(),
      });
    }
  }

  jobBoard.on('jobComplete', async (result) => {
    if (result?.winner !== 'gamma') return;

    await stateManager.update(async (state) => {
      if (result.status === 'success') {
        state.agents.gamma.currentChain = result.targetChain;
        state.agents.gamma.feesPaid += result.feePaid || 0;
        state.agents.gamma.balance -= result.feePaid || 0;
        state.agents.gamma.deployedAmount = result.amount || state.agents.gamma.deployedAmount;
      }
    });

    broadcast({
      type: 'execution',
      agent: 'gamma',
      message: `Execution ${result.status}. ${result.txHash ? `tx=${result.txHash}` : ''}`,
      state: stateManager.get(),
    });
  });

  setTimeout(() => {
    void tick();
    setInterval(tick, 30_000);
  }, 15_000);

  return {
    gammaAgent,
  };
}
