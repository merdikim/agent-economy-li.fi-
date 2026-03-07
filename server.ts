import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { stateManager } from './lib/state.js';
import { CHAIN_KEYS, CHAINS } from './lib/chains.js';
import { getUsdcBalance, initWallets } from './lib/wallet.js';
import { startAlpha } from './agents/alpha.js';
import { startGamma } from './agents/gamma.js';
import { startZebra } from './agents/zebra.js';
import type { BroadcastMessage } from './lib/types.js';
import { jobBoard } from './lib/jobBoard.js';

const PORT = Number(process.env.PORT || 3000);
const IS_PRODUCTION = process.env.NODE_ENV_ID !== 'development';

const app = express();
const publicDir = path.resolve(process.cwd(), 'public');
app.get('/', async (_req, res) => {
  const html = await fs.readFile(path.join(publicDir, 'index.html'), 'utf8');
  res.type('html').send(html.replace('__APP_IS_PRODUCTION__', JSON.stringify(IS_PRODUCTION)));
});
app.use(express.static(publicDir));

const server = createServer(app);
const wss = new WebSocketServer({ server });
const messageHistory: BroadcastMessage[] = [];
const MAX_MESSAGE_HISTORY = 200;

function enqueueZebraSimulation() {
  const offer = {
    from: 'alpha' as const,
    fromChain: 'optimism' as const,
    targetChain: 'base' as const,
    amount: 12.5,
    amountRaw: '12500000',
    fee: 0.123456,
    feeRaw: '123456',
    timestamp: new Date().toISOString(),
    reasoning: 'Synthetic bid injected for UI verification.',
  };

  jobBoard.postJob(offer);
  return offer;
}

let paused = false;

function makeBroadcaster() {
  return ({ type, agent, message, state = null }: Omit<BroadcastMessage, 'timestamp'>): void => {
    const payload: BroadcastMessage = {
      type,
      agent,
      message,
      state,
      timestamp: new Date().toISOString(),
    };

    messageHistory.push(payload);
    if (messageHistory.length > MAX_MESSAGE_HISTORY) {
      messageHistory.shift();
    }

    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(payload));
      }
    }
  };
}

async function bootstrap(): Promise<void> {
  const walletContext = initWallets();
  await stateManager.load();

  await stateManager.update(async (state) => {
    state.startedAt ||= new Date().toISOString();

    for (const agent of ['alpha', 'gamma', 'zebra'] as const) {
      let total = 0;
      for (const chainKey of CHAIN_KEYS) {
        const balance = await getUsdcBalance({
          publicClient: walletContext.chainClients[chainKey].publicClient,
          owner: walletContext.agents[agent].address,
          usdc: CHAINS[chainKey].usdc,
        });
        total += balance.formatted;
      }
      state.agents[agent].balance = total;
      if (agent !== 'zebra' && !state.agents[agent].deployedAmount) {
        state.agents[agent].deployedAmount = total;
      }
    }
  });

  const broadcast = makeBroadcaster();

  wss.on('connection', (socket) => {
    socket.send(
      JSON.stringify({
        type: 'state',
        agent: 'system',
        message: 'Client connected',
        state: stateManager.get(),
        timestamp: new Date().toISOString(),
      } satisfies BroadcastMessage),
    );

    for (const message of messageHistory) {
      socket.send(JSON.stringify(message));
    }

    socket.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type?: string; action?: string };
        if (msg?.type === 'control' && msg?.action === 'togglePause') {
          paused = !paused;
          await stateManager.update(async (state) => {
            state.paused = paused;
          });
          broadcast({
            type: 'log',
            agent: 'system',
            message: paused ? 'Agent loops paused' : 'Agent loops resumed',
            state: stateManager.get(),
          });
        } else if (!IS_PRODUCTION && msg?.type === 'control' && msg?.action === 'simulateZebra') {
          const offer = enqueueZebraSimulation();
          broadcast({
            type: 'log',
            agent: 'system',
            message: `Injected test job for zebra: ${offer.from} ${offer.fromChain} -> ${offer.targetChain} (${offer.fee.toFixed(6)} USDC fee).`,
            state: stateManager.get(),
          });
        }
      } catch {
        // ignore malformed ws payloads
      }
    });
  });

  server.listen(PORT, () => {
    broadcast({
      type: 'log',
      agent: 'system',
      message: '[SYSTEM] Agent Economy live. 3 agents active. No human in loop.',
      state: stateManager.get(),
    });
  });

  const ctx = {
    stateManager,
    chainClients: walletContext.chainClients,
    walletContext,
    broadcast,
    isPaused: () => paused,
  };

  startZebra(ctx);
  startAlpha(ctx);
  startGamma(ctx);
}

bootstrap().catch((error: Error) => {
  console.error('Fatal bootstrap error:', error);
  process.exit(1);
});
