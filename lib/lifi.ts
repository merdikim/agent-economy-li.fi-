import {
  EVM,
  createConfig,
  executeRoute as lifiExecuteRoute,
  getQuote as lifiGetQuote,
  type Route,
  type RouteExtended,
  QuoteRequest,
  LiFiStep,
} from '@lifi/sdk';
import { parseUnits, type Address, type WalletClient } from 'viem';
import { CHAINS, chainKeyToId } from './chains.js';
import type { ChainKey } from './types.js';

const evmProvider = EVM({
  getWalletClient: async () => {
    throw new Error('EVM provider is not configured with a wallet client');
  },
});

createConfig({
  integrator: 'agent-economy',
  providers: [evmProvider],
});

function normalizeAmount(amount: string | number | bigint): string {
  if (typeof amount === 'bigint') {
    return amount.toString();
  }
  if (typeof amount === 'number') {
    return parseUnits(amount.toString(), 6).toString();
  }
  return amount;
}

function summarizeRoute(step: LiFiStep): { step: LiFiStep; estimatedOutputUsd: number | null; estimatedCosts: number } {
  const toAmount = step.estimate.toAmountUSD ?? null;
  const gasUsd = step.estimate.gasCosts ?? null;
  const gasCostUsd = Array.isArray(gasUsd) ? gasUsd.reduce((sum, cost) => sum + Number(cost.amountUSD), 0) : Number(gasUsd);
  const feeUsd = step.estimate.feeCosts ?? null;
  const feeCostUsd = Array.isArray(feeUsd) ? feeUsd.reduce((sum, cost) => sum + Number(cost.amountUSD), 0) : Number(feeUsd);

  return {
    step,
    estimatedOutputUsd: toAmount ? Number(toAmount) : null,
    estimatedCosts: gasCostUsd + feeCostUsd
  };
}

export async function getQuote(
  fromChain: ChainKey,
  toChain: ChainKey,
  amount: string | number | bigint,
  fromAddress: Address,
): Promise<{ step: LiFiStep; estimatedOutputUsd: number | null; estimatedCosts: number }> {
  const fromCfg = CHAINS[fromChain];
  const toCfg = CHAINS[toChain];

  const request:QuoteRequest = {
    fromChain: chainKeyToId(fromChain),
    toChain: chainKeyToId(toChain),
    fromAddress: fromAddress,
    fromAmount: normalizeAmount(amount),
    fromToken: fromCfg.usdc,
    toToken: toCfg.usdc,
  };

  try {
    const quote = await lifiGetQuote(request);
    return summarizeRoute(quote);
  } catch(err) {
    console.log(err)
    throw new Error('Failed to get quote from LI.FI')
  }
}

export async function executeRoute(route: Route | LiFiStep, walletClient: WalletClient): Promise<string> {
  evmProvider.setOptions({
    getWalletClient: async () => walletClient,
    switchChain: async (chainId: number) => {
      if (walletClient.chain?.id === chainId) {
        return walletClient;
      }
      throw new Error(
        `LI.FI requested chain switch to ${chainId}, but this executor only has chain ${walletClient.chain?.id}.`,
      );
    },
  });

  const execution = await lifiExecuteRoute(route as Route, {
    updateRouteHook: () => {},
    acceptExchangeRateUpdateHook: async () => true,
  });

  const txHash = (execution as RouteExtended).steps
    ?.flatMap((s) => s.execution?.process || [])
    ?.find((p) => p.txHash)?.txHash;

  if (!txHash) {
    throw new Error('LI.FI execution finished without a transaction hash');
  }

  return txHash;
}
