# Agent Economy

This repository is split into two standalone apps:

- `app/`: Next.js UI that renders the dashboard.
- `server/`: TypeScript backend that runs the agents and exposes WebSocket updates on `/ws`.

## Run the UI

```bash
cd app
npm run dev
```

Set `NEXT_PUBLIC_WS_URL` in `app/.env.local` if the backend runs on a different host, for example `ws://localhost:3000/ws`.

## Run the server

```bash
cd server
npm run dev
```

Copy values from `server/.env.example` into `server/.env` before starting the backend.
