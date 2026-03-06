import { CHAINS, CHAIN_KEYS } from './chains.js';
import type { ChainKey } from './types.js';
import type { ChainClients } from './wallet.js';
import Pool from '@aave/core-v3/artifacts/contracts/protocol/pool/Pool.sol/Pool.json' with { type: 'json' };

let cache: {
  ts: number;
  rates: Record<ChainKey, number> | null;
} = {
  ts: 0,
  rates: null,
};

function rayToApy(currentLiquidityRate: bigint): number {
  const seconds = 31536000; // number of seconds in a year
  const rate = Number(currentLiquidityRate) / 1e27; // Aave's liquidity rates are in RAY (1e27), so we convert to a standard decimal
  return Math.pow(1 + rate / seconds, seconds) - 1; // Convert to APY
}

export async function getRates(chainClients: ChainClients): Promise<Record<ChainKey, number>> {
  const now = Date.now();
  if (cache.rates && now - cache.ts < 30_000) {
    return cache.rates;
  }

  const entries = await Promise.all(
    CHAIN_KEYS.map(async (chainKey) => {
      const cfg = CHAINS[chainKey];
      const client = chainClients[chainKey].publicClient;
      const reserve = await client.readContract({
        address: cfg.aavePool,
        abi: Pool.abi,
        functionName: 'getReserveData',
        args: [cfg.usdc],
      });
      //@ts-ignore
      const currentLiquidityRate = reserve.currentLiquidityRate;
      return [chainKey, rayToApy(currentLiquidityRate)] as const;
    }),
  );

  cache = {
    ts: now,
    rates: Object.fromEntries(entries) as Record<ChainKey, number>,
  };

  //@ts-ignore 
  return cache.rates;
}
