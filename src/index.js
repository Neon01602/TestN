// NEX-US Backend — Express + WebSocket server
// Entry point referenced by package.json ("start": "node src/index.js") and vercel.json

import express from 'express';
import expressWs from 'express-ws';
import cors from 'cors';
import { Orchestrator } from '../orchestrator.js';
import { RefactorCoach, BlameGraph } from './agents/analysis.js';
import { contextRelay } from './services/contextRelay.js';

// ─── App setup ───────────────────────────────────────────────────────────────

const app = express();
expressWs(app);

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : [];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || NODE_ENV === 'development' || allowedOrigins.includes(origin)) {
      return cb(null, true);
    }
    cb(new Error(`CORS: origin '${origin}' not allowed`));
  },
  credentials: true
}));

app.use(express.json());

// ─── WebSocket broadcast ──────────────────────────────────────────────────────

const wsClients = new Set();

function broadcast(event, data) {
  const msg = JSON.stringify({ event, data, ts: new Date().toISOString() });
  for (const client of wsClients) {
    if (client.readyState === 1 /* OPEN */) {
      client.send(msg);
    }
  }
}

app.ws('/ws', (ws) => {
  wsClients.add(ws);

  // Send current state on connect
  ws.send(JSON.stringify({
    event: 'connected',
    data: {
      incidents: [...orchestrator.incidents.values()],
      stats: orchestrator.getStats(),
      context: contextRelay.all(),
      audit_log: orchestrator.auditLog.slice(0, 50)
    },
    ts: new Date().toISOString()
  }));

  ws.on('close', () => wsClients.delete(ws));
  ws.on('error', () => wsClients.delete(ws));
});

// ─── Orchestrator ─────────────────────────────────────────────────────────────

const orchestrator = new Orchestrator(broadcast);

// Start automatic error ingestion (every 45 s, ~40% chance per tick)
orchestrator.ingestion.startAutoIngest(45000);

// ─── Routes ───────────────────────────────────────────────────────────────────

// Health
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    uptime_seconds: Math.floor(process.uptime()),
    env: NODE_ENV,
    ws_clients: wsClients.size
  });
});

// ── Incidents ────────────────────────────────────────────────────────────────

// GET  /incidents          — list all incidents (newest first)
app.get('/incidents', (_req, res) => {
  const all = [...orchestrator.incidents.values()].sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
  );
  res.json({ incidents: all, total: all.length });
});

// GET  /incidents/stats    — aggregate metrics
app.get('/incidents/stats', (_req, res) => {
  res.json(orchestrator.getStats());
});

// GET  /incidents/:id      — single incident
app.get('/incidents/:id', (req, res) => {
  const inc = orchestrator.incidents.get(req.params.id);
  if (!inc) return res.status(404).json({ error: 'Incident not found' });
  res.json(inc);
});

// POST /incidents/ingest   — manually push a raw error
app.post('/incidents/ingest', async (req, res) => {
  try {
    const event = await orchestrator.ingestManual(req.body || {});
    res.status(202).json({ accepted: true, error_id: event.error_id, service: event.service });
  } catch (err) {
    console.error('[ingest]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /incidents/:id/approve  — human approves HUMAN_REVIEW gate
app.post('/incidents/:id/approve', async (req, res) => {
  const result = await orchestrator.approveHumanReview(req.params.id);
  if (result.error) return res.status(404).json(result);
  res.json(result);
});

// POST /incidents/:id/reject   — human rejects HUMAN_REVIEW gate
app.post('/incidents/:id/reject', async (req, res) => {
  const { reason = 'No reason provided' } = req.body || {};
  const result = await orchestrator.rejectHumanReview(req.params.id, reason);
  if (result.error) return res.status(404).json(result);
  res.json(result);
});

// ── Audit log ────────────────────────────────────────────────────────────────

// GET  /audit              — full in-memory audit log (newest first, max 500)
app.get('/audit', (_req, res) => {
  res.json({ entries: orchestrator.auditLog, total: orchestrator.auditLog.length });
});

// ── Analysis (Refactor Coach + Blame Graph) ───────────────────────────────────

const refactorCoach = new RefactorCoach();
const blameGraph = new BlameGraph();

// GET  /analysis/refactor  — tech-debt scan across all modules
app.get('/analysis/refactor', (_req, res) => {
  res.json(refactorCoach.scan());
});

// GET  /analysis/blame     — team ownership + hotspot graph
app.get('/analysis/blame', (_req, res) => {
  res.json(blameGraph.generate());
});

// ── Context Relay ─────────────────────────────────────────────────────────────

// GET  /context            — full shared context store snapshot
app.get('/context', (_req, res) => {
  res.json(contextRelay.all());
});

// PUT  /context/:key       — write a key into the relay (for external integrations)
app.put('/context/:key', (req, res) => {
  const { key } = req.params;
  const { value } = req.body || {};
  if (value === undefined) return res.status(400).json({ error: 'body.value is required' });
  contextRelay.set(key, value);
  res.json({ ok: true, key });
});

// ── 404 fallthrough ───────────────────────────────────────────────────────────

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[nexus] server running on port ${PORT} (${NODE_ENV})`);
  console.log(`[nexus] WebSocket endpoint: ws://localhost:${PORT}/ws`);
});

export default app;
