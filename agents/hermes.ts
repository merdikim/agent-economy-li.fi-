import { makeClaudeAgent } from '../lib/groq.js';
import { jobBoard } from '../lib/jobBoard.js';
import { getQuote, executeRoute } from '../lib/lifi.js';
import { CHAINS } from '../lib/chains.js';
import { getUsdcBalance, transferUsdc } from '../lib/wallet.js';
import type { AgentContext, JobOffer, JobResult } from '../lib/types.js';

const HERMES_PROMPT = "You are HERMES, a neutral bridge execution agent. You hold the LI.FI SDK and execute cross-chain USDC bridges on behalf of whoever pays the highest fee. You have no yield motive. When an auction completes, narrate the result in 1-2 sentences: who won, what they bid, and what route you are executing. Be terse and professional.";

export function startHermes(ctx: AgentContext) {
  const { stateManager, chainClients, walletContext, broadcast, isPaused } = ctx;
  const claude = makeClaudeAgent(HERMES_PROMPT);

  let auctionTimer: NodeJS.Timeout | null = null;
  let auctionBids: JobOffer[] = [];

  async function settleAuction(): Promise<void> {
    const bids = [...auctionBids];
    auctionBids = [];
    auctionTimer = null;

    if (!bids.length || isPaused()) return;

    await stateManager.update(async (state) => {
      state.agents.hermes.auctionsRun += 1;
    });

    const sorted = bids.sort((a, b) => {
      if (b.fee !== a.fee) return b.fee - a.fee;
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    });

    const winner = sorted[0];
    const loser = sorted[1]?.from || null;

    let narration = '';
    try {
      const ai = await claude.ask(
        `Auction bids:\n${JSON.stringify(
          sorted.map((b) => ({ from: b.from, fee: b.fee, fromChain: b.fromChain, targetChain: b.targetChain })),
          null,
          2,
        )}`,
      );
      narration = ai.text;
    } catch (error) {
      narration = `Highest fee winner is ${winner.from} with ${winner.fee} USDC.`;
      broadcast({
        type: 'log',
        agent: 'hermes',
        message: `Claude narration failed: ${(error as Error).message}`,
        state: stateManager.get(),
      });
    }

    broadcast({
      type: 'auction',
      agent: 'hermes',
      message: narration,
      state: stateManager.get(),
    });

    const winnerWallet = walletContext.agents[winner.from];
    const fromCfg = CHAINS[winner.fromChain];
    if (!winnerWallet || !fromCfg) {
      const result: JobResult = {
        status: 'rejected',
        winner: winner.from,
        loser,
        reason: 'Invalid winner wallet or source chain',
        feePaid: 0,
        amount: winner.amount,
        sourceChain: winner.fromChain,
        targetChain: winner.targetChain,
        timestamp: new Date().toISOString(),
      };
      jobBoard.completeJob(result);
      return;
    }

    try {
      const balance = await getUsdcBalance({
        publicClient: chainClients[winner.fromChain].publicClient,
        owner: winnerWallet.address,
        usdc: fromCfg.usdc,
      });

      const required = winner.amount + winner.fee;
      if (balance.formatted < required) {
        const reason = `Insufficient balance for ${winner.from}. Need ${required.toFixed(6)} USDC, have ${balance.formatted.toFixed(6)}.`;
        broadcast({ type: 'log', agent: 'hermes', message: reason, state: stateManager.get() });

        const result: JobResult = {
          status: 'rejected',
          winner: winner.from,
          loser,
          reason,
          feePaid: 0,
          amount: winner.amount,
          sourceChain: winner.fromChain,
          targetChain: winner.targetChain,
          timestamp: new Date().toISOString(),
          winnerReasoning: winner.reasoning,
          loserReasoning: sorted[1]?.reasoning || null,
        };

        await stateManager.update(async (state) => {
          state.history.push(result);
        });

        jobBoard.completeJob(result);
        return;
      }

      const quote = await getQuote(winner.fromChain, winner.targetChain, winner.amountRaw, winnerWallet.address);
      const txHash = await executeRoute(quote.route, winnerWallet.walletsByChain[winner.fromChain]);

      await transferUsdc({
        walletClient: winnerWallet.walletsByChain[winner.fromChain],
        usdc: fromCfg.usdc,
        to: walletContext.agents.hermes.address,
        amountRaw: BigInt(winner.feeRaw),
      });

      const result: JobResult = {
        status: 'success',
        winner: winner.from,
        loser,
        feePaid: winner.fee,
        amount: winner.amount,
        sourceChain: winner.fromChain,
        targetChain: winner.targetChain,
        txHash,
        timestamp: new Date().toISOString(),
        winnerReasoning: winner.reasoning,
        loserReasoning: sorted[1]?.reasoning || null,
      };

      await stateManager.update(async (state) => {
        state.agents.hermes.jobsExecuted += 1;
        state.agents.hermes.feesEarned += winner.fee;
        state.agents.hermes.balance += winner.fee;
        state.history.push(result);
      });

      broadcast({
        type: 'execution',
        agent: 'hermes',
        message: `Executed ${winner.from} route ${winner.fromChain} -> ${winner.targetChain}. tx=${txHash}`,
        state: stateManager.get(),
      });

      jobBoard.completeJob(result);
    } catch (error) {
      const result: JobResult = {
        status: 'failed',
        winner: winner.from,
        loser,
        reason: (error as Error).message,
        feePaid: 0,
        amount: winner.amount,
        sourceChain: winner.fromChain,
        targetChain: winner.targetChain,
        timestamp: new Date().toISOString(),
        winnerReasoning: winner.reasoning,
        loserReasoning: sorted[1]?.reasoning || null,
      };

      await stateManager.update(async (state) => {
        state.history.push(result);
      });

      broadcast({
        type: 'execution',
        agent: 'hermes',
        message: `Execution failed for ${winner.from}: ${(error as Error).message}`,
        state: stateManager.get(),
      });

      jobBoard.completeJob(result);
    }
  }

  jobBoard.on('job', (offer) => {
    if (isPaused()) return;

    auctionBids.push(offer);
    broadcast({
      type: 'auction',
      agent: 'hermes',
      message: `Bid received from ${offer.from}: ${offer.fee.toFixed(6)} USDC for ${offer.fromChain} -> ${offer.targetChain}.`,
      state: stateManager.get(),
    });

    if (!auctionTimer) {
      auctionTimer = setTimeout(() => {
        void settleAuction();
      }, 10_000);
    }
  });

  return {
    claude,
  };
}
