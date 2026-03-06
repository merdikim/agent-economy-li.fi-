import { parseUnits } from 'viem';
import { Agent, extractJsonBlock } from '../lib/groq.js';
import { getRates } from '../lib/aave.js';
import { jobBoard } from '../lib/jobBoard.js';
import { CHAIN_KEYS } from '../lib/chains.js';
import type { AgentContext, DecisionOutput } from '../lib/types.js';

const ALPHA_PROMPT = "You are ALPHA, an aggressive AI yield optimizer managing a real USDC wallet across Ethereum L2s. You monitor Aave V3 lending rates on Optimism, Base, and Arbitrum. Your mandate is to maximize yield at all costs. You bid aggressively on Hermes auctions because losing a bridge to Bravo while better rates sit uncaptured is unacceptable. When you decide to move, commit fully and bid high enough to win. Be direct and decisive. Output your reasoning in 2-3 sentences, then output a JSON block: `{ shouldBridge: bool, targetChain: string, bidFee: number, reasoning: string }`.";

export function startAlpha(ctx: AgentContext) {
  const { stateManager, chainClients, broadcast, isPaused } = ctx;
  const alphaAgent = new Agent(ALPHA_PROMPT);

  let lastYieldAt = Date.now();

  async function tick(): Promise<void> {
    if (isPaused()) return;

    const now = Date.now();
    try {
      const rates = await getRates(chainClients);

      await stateManager.update(async (state) => {
        const alphaState = state.agents.alpha;
        if (alphaState.currentChain && alphaState.deployedAmount > 0) {
          const dt = (now - lastYieldAt) / 1000; // time delta in seconds
          const chainRate = rates[alphaState.currentChain] || 0;
          const gain = alphaState.deployedAmount * chainRate * (dt / 31536000); // pro-rata gain based on time elapsed
          alphaState.yieldEarned += gain;
          alphaState.balance += gain;
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
      const alpha = s.agents.alpha;
      const current = alpha.currentChain;
      const bestChain = CHAIN_KEYS.reduce((acc, key) => (s.rates[key] > s.rates[acc] ? key : acc), 'optimism');

      if (!current) {
        await stateManager.update(async (state) => {
          state.agents.alpha.currentChain = bestChain;
          state.agents.alpha.deployedAmount = state.agents.alpha.balance;
        });
        broadcast({
          type: 'log',
          agent: 'alpha',
          message: `Initial deployment set to ${bestChain}.`,
          state: stateManager.get(),
        });
        return;
      }

      const spread = (s.rates[bestChain] || 0) - (s.rates[current] || 0);
      if (spread <= 0 || bestChain === current) {
        broadcast({
          type: 'log',
          agent: 'alpha',
          message: `Holding on ${current}. Best spread is ${(spread * 10000).toFixed(2)} bps.`, // Log the spread in basis points for better readability
          state: stateManager.get(),
        });
        return;
      }

      const prompt = [
        `Current chain: ${current}`,
        `Current deployed amount (USDC): ${alpha.deployedAmount.toFixed(6)}`,
        `P&L: ${JSON.stringify(alpha)}`,
        `Rates: ${JSON.stringify(s.rates)}`,
        `Candidate target chain: ${bestChain}`,
        'Decide whether to bridge now.',
      ].join('\n');

      const agentResponse = await alphaAgent.ask(prompt);
      const parsed = extractJsonBlock<DecisionOutput>(agentResponse);

      if (!parsed.shouldBridge) {
        broadcast({
          type: 'log',
          agent: 'alpha',
          message: parsed.reasoning || 'Alpha agent declined to bridge.',
          state: stateManager.get(),
        });
        return;
      }

      const amount = Number(alpha.deployedAmount || alpha.balance);
      if (!amount || amount <= 0) {
        broadcast({
          type: 'log',
          agent: 'alpha',
          message: 'No deployable USDC available; skipping bid.',
          state: stateManager.get(),
        });
        return;
      }

      const expectedGain24h = (amount * spread) / 365; // Expected gain over 24 hours
      const spreadBps = spread * 10000;
      const aggressiveness = Math.min(0.9, Math.max(0.1, spreadBps * 0.004));
      const fee = Number((expectedGain24h * aggressiveness).toFixed(6));

      if (fee >= alpha.balance) {
        broadcast({
          type: 'log',
          agent: 'alpha',
          message: 'Fee would exceed available balance. Skipping bridge offer.',
          state: stateManager.get(),
        });
        return;
      }

      const offer = {
        from: 'alpha' as const,
        fromChain: current,
        targetChain: parsed.targetChain || bestChain,
        amount,
        amountRaw: parseUnits(amount.toFixed(6), 6).toString(),
        fee,
        feeRaw: parseUnits(fee.toFixed(6), 6).toString(),
        timestamp: new Date().toISOString(),
        reasoning: parsed.reasoning,
      };

      jobBoard.postJob(offer);
      broadcast({
        type: 'log',
        agent: 'alpha',
        message: `Posted bridge bid ${fee.toFixed(6)} USDC for ${current} -> ${offer.targetChain}.`,
        state: stateManager.get(),
      });
    } catch (error) {
      broadcast({
        type: 'log',
        agent: 'alpha',
        message: `Cycle failed: ${(error as Error).message}`,
        state: stateManager.get(),
      });
    }
  }

  jobBoard.on('jobComplete', async (result) => {
    if (result?.winner !== 'alpha') return;

    await stateManager.update(async (state) => {
      if (result.status === 'success') {
        state.agents.alpha.currentChain = result.targetChain;
        state.agents.alpha.feesPaid += result.feePaid || 0;
        state.agents.alpha.balance -= result.feePaid || 0;
        state.agents.alpha.deployedAmount = result.amount || state.agents.alpha.deployedAmount;
      }
    });

    broadcast({
      type: 'execution',
      agent: 'alpha',
      message: `Execution ${result.status}. ${result.txHash ? `tx=${result.txHash}` : ''}`,
      state: stateManager.get(),
    });
  });

  setInterval(tick, 30_000); // Run every 30 seconds
  void tick();

  return {
    alphaAgent
  };
}
