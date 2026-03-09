import {
  EVM,
  createConfig,
  executeRoute as lifiExecuteRoute,
  getRoutes as lifiGetRoutes,
  type Route,
  type RouteExtended,
  RoutesRequest,
} from '@lifi/sdk';
import { parseUnits, type WalletClient } from 'viem';
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

function summarizeRoute(route: Route): { route: Route; estimatedOutputUsd: number; estimatedCosts: number } {
  const estimatedOutputUsd = Number(route.toAmountUSD ?? 0);
  const estimatedGasCostUsd = Number(route.gasCostUSD ?? 0);
  const lifiFeeUsdArray = route.steps?.flatMap((s) => s.estimate.feeCosts ?? []);
  const lifiFeeUsdSum = lifiFeeUsdArray.reduce((sum, cost) => sum + Number(cost.amountUSD), 0);
  const estimatedCosts = estimatedGasCostUsd + lifiFeeUsdSum;

  return {
    route,
    estimatedOutputUsd,
    estimatedCosts
  };
}

export async function getRoute(
  fromChain: ChainKey,
  toChain: ChainKey,
  amount: string | number | bigint,
): Promise<{ route: Route; estimatedOutputUsd: number; estimatedCosts: number }> {
  const fromCfg = CHAINS[fromChain];
  const toCfg = CHAINS[toChain];

  const request: RoutesRequest = {
    fromChainId: chainKeyToId(fromChain),
    toChainId:  chainKeyToId(toChain),
    fromAmount: normalizeAmount(amount),
    fromTokenAddress: fromCfg.usdc,
    toTokenAddress: toCfg.usdc,
    toAddress: toCfg.aavePool
  };

  try {
    const { routes } = await lifiGetRoutes(request);
    if (!routes || routes.length === 0) {
      throw new Error('No routes found');
    }

    return summarizeRoute(routes[0]);
  } catch(err) {
    console.log(err)
    throw new Error('Failed to get route from LI.FI')
  }
}

export async function executeRoute(route: Route, walletClient: WalletClient): Promise<string> {
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
