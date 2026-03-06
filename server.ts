import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { stateManager } from './lib/state.js';
import { CHAIN_KEYS, CHAINS } from './lib/chains.js';
import { getUsdcBalance, initWallets } from './lib/wallet.js';
import { startAlpha } from './agents/alpha.js';
import { startBravo } from './agents/bravo.js';
import { startHermes } from './agents/hermes.js';
import type { BroadcastMessage } from './lib/types.js';

const PORT = Number(process.env.PORT || 3000);

const app = express();
app.use(express.static('public'));

const server = createServer(app);
const wss = new WebSocketServer({ server });

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

    for (const agent of ['alpha', 'bravo', 'hermes'] as const) {
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
      if (agent !== 'hermes' && !state.agents[agent].deployedAmount) {
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

  //startHermes(ctx);
  startAlpha(ctx);
  startBravo(ctx);
}

bootstrap().catch((error: Error) => {
  console.error('Fatal bootstrap error:', error);
  process.exit(1);
});
