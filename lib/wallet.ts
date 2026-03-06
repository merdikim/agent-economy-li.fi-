import { createPublicClient, createWalletClient, formatUnits, http, type Address, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { CHAINS } from './chains.js';
import type { AgentName, ChainKey } from './types.js';
import { erc20Abi } from "viem";

interface ChainClientsEntry {
  publicClient: PublicClient;
  rpcUrl: string;
}

export type ChainClients = Record<ChainKey, ChainClientsEntry>;

export interface AgentWallet {
  account: ReturnType<typeof privateKeyToAccount>;
  address: Address;
  walletsByChain: Record<ChainKey, WalletClient>;
}

export interface WalletContext {
  agents: Record<AgentName, AgentWallet>;
  chainClients: ChainClients;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function normalizePk(pk: string): `0x${string}` {
  return (pk.startsWith('0x') ? pk : `0x${pk}`) as `0x${string}`;
}

export function buildClients(): ChainClients {
  const byChain = {} as ChainClients;
  for (const chainCfg of Object.values(CHAINS)) {
    const rpcUrl = requireEnv(chainCfg.rpcEnv);
    byChain[chainCfg.key] = {
      publicClient: createPublicClient({
        chain: chainCfg.chain,
        transport: http(rpcUrl),
      }),
      rpcUrl,
    };
  }
  return byChain;
}

export function initWallets(): WalletContext {
  const chainClients = buildClients();

  const agentConfig: Record<AgentName, string> = {
    alpha: requireEnv('ALPHA_PRIVATE_KEY'),
    bravo: requireEnv('BRAVO_PRIVATE_KEY'),
    hermes: requireEnv('HERMES_PRIVATE_KEY'),
  };

  const agents = {} as WalletContext['agents'];

  for (const [agent, pk] of Object.entries(agentConfig) as [AgentName, string][]) {
    const account = privateKeyToAccount(normalizePk(pk));
    const walletsByChain = {} as Record<ChainKey, WalletClient>;

    for (const chainCfg of Object.values(CHAINS)) {
      walletsByChain[chainCfg.key] = createWalletClient({
        account,
        chain: chainCfg.chain,
        transport: http(chainClients[chainCfg.key].rpcUrl),
      });
    }

    agents[agent] = {
      account,
      address: account.address,
      walletsByChain,
    };
  }

  return {
    agents,
    chainClients,
  };
}

export async function getUsdcBalance({
  publicClient,
  owner,
  usdc,
}: {
  publicClient: PublicClient;
  owner: Address;
  usdc: Address;
}): Promise<{ raw: bigint; formatted: number }> {
  const raw = await publicClient.readContract({
    abi: erc20Abi,
    address: usdc,
    functionName: 'balanceOf',
    args: [owner],
  });
  return {
    raw,
    formatted: Number(formatUnits(raw, 6)),
  };
}

export async function transferUsdc({
  walletClient,
  usdc,
  to,
  amountRaw,
}: {
  walletClient: WalletClient;
  usdc: Address;
  to: Address;
  amountRaw: bigint;
}): Promise<`0x${string}`> {
  return walletClient.writeContract({
    abi: erc20Abi,
    address: usdc,
    functionName: 'transfer',
    args: [to, amountRaw],
    chain: walletClient.chain,
    // @ts-ignore
    account: walletClient.account,
  });
}
