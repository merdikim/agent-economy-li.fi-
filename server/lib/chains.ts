import type { Chain } from 'viem';
import { arbitrum, base, optimism } from 'viem/chains';
import type { ChainKey } from './types.js';

export interface ChainConfig {
  key: ChainKey;
  chainId: number;
  chain: Chain;
  rpcEnv: string;
  aavePool: `0x${string}`;
  usdc: `0x${string}`;
}

export const CHAINS: Record<ChainKey, ChainConfig> = {
  optimism: {
    key: 'optimism',
    chainId: 10,
    chain: optimism,
    rpcEnv: 'OPTIMISM_RPC_URL',
    aavePool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
    usdc: '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
  },
  base: {
    key: 'base',
    chainId: 8453,
    chain: base,
    rpcEnv: 'BASE_RPC_URL',
    aavePool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
  arbitrum: {
    key: 'arbitrum',
    chainId: 42161,
    chain: arbitrum,
    rpcEnv: 'ARBITRUM_RPC_URL',
    aavePool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  },
};

export const CHAIN_KEYS: ChainKey[] = Object.keys(CHAINS) as ChainKey[];

export function chainKeyToId(chainKey: ChainKey): number {
  return CHAINS[chainKey].chainId;
}

export function chainIdToKey(chainId: number): ChainKey | undefined {
  return CHAIN_KEYS.find((key) => CHAINS[key].chainId === Number(chainId));
}
