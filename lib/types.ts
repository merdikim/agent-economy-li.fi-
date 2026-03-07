export type AgentName = 'alpha' | 'gamma' | 'zebra';
export type OrchestratorName = 'alpha' | 'gamma';
export type ChainKey = 'optimism' | 'base' | 'arbitrum';

export interface AgentLedger {
  balance: number;
  yieldEarned: number;
  feesPaid: number;
  currentChain: ChainKey | null;
  deployedAmount: number;
}

export interface ZebraLedger {
  balance: number;
  feesEarned: number;
  jobsExecuted: number;
  auctionsRun: number;
}

export interface AppState {
  cycle: number;
  startedAt: string;
  agents: {
    alpha: AgentLedger;
    gamma: AgentLedger;
    zebra: ZebraLedger;
  };
  rates: Record<ChainKey, number>;
  history: JobResult[];
  paused: boolean;
}

export interface JobOffer {
  from: OrchestratorName;
  fromChain: ChainKey;
  targetChain: ChainKey;
  amount: number;
  amountRaw: string;
  fee: number;
  feeRaw: string;
  timestamp: string;
  reasoning: string;
}

export interface JobResult {
  status: 'success' | 'failed' | 'rejected';
  winner: OrchestratorName;
  loser: OrchestratorName | null;
  feePaid: number;
  amount: number;
  sourceChain: ChainKey;
  targetChain: ChainKey;
  txHash?: string;
  reason?: string;
  timestamp: string;
  winnerReasoning?: string;
  loserReasoning?: string | null;
}

export interface BroadcastMessage {
  type: 'log' | 'state' | 'auction' | 'execution';
  agent: AgentName | 'system';
  message: string;
  state: AppState | null;
  timestamp: string;
}

export interface AgentContext {
  stateManager: import('./state.js').StateManager;
  chainClients: import('./wallet.js').ChainClients;
  walletContext: import('./wallet.js').WalletContext;
  broadcast: (message: Omit<BroadcastMessage, 'timestamp'>) => void;
  isPaused: () => boolean;
}

export interface DecisionOutput {
  shouldBridge: boolean;
  targetChain: ChainKey;
  bidFee: number;
  reasoning: string;
}
