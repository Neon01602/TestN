// Forge Backend — Express + WebSocket server
// FIX: Added dotenv/config, contextRelay.init(), graceful shutdown, removed broken serverless export

import 'dotenv/config';
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

// Start automatic error ingestion
const autoIngestInterval = parseInt(process.env.AUTO_INGEST_INTERVAL_MS || '45000', 10);
orchestrator.ingestion.startAutoIngest(autoIngestInterval);

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

app.get('/incidents', (_req, res) => {
  const all = [...orchestrator.incidents.values()].sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
  );
  res.json({ incidents: all, total: all.length });
});

app.get('/incidents/stats', (_req, res) => {
  res.json(orchestrator.getStats());
});

app.get('/incidents/:id', (req, res) => {
  const inc = orchestrator.incidents.get(req.params.id);
  if (!inc) return res.status(404).json({ error: 'Incident not found' });
  res.json(inc);
});

app.post('/incidents/ingest', async (req, res) => {
  try {
    const event = await orchestrator.ingestManual(req.body || {});
    res.status(202).json({ accepted: true, error_id: event.error_id, service: event.service });
  } catch (err) {
    console.error('[ingest]', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/incidents/:id/approve', async (req, res) => {
  const result = await orchestrator.approveHumanReview(req.params.id);
  if (result.error) return res.status(404).json(result);
  res.json(result);
});

app.post('/incidents/:id/reject', async (req, res) => {
  const { reason = 'No reason provided' } = req.body || {};
  const result = await orchestrator.rejectHumanReview(req.params.id, reason);
  if (result.error) return res.status(404).json(result);
  res.json(result);
});

// ── Audit log ────────────────────────────────────────────────────────────────

app.get('/audit', (_req, res) => {
  res.json({ entries: orchestrator.auditLog, total: orchestrator.auditLog.length });
});

// ── Analysis ─────────────────────────────────────────────────────────────────

const refactorCoach = new RefactorCoach();
const blameGraph = new BlameGraph();

app.get('/analysis/refactor', (_req, res) => {
  res.json(refactorCoach.scan());
});

app.get('/analysis/blame', (_req, res) => {
  res.json(blameGraph.generate());
});

// ── Context Relay ─────────────────────────────────────────────────────────────

app.get('/context', (_req, res) => {
  res.json(contextRelay.all());
});

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

const server = app.listen(PORT, () => {
  console.log(`[forge] server running on port ${PORT} (${NODE_ENV})`);
  console.log(`[forge] WebSocket endpoint: ws://localhost:${PORT}/ws`);
});

// FIX: Graceful shutdown — prevents abrupt process death on SIGTERM (e.g., Railway, Render, Fly.io)
function shutdown(signal) {
  console.log(`[forge] ${signal} received — shutting down gracefully`);
  orchestrator.ingestion.stop();
  server.close(() => {
    console.log('[forge] HTTP server closed');
    process.exit(0);
  });
  // Force-kill after 10s if hung
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
