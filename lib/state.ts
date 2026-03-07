import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppState } from './types.js';

const STATE_PATH = path.resolve(process.cwd(), 'state.json');

function initialState(): AppState {
  return {
    cycle: 0,
    startedAt: new Date().toISOString(),
    agents: {
      alpha: {
        balance: 0,
        yieldEarned: 0,
        feesPaid: 0,
        currentChain: null,
        deployedAmount: 0,
      },
      gamma: {
        balance: 0,
        yieldEarned: 0,
        feesPaid: 0,
        currentChain: null,
        deployedAmount: 0,
      },
      zebra: {
        balance: 0,
        feesEarned: 0,
        jobsExecuted: 0,
        auctionsRun: 0,
      },
    },
    rates: {
      optimism: 0,
      base: 0,
      arbitrum: 0,
    },
    history: [],
    paused: false,
  };
}

function normalizeState(raw: unknown): AppState {
  const base = initialState();
  const parsed = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const agents = (parsed.agents && typeof parsed.agents === 'object' ? parsed.agents : {}) as Record<string, any>;

  return {
    ...base,
    ...parsed,
    agents: {
      alpha: {
        ...base.agents.alpha,
        ...(agents.alpha || {}),
      },
      gamma: {
        ...base.agents.gamma,
        ...(agents.gamma || {}),
      },
      zebra: {
        ...base.agents.zebra,
        ...(agents.zebra || {}),
      },
    },
    rates: {
      ...base.rates,
      ...(parsed.rates || {}),
    },
    history: Array.isArray(parsed.history) ? parsed.history : base.history,
    paused: Boolean(parsed.paused),
  };
}

export class StateManager {
  private state: AppState = initialState();

  async load(): Promise<AppState> {
    try {
      const raw = await fs.readFile(STATE_PATH, 'utf8');
      this.state = normalizeState(JSON.parse(raw));
      await this.save();
    } catch {
      this.state = initialState();
      await this.save();
    }
    return this.state;
  }

  async save(): Promise<void> {
    await fs.writeFile(STATE_PATH, JSON.stringify(this.state, null, 2));
  }

  get(): AppState {
    return this.state;
  }

  async update(mutator: (state: AppState) => void | Promise<void>): Promise<AppState> {
    await mutator(this.state);
    await this.save();
    return this.state;
  }
}

export const stateManager = new StateManager();
