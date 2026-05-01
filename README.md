# Forge — Autonomous Ops Platform

A full-stack autonomous incident management platform. The **backend** is a Node.js/Express server running an agent pipeline (error ingestion → root cause → patch writer → confidence gate → deploy mesh). The **frontend** is a React/TypeScript dashboard that connects via WebSocket for live updates.

---

## Project Structure

```
forge/
├── orchestrator.js          # Agent state machine
├── src/
│   ├── index.js             # Express + WebSocket server entry point
│   ├── agents/              # Pipeline agents
│   │   ├── errorIngestion.js
│   │   ├── rootCause.js
│   │   ├── patchWriter.js
│   │   ├── confidenceGate.js
│   │   ├── deployFabric.js
│   │   └── analysis.js
│   ├── services/
│   │   └── contextRelay.js  # Shared in-memory context store
│   └── types/
│       └── schemas.js       # Enums + factory functions
├── package.json
├── .env.example
└── frontend/                # Vite + React + TypeScript dashboard
    ├── index.html
    ├── vite.config.ts
    ├── tsconfig.json
    ├── package.json
    ├── .env.example
    └── src/
        ├── main.tsx
        └── App.tsx
```

---

## Local Development (Quickstart)

### 1. Backend

```bash
# From project root
cp .env.example .env        # edit if needed
npm install
npm run dev                 # starts on http://localhost:3000
```

### 2. Frontend

```bash
cd frontend
cp .env.example .env        # leave VITE_API_URL blank for local dev
npm install
npm run dev                 # starts on http://localhost:5173
```

The Vite dev server proxies all API + WebSocket calls to `localhost:3000` so you don't need CORS config locally.

---

## Production Deployment

### Backend (Railway / Render / Fly.io / any Node host)

1. Set environment variables on your host:
   - `NODE_ENV=production`
   - `PORT` (usually set by host automatically)
   - `CORS_ORIGINS=https://your-frontend-domain.com`

2. Deploy command: `npm start`

> The server handles `SIGTERM` / `SIGINT` for graceful shutdown — no extra config needed for most PaaS hosts.

### Frontend (Vercel / Netlify / Cloudflare Pages)

1. Build command: `npm run build` (run from `frontend/`)
2. Output directory: `frontend/dist`
3. Set environment variable:
   - `VITE_API_URL=https://your-backend-domain.com`

> `VITE_API_URL` **must** be set for production. If left blank, the frontend will try to connect to the same origin as itself (correct for local dev proxy, wrong for separate-domain deploys).

---

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Server health + uptime |
| GET | `/incidents` | All incidents (sorted newest first) |
| GET | `/incidents/stats` | Aggregate metrics |
| GET | `/incidents/:id` | Single incident |
| POST | `/incidents/ingest` | Manually inject an error event |
| POST | `/incidents/:id/approve` | Approve a human-review gate |
| POST | `/incidents/:id/reject` | Reject a human-review gate |
| GET | `/audit` | Full audit log (last 500 entries) |
| GET | `/analysis/refactor` | Refactor Coach tech-debt scan |
| GET | `/analysis/blame` | Blame Graph team/service ownership |
| GET | `/context` | Context Relay snapshot |
| PUT | `/context/:key` | Write a context key (external integrations) |
| WS | `/ws` | Live event stream |

### WebSocket Events (server → client)

| Event | Payload |
|-------|---------|
| `connected` | Initial state: incidents, stats, context, audit_log |
| `incident_created` | New incident object |
| `incident_update` | Updated incident object |
| `incident_resolved` | `{ incident_id, mttr_ms }` |
| `human_review_required` | `{ incident_id, gate, sla_minutes }` |
| `escalation` | `{ incident_id, gate }` |
| `shadow_abort` | `{ incident_id, shadow }` |
| `audit_log` | Single audit entry |

---

## Fixes Applied (vs. original source)

| File | Issue | Fix |
|------|-------|-----|
| `src/index.js` | `dotenv` not loaded — env vars never read from `.env` | Added `import 'dotenv/config'` |
| `orchestrator.js` | Dangling `export default async function handler()` outside the class caused a duplicate-export error | Removed the dead serverless handler |
| `frontend/src/App.tsx` | `(import.meta as any).env` — unsafe cast, breaks in strict TS | Changed to standard `import.meta.env.VITE_API_URL` |
| `frontend/src/App.tsx` | WebSocket URL built by replacing `http` with `ws` on the API base — breaks when `VITE_API_URL` is empty (local dev) | Added `buildWsUrl()` that falls back to same-origin WS when no API base is set |
| `frontend/src/App.tsx` | `https` URLs not converted to `wss` | `buildWsUrl()` handles both `http→ws` and `https→wss` |
| `src/index.js` | No graceful shutdown — abrupt kill on SIGTERM would drop in-flight requests | Added `SIGTERM`/`SIGINT` handlers with `server.close()` |
| `package.json` | `dotenv` missing from dependencies | Added `dotenv ^16.4.5` |
| _Frontend_ | No `vite.config.ts`, no `index.html`, no `tsconfig.json`, no `main.tsx` — the React app had no build scaffolding | Added all missing Vite project files |
| `.env.example` | Named `env.example` (no dot) — not auto-ignored by git | Renamed to `.env.example` |
