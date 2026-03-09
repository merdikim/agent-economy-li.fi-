'use client';

import { useEffect, useRef, useState } from 'react';
import type { AppState, BroadcastMessage, AgentName } from '../lib/types';
import DotGrid from './dot-grid/DotGrid';

type AgentLogMap = Record<AgentName, string[]>;
const RECONNECT_DELAY_MS = 3000;

const initialLogs: AgentLogMap = {
  alpha: [],
  gamma: [],
  zebra: [],
};

function formatNumber(value: number | string | undefined) {
  return Number(value || 0).toFixed(6);
}

function formatTime(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString();
}

function getSocketUrl() {
  if (typeof window === 'undefined') {
    return '';
  }

  const configuredUrl = process.env.NEXT_PUBLIC_WS_URL?.trim();
  if (configuredUrl) {
    if (configuredUrl.startsWith('http://')) {
      return `ws://${configuredUrl.slice('http://'.length)}`;
    }
    if (configuredUrl.startsWith('https://')) {
      return `wss://${configuredUrl.slice('https://'.length)}`;
    }
    return configuredUrl;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.host}/ws`;
}

function makeBoardRows(state: AppState) {
  const alpha = state.agents.alpha;
  const gamma = state.agents.gamma;

  return [
    {
      name: 'alpha',
      pnl: alpha.balance + alpha.yieldEarned - alpha.feesPaid,
      yieldEarned: alpha.yieldEarned,
      feesPaid: alpha.feesPaid,
      currentChain: alpha.currentChain || '-',
      deployed: alpha.deployedAmount,
    },
    {
      name: 'gamma',
      pnl: gamma.balance + gamma.yieldEarned - gamma.feesPaid,
      yieldEarned: gamma.yieldEarned,
      feesPaid: gamma.feesPaid,
      currentChain: gamma.currentChain || '-',
      deployed: gamma.deployedAmount,
    },
  ];
}

export function Dashboard() {
  const [state, setState] = useState<AppState | null>(null);
  const [logs, setLogs] = useState<AgentLogMap>(initialLogs);
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    function clearReconnectTimer() {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    }

    function connect() {
      const socketUrl = getSocketUrl();
      if (!socketUrl) {
        return;
      }

      const ws = new WebSocket(socketUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        clearReconnectTimer();
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data) as BroadcastMessage;
        if (message.agent === 'alpha' || message.agent === 'gamma' || message.agent === 'zebra') {
          const agent = message.agent;
          setLogs((current) => ({
            ...current,
            [agent]: [...current[agent], `[${formatTime(message.timestamp)}] ${message.message}`].slice(-200),
          }));
        }

        if (message.state) {
          setState(message.state);
        }
      };

      ws.onclose = () => {
        if (socketRef.current === ws) {
          socketRef.current = null;
        }
        setIsConnected(false);
        if (!cancelled) {
          clearReconnectTimer();
          reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      clearReconnectTimer();
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, []);

  const paused = Boolean(state?.paused);
  const statusLabel = isConnected ? (paused ? 'PAUSED' : 'LIVE') : 'DISCONNECTED';
  const statusClassName = isConnected ? (paused ? 'status paused' : 'status live') : 'status disconnected';
  const rates = state?.rates;
  const boardRows = state ? makeBoardRows(state) : [];

  function sendControl(action: 'togglePause' | 'simulateZebra') {
    socketRef.current?.send(JSON.stringify({ type: 'control', action }));
  }

  return (
    <main style={{ width: '100%', height: '100vh', position: 'relative' }}>
      <DotGrid
        dotSize={0.6}
        gap={5}
        baseColor="#271E37"
        activeColor="#5227FF"
        proximity={0}
        shockRadius={50}
        shockStrength={1}
        resistance={100}
        returnDuration={0.1}
      />
      <div className="page" style={{position:'absolute', top:"0"}}>
        <div className="dashboard">
      <div className="topbar">
        <div>
          <strong>System Overview</strong>
          <div className="meta">
            <span>Status</span>
            <span className={statusClassName}>{statusLabel}</span>
          </div>
          {!isConnected ? (
            <div className="meta">
              <span>
                Set <code>NEXT_PUBLIC_WS_URL</code> to a websocket backend when hosting the UI on Vercel.
              </span>
            </div>
          ) : null}
        </div>

        <div className="rates" aria-label="Current rates">
          <span>Optimism: {rates ? `${(rates.optimism * 100).toFixed(3)}%` : '--'}</span>
          <span>Base: {rates ? `${(rates.base * 100).toFixed(3)}%` : '--'}</span>
          <span>Arbitrum: {rates ? `${(rates.arbitrum * 100).toFixed(3)}%` : '--'}</span>
        </div>

        <div className="controls">
          {process.env.NODE_ENV !== 'production' ? (
            <button type="button" onClick={() => sendControl('simulateZebra')} disabled={!isConnected}>
              Simulate Zebra
            </button>
          ) : null}
          <button type="button" onClick={() => sendControl('togglePause')} disabled={!isConnected}>
            {paused ? 'Resume Agents' : 'Pause Agents'}
          </button>
        </div>
      </div>

      <div className="panels">
        {(['alpha', 'gamma', 'zebra'] as const).map((agent) => (
          <section className="panel" key={agent}>
            <h2>{agent}</h2>
            <div className="log">
              {logs[agent].length ? logs[agent].join('\n') : 'Waiting for agent output...'}
            </div>
          </section>
        ))}
      </div>

      <div className="leaderboard">
        <table>
          <thead>
            <tr>
              <th>Agent</th>
              <th>Net P&amp;L</th>
              <th>Yield Earned</th>
              <th>Fees Paid</th>
              <th>Current Chain</th>
              <th>Deployed</th>
            </tr>
          </thead>
          <tbody>
            {boardRows.map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                <td>{formatNumber(row.pnl)}</td>
                <td>{formatNumber(row.yieldEarned)}</td>
                <td>{formatNumber(row.feesPaid)}</td>
                <td>{row.currentChain}</td>
                <td>{formatNumber(row.deployed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>
      </div>
    </main>
  );
}
