import { useState, useEffect, useRef, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────
type Severity = "P0" | "P1" | "P2" | "P3";
type Stage =
  | "ErrorIngestion" | "RootCause" | "PatchWriter" | "ConfidenceGate"
  | "ContextReader" | "DeployMesh" | "ShadowDeploy" | "Complete" | "Failed";
type Status = "active" | "resolved" | "awaiting_review" | "escalated" | "shadow_abort" | "rejected" | "error";
type GateDecision = "AUTO_EXECUTE" | "HUMAN_REVIEW" | "ESCALATE";

interface Incident {
  id: string; service: string; severity: Severity;
  timestamp: string; stage: Stage; status: Status;
  root_cause?: any; patch?: any; gate?: any; deploy?: any; shadow?: any;
  context?: any; resolved_at?: string; mttr_ms?: number; error?: string;
}
interface AuditEntry { action: string; data: any; timestamp: string; }
interface Stats {
  total: number; active: number; resolved: number;
  awaiting_review: number; escalated: number;
  avg_mttr_ms: number; auto_resolve_rate: number;
}
interface WsMessage { event: string; data: any; ts: string; }

// ─── Config ───────────────────────────────────────────────────────────────────
const API = (import.meta as any).env?.VITE_API_URL || "http://localhost:3000";
const WS_URL = API.replace(/^http/, "ws") + "/ws";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const SEV_COLOR: Record<Severity, string> = {
  P0: "#ff2d55", P1: "#ff9f0a", P2: "#30d158", P3: "#636366"
};
const STAGE_ORDER: Stage[] = [
  "ErrorIngestion","RootCause","PatchWriter","ConfidenceGate",
  "ContextReader","DeployMesh","ShadowDeploy","Complete"
];
const ms = (n: number) => n < 1000 ? `${n}ms` : `${(n/1000).toFixed(1)}s`;
const timeAgo = (iso: string) => {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  return `${Math.floor(s/3600)}h ago`;
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function App() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [context, setContext] = useState<any>(null);
  const [refactor, setRefactor] = useState<any>(null);
  const [blame, setBlame] = useState<any>(null);
  const [selected, setSelected] = useState<Incident | null>(null);
  const [tab, setTab] = useState<"incidents"|"analysis"|"context"|"audit">("incidents");
  const [wsStatus, setWsStatus] = useState<"connecting"|"connected"|"disconnected">("connecting");
  const [pulse, setPulse] = useState(false);
  const [ingestOpen, setIngestOpen] = useState(false);
  const [ingestService, setIngestService] = useState("payments-service");
  const [ingestSev, setIngestSev] = useState<Severity>("P1");
  const auditRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // WebSocket
  const connectWs = useCallback(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.onopen = () => setWsStatus("connected");
    ws.onclose = () => { setWsStatus("disconnected"); setTimeout(connectWs, 3000); };
    ws.onerror = () => ws.close();
    ws.onmessage = (e) => {
      const msg: WsMessage = JSON.parse(e.data);
      setPulse(true); setTimeout(() => setPulse(false), 400);
      if (msg.event === "connected") {
        setIncidents(msg.data.incidents || []);
        setStats(msg.data.stats || null);
        setContext(msg.data.context || null);
        setAudit(msg.data.audit_log || []);
      } else if (msg.event === "incident_created") {
        setIncidents(p => [msg.data.incident, ...p]);
      } else if (msg.event === "incident_update") {
        setIncidents(p => p.map(i => i.id === msg.data.incident.id ? msg.data.incident : i));
        setSelected(s => s?.id === msg.data.incident.id ? msg.data.incident : s);
      } else if (msg.event === "incident_resolved") {
        fetchStats();
      } else if (msg.event === "audit_log") {
        setAudit(p => [msg.data, ...p].slice(0, 200));
      }
    };
  }, []);

  useEffect(() => { connectWs(); return () => wsRef.current?.close(); }, [connectWs]);

  const fetchStats = () =>
    fetch(`${API}/incidents/stats`).then(r => r.json()).then(setStats).catch(() => {});

  useEffect(() => {
    fetch(`${API}/analysis/refactor`).then(r=>r.json()).then(setRefactor).catch(()=>{});
    fetch(`${API}/analysis/blame`).then(r=>r.json()).then(setBlame).catch(()=>{});
    fetch(`${API}/context`).then(r=>r.json()).then(setContext).catch(()=>{});
  }, []);

  const ingest = async () => {
    await fetch(`${API}/incidents/ingest`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ service: ingestService, severity: ingestSev })
    });
    setIngestOpen(false);
  };

  const approve = async (id: string) => {
    await fetch(`${API}/incidents/${id}/approve`, { method:"POST" });
  };
  const reject = async (id: string) => {
    await fetch(`${API}/incidents/${id}/reject`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ reason: "Rejected via UI" })
    });
  };

  const sortedIncidents = [...incidents].sort(
    (a,b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return (
    <div className="app">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="logo">
          <span className="logo-nex">NEX</span><span className="logo-dash">—</span><span className="logo-us">US</span>
          <div className="logo-sub">Autonomous Ops Platform</div>
        </div>

        <nav>
          {(["incidents","analysis","context","audit"] as const).map(t => (
            <button key={t} className={`nav-btn${tab===t?" active":""}`} onClick={() => setTab(t)}>
              <span className="nav-icon">{
                t==="incidents"?"⬡":t==="analysis"?"⬡":t==="context"?"⬡":"⬡"
              }</span>
              {t.charAt(0).toUpperCase()+t.slice(1)}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          {/* Stats mini */}
          {stats && (
            <div className="mini-stats">
              <div className="mini-stat"><span className="ms-val">{stats.total}</span><span className="ms-lbl">Total</span></div>
              <div className="mini-stat"><span className="ms-val active-val">{stats.active}</span><span className="ms-lbl">Active</span></div>
              <div className="mini-stat"><span className="ms-val">{stats.resolved}</span><span className="ms-lbl">Resolved</span></div>
              <div className="mini-stat"><span className="ms-val">{(stats.auto_resolve_rate*100).toFixed(0)}%</span><span className="ms-lbl">Auto</span></div>
            </div>
          )}
          <div className={`ws-badge ${wsStatus}`}>
            <span className="ws-dot" />
            {wsStatus === "connected" ? "Live" : wsStatus === "connecting" ? "Connecting…" : "Reconnecting…"}
            {pulse && <span className="ws-pulse" />}
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="main">
        {/* Header */}
        <header className="topbar">
          <div className="topbar-title">
            {tab === "incidents" && "Incident Stream"}
            {tab === "analysis" && "Code Intelligence"}
            {tab === "context" && "System Context"}
            {tab === "audit" && "Audit Trail"}
          </div>
          <div className="topbar-actions">
            {tab === "incidents" && (
              <button className="btn-primary" onClick={() => setIngestOpen(true)}>
                + Inject Error
              </button>
            )}
            {stats && tab === "incidents" && (
              <div className="mttr-chip">
                Avg MTTR {ms(stats.avg_mttr_ms || 0)}
              </div>
            )}
          </div>
        </header>

        {/* ── Incidents Tab ── */}
        {tab === "incidents" && (
          <div className="incidents-layout">
            <div className="incident-list">
              {sortedIncidents.length === 0 && (
                <div className="empty-state">
                  <div className="empty-icon">◎</div>
                  <div>No incidents yet</div>
                  <div className="empty-sub">Auto-ingest fires every 45s · or inject manually</div>
                </div>
              )}
              {sortedIncidents.map(inc => (
                <div
                  key={inc.id}
                  className={`incident-card${selected?.id === inc.id ? " selected" : ""}${inc.status === "active" ? " inc-active" : ""}`}
                  onClick={() => setSelected(inc)}
                >
                  <div className="inc-top">
                    <span className="sev-badge" style={{ color: SEV_COLOR[inc.severity], borderColor: SEV_COLOR[inc.severity] }}>
                      {inc.severity}
                    </span>
                    <span className="inc-id">{inc.id}</span>
                    <span className="inc-time">{timeAgo(inc.timestamp)}</span>
                  </div>
                  <div className="inc-service">{inc.service}</div>
                  <div className="inc-bottom">
                    <StageBar stage={inc.stage} status={inc.status} />
                    <StatusPill status={inc.status} />
                  </div>
                </div>
              ))}
            </div>

            {/* Detail panel */}
            <div className="detail-panel">
              {selected ? (
                <IncidentDetail inc={selected} onApprove={approve} onReject={reject} />
              ) : (
                <div className="detail-empty">
                  <div className="de-icon">◎</div>
                  <div>Select an incident</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Analysis Tab ── */}
        {tab === "analysis" && (
          <div className="analysis-layout">
            {refactor && <RefactorPanel data={refactor} />}
            {blame && <BlamePanel data={blame} />}
          </div>
        )}

        {/* ── Context Tab ── */}
        {tab === "context" && context && <ContextPanel data={context} />}

        {/* ── Audit Tab ── */}
        {tab === "audit" && (
          <div className="audit-wrap" ref={auditRef}>
            <div className="audit-list">
              {audit.map((e, i) => (
                <div key={i} className="audit-row">
                  <span className="audit-time">{new Date(e.timestamp).toLocaleTimeString()}</span>
                  <span className={`audit-action act-${e.action.split("_")[0].toLowerCase()}`}>{e.action}</span>
                  <span className="audit-data">{JSON.stringify(e.data).slice(0,120)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* ── Ingest Modal ── */}
      {ingestOpen && (
        <div className="modal-overlay" onClick={() => setIngestOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">Inject Error Event</div>
            <label className="modal-label">Service</label>
            <select className="modal-select" value={ingestService} onChange={e => setIngestService(e.target.value)}>
              {["payments-service","auth-service","api-gateway","user-service","notification-service","search-service"].map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <label className="modal-label">Severity</label>
            <div className="sev-row">
              {(["P0","P1","P2","P3"] as Severity[]).map(s => (
                <button key={s} className={`sev-btn${ingestSev===s?" sev-sel":""}`}
                  style={ingestSev===s ? { borderColor: SEV_COLOR[s], color: SEV_COLOR[s] } : {}}
                  onClick={() => setIngestSev(s)}>{s}</button>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setIngestOpen(false)}>Cancel</button>
              <button className="btn-primary" onClick={ingest}>Inject</button>
            </div>
          </div>
        </div>
      )}

      <style>{CSS}</style>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StageBar({ stage, status }: { stage: Stage; status: Status }) {
  const idx = STAGE_ORDER.indexOf(stage);
  const failed = status === "Failed" || stage === "Failed";
  return (
    <div className="stage-bar">
      {STAGE_ORDER.map((s, i) => (
        <div key={s} className={`stage-dot${i < idx ? " done" : i === idx ? (failed ? " fail" : " active") : ""}`} />
      ))}
    </div>
  );
}

function StatusPill({ status }: { status: Status }) {
  const map: Record<Status, [string,string]> = {
    active: ["#ff9f0a","Active"],
    resolved: ["#30d158","Resolved"],
    awaiting_review: ["#0a84ff","Review"],
    escalated: ["#ff2d55","Escalated"],
    shadow_abort: ["#ff2d55","Aborted"],
    rejected: ["#636366","Rejected"],
    error: ["#ff2d55","Error"],
  };
  const [color, label] = map[status] || ["#636366", status];
  return <span className="status-pill" style={{ color, borderColor: color }}>{label}</span>;
}

function IncidentDetail({ inc, onApprove, onReject }: { inc: Incident; onApprove: (id:string)=>void; onReject: (id:string)=>void }) {
  const [open, setOpen] = useState<string[]>(["root"]);
  const toggle = (k: string) => setOpen(p => p.includes(k) ? p.filter(x=>x!==k) : [...p,k]);

  return (
    <div className="detail-inner">
      <div className="detail-header">
        <div>
          <span className="sev-badge lg" style={{ color: SEV_COLOR[inc.severity], borderColor: SEV_COLOR[inc.severity] }}>{inc.severity}</span>
          <span className="detail-id">{inc.id}</span>
        </div>
        <StatusPill status={inc.status} />
      </div>
      <div className="detail-service">{inc.service}</div>
      <div className="detail-meta">
        <span>{new Date(inc.timestamp).toLocaleString()}</span>
        {inc.mttr_ms && <span>MTTR: {ms(inc.mttr_ms)}</span>}
      </div>

      <StageBar stage={inc.stage} status={inc.status} />
      <div className="stage-label">{inc.stage}</div>

      {/* Human review CTA */}
      {inc.status === "awaiting_review" && (
        <div className="review-cta">
          <div className="review-title">⚡ Human Review Required</div>
          <div className="review-sub">Confidence or risk outside auto-execute bounds. SLA: 15 min.</div>
          <div className="review-btns">
            <button className="btn-approve" onClick={() => onApprove(inc.id)}>Approve & Deploy</button>
            <button className="btn-reject" onClick={() => onReject(inc.id)}>Reject</button>
          </div>
        </div>
      )}

      {/* Sections */}
      {inc.root_cause && (
        <Section title="Root Cause" k="root" open={open} toggle={toggle}>
          <KV label="Commit" val={inc.root_cause.cause_commit} mono />
          <KV label="Author" val={inc.root_cause.cause_author} />
          <KV label="Message" val={inc.root_cause.cause_message} />
          <KV label="File" val={inc.root_cause.cause_file} mono />
          <KV label="Confidence" val={`${(inc.root_cause.confidence_score*100).toFixed(0)}%`} />
          <ConfBar val={inc.root_cause.confidence_score} />
        </Section>
      )}

      {inc.patch && (
        <Section title="Patch" k="patch" open={open} toggle={toggle}>
          <KV label="File" val={inc.patch.target_file} mono />
          <KV label="Description" val={inc.patch.description} />
          <KV label="Risk" val={`${(inc.patch.estimated_risk*100).toFixed(0)}%`} />
          <KV label="Sandbox" val={inc.patch.sandbox_pass ? "✓ PASS" : "✗ FAIL"} color={inc.patch.sandbox_pass ? "#30d158":"#ff2d55"} />
          <KV label="Lines" val={`±${inc.patch.lines_changed}`} />
          <div className="diff-block">{inc.patch.diff}</div>
        </Section>
      )}

      {inc.gate && (
        <Section title="Confidence Gate" k="gate" open={open} toggle={toggle}>
          <div className={`gate-decision dec-${inc.gate.decision?.toLowerCase()}`}>{inc.gate.decision}</div>
          <KV label="Confidence" val={`${(inc.gate.confidence_score*100).toFixed(0)}%`} />
          <KV label="Risk" val={`${(inc.gate.risk_score*100).toFixed(0)}%`} />
          <KV label="Audit ID" val={inc.gate.audit_id} mono />
        </Section>
      )}

      {inc.deploy && (
        <Section title="Deploy Mesh" k="deploy" open={open} toggle={toggle}>
          <KV label="Strategy" val={inc.deploy.strategy?.toUpperCase()} />
          <KV label="Reasoning" val={inc.deploy.reasoning} />
          <KV label="Window" val={inc.deploy.window?.recommendation} />
          <KV label="Safety Score" val={`${(inc.deploy.safety_score*100).toFixed(0)}%`} />
        </Section>
      )}

      {inc.shadow && (
        <Section title="Shadow Deploy" k="shadow" open={open} toggle={toggle}>
          <KV label="Decision" val={inc.shadow.decision} color={inc.shadow.anomaly_detected?"#ff2d55":"#30d158"} />
          <KV label="Error Rate" val={(inc.shadow.shadow_metrics?.error_rate*100).toFixed(2)+"%"} />
          <KV label="P99 Latency" val={`${inc.shadow.shadow_metrics?.p99_latency_ms?.toFixed(0)}ms`} />
          <KV label="CPU" val={`${inc.shadow.shadow_metrics?.cpu_percent?.toFixed(1)}%`} />
        </Section>
      )}
    </div>
  );
}

function Section({ title, k, open, toggle, children }: any) {
  const isOpen = open.includes(k);
  return (
    <div className="section">
      <button className="section-header" onClick={() => toggle(k)}>
        <span>{title}</span><span className="section-chevron">{isOpen?"▲":"▼"}</span>
      </button>
      {isOpen && <div className="section-body">{children}</div>}
    </div>
  );
}

function KV({ label, val, mono=false, color }: { label:string; val:any; mono?:boolean; color?:string }) {
  return (
    <div className="kv-row">
      <span className="kv-label">{label}</span>
      <span className={`kv-val${mono?" mono":""}`} style={color?{color}:{}}>{val}</span>
    </div>
  );
}

function ConfBar({ val }: { val: number }) {
  const color = val >= 0.85 ? "#30d158" : val >= 0.6 ? "#ff9f0a" : "#ff2d55";
  return (
    <div className="conf-bar-wrap">
      <div className="conf-bar-track">
        <div className="conf-bar-fill" style={{ width: `${val*100}%`, background: color }} />
      </div>
      <div className="conf-thresholds">
        <span style={{left:"60%"}}>Review</span>
        <span style={{left:"85%"}}>Auto</span>
      </div>
    </div>
  );
}

function RefactorPanel({ data }: { data: any }) {
  return (
    <div className="analysis-card">
      <div className="ac-header">
        <span className="ac-title">Refactor Coach</span>
        <span className="ac-sub">Tech Debt Score: <strong>{data.tech_debt_score}</strong> · Circular Deps: <strong>{data.circular_dependencies_total}</strong></span>
      </div>
      <div className="module-list">
        {data.modules?.map((m: any) => (
          <div key={m.name} className="module-row">
            <div className="module-name">{m.name}</div>
            <div className="module-meta">
              <span className={`risk-tag risk-${m.risk_level.toLowerCase()}`}>{m.risk_level}</span>
              <span className="module-stat">{m.test_coverage}% cov</span>
              <span className="module-stat">{m.loc} loc</span>
            </div>
            <div className="module-bar-track">
              <div className="module-bar-fill" style={{ width:`${m.refactor_risk*100}%`,
                background: m.risk_level==="HIGH"?"#ff2d55":m.risk_level==="MEDIUM"?"#ff9f0a":"#30d158" }} />
            </div>
          </div>
        ))}
      </div>
      {data.migration_plan && (
        <div className="migration-plan">
          <div className="mp-title">Migration Plan — {data.top_risk_module?.name}</div>
          {data.migration_plan.map((step: any) => (
            <div key={step.sprint} className={`mp-step label-${step.label}`}>
              <span className="mp-sprint">Sprint {step.sprint}</span>
              <span className="mp-task">{step.task}</span>
              <span className="mp-days">{step.estimated_days}d</span>
              {step.human_gate && <span className="mp-badge">👤 Gate</span>}
              {step.shadow_required && <span className="mp-badge">🔲 Shadow</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BlamePanel({ data }: { data: any }) {
  const teams = data.nodes?.filter((n: any) => n.type === "team") || [];
  const services = data.nodes?.filter((n: any) => n.type === "service") || [];
  return (
    <div className="analysis-card">
      <div className="ac-header">
        <span className="ac-title">Blame Graph</span>
        <span className="ac-sub">Hotspot: <strong style={{color:"#ff2d55"}}>{data.hotspot_team}</strong> — {data.hotspot_rate}</span>
      </div>
      <div className="blame-grid">
        <div>
          <div className="blame-section-title">Teams</div>
          {teams.map((t: any) => (
            <div key={t.id} className={`blame-row${t.label===data.hotspot_team?" hotspot":""}`}>
              <span className="blame-name">{t.label}</span>
              <span className="blame-p0">{(t.p0_rate*100).toFixed(1)}% P0</span>
              <span className="blame-commits">{t.avg_commits_per_week} commits/wk</span>
            </div>
          ))}
        </div>
        <div>
          <div className="blame-section-title">Services</div>
          {services.map((s: any) => (
            <div key={s.id} className="blame-row">
              <span className="blame-name">{s.label}</span>
              <span className="blame-edge">
                {data.edges?.find((e: any) => e.to === s.id) &&
                  `owned by ${teams.find((t: any) => t.id === data.edges.find((e: any) => e.to === s.id)?.from)?.label || "?"}`
                }
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ContextPanel({ data }: { data: any }) {
  return (
    <div className="context-grid">
      {data.system_metrics && (
        <div className="ctx-card">
          <div className="ctx-title">System Metrics</div>
          {Object.entries(data.system_metrics).map(([k,v]) => (
            <KV key={k} label={k.replace(/_/g," ")} val={String(v)} />
          ))}
        </div>
      )}
      {data.current_on_call && (
        <div className="ctx-card">
          <div className="ctx-title">On-Call</div>
          <KV label="Engineer" val={data.current_on_call.name} />
          <KV label="Timezone" val={data.current_on_call.timezone} />
          <KV label="PagerDuty" val={data.current_on_call.pagerduty_id} mono />
        </div>
      )}
      {data.team_context && (
        <div className="ctx-card">
          <div className="ctx-title">Team Context</div>
          <KV label="Sprint" val={data.team_context.sprint} />
          <KV label="Release Freeze" val={data.team_context.release_freeze ? "YES" : "NO"} color={data.team_context.release_freeze?"#ff2d55":"#30d158"} />
          {data.team_context.upcoming_demos?.map((d: any, i: number) => (
            <KV key={i} label="Upcoming Demo" val={`${d.title} — ${new Date(d.time).toLocaleString()}`} />
          ))}
        </div>
      )}
      {data.recent_deploys && (
        <div className="ctx-card ctx-wide">
          <div className="ctx-title">Recent Deploys</div>
          {data.recent_deploys.map((d: any, i: number) => (
            <div key={i} className="deploy-row">
              <span className="deploy-service">{d.service}</span>
              <span className="deploy-ver">{d.version}</span>
              <span className="deploy-status" style={{color: d.status==="success"?"#30d158":"#ff2d55"}}>{d.status}</span>
              <span className="deploy-time">{timeAgo(d.time)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500&family=DM+Sans:wght@300;400;500&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #0a0a0c;
    --surface: #111114;
    --surface2: #18181d;
    --surface3: #1e1e25;
    --border: #2a2a35;
    --border2: #3a3a48;
    --text: #e8e8f0;
    --text2: #8888a0;
    --text3: #55556a;
    --accent: #6c63ff;
    --accent2: #a78bfa;
    --green: #30d158;
    --orange: #ff9f0a;
    --red: #ff2d55;
    --blue: #0a84ff;
    --radius: 10px;
    --radius-sm: 6px;
  }

  html, body, #root { height: 100%; background: var(--bg); color: var(--text); font-family: 'DM Sans', sans-serif; font-size: 14px; }

  .app { display: flex; height: 100vh; overflow: hidden; }

  /* ── Sidebar ── */
  .sidebar {
    width: 220px; flex-shrink: 0; background: var(--surface);
    border-right: 1px solid var(--border); display: flex; flex-direction: column;
    padding: 24px 0 20px;
  }
  .logo { padding: 0 20px 28px; }
  .logo-nex { font-family: 'Syne', sans-serif; font-weight: 800; font-size: 22px; color: var(--text); letter-spacing: -1px; }
  .logo-dash { font-family: 'Syne', sans-serif; font-weight: 800; font-size: 22px; color: var(--accent); margin: 0 1px; }
  .logo-us { font-family: 'Syne', sans-serif; font-weight: 800; font-size: 22px; color: var(--text); letter-spacing: -1px; }
  .logo-sub { font-size: 10px; color: var(--text3); letter-spacing: 0.05em; margin-top: 4px; font-family: 'JetBrains Mono', monospace; }

  nav { flex: 1; display: flex; flex-direction: column; gap: 2px; padding: 0 10px; }
  .nav-btn {
    display: flex; align-items: center; gap: 10px; padding: 10px 14px;
    background: none; border: none; color: var(--text2); font-size: 13px;
    font-family: 'DM Sans', sans-serif; font-weight: 500; border-radius: var(--radius-sm);
    cursor: pointer; transition: all 0.15s; text-align: left; width: 100%;
  }
  .nav-btn:hover { background: var(--surface2); color: var(--text); }
  .nav-btn.active { background: var(--surface3); color: var(--text); border: 1px solid var(--border2); }
  .nav-icon { font-size: 10px; color: var(--accent); }

  .sidebar-footer { padding: 0 14px; display: flex; flex-direction: column; gap: 12px; }
  .mini-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .mini-stat { background: var(--surface2); border-radius: var(--radius-sm); padding: 8px 10px; text-align: center; border: 1px solid var(--border); }
  .ms-val { display: block; font-family: 'Syne', sans-serif; font-size: 18px; font-weight: 700; color: var(--text); }
  .ms-val.active-val { color: var(--orange); }
  .ms-lbl { font-size: 10px; color: var(--text3); letter-spacing: 0.05em; }

  .ws-badge {
    display: flex; align-items: center; gap: 6px; padding: 7px 12px;
    background: var(--surface2); border-radius: var(--radius-sm); border: 1px solid var(--border);
    font-size: 11px; font-family: 'JetBrains Mono', monospace; position: relative; overflow: hidden;
    color: var(--text2);
  }
  .ws-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text3); flex-shrink: 0; }
  .ws-badge.connected .ws-dot { background: var(--green); box-shadow: 0 0 6px var(--green); }
  .ws-badge.connected { color: var(--green); }
  .ws-pulse {
    position: absolute; inset: 0; background: rgba(100,200,120,0.12);
    animation: pulse-fade 0.4s ease-out forwards;
  }
  @keyframes pulse-fade { from { opacity:1 } to { opacity:0 } }

  /* ── Main ── */
  .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

  .topbar {
    height: 60px; border-bottom: 1px solid var(--border); display: flex;
    align-items: center; justify-content: space-between; padding: 0 28px; flex-shrink: 0;
    background: var(--surface);
  }
  .topbar-title { font-family: 'Syne', sans-serif; font-size: 16px; font-weight: 700; color: var(--text); }
  .topbar-actions { display: flex; align-items: center; gap: 12px; }

  .btn-primary {
    padding: 7px 16px; background: var(--accent); color: #fff; border: none;
    border-radius: var(--radius-sm); font-size: 13px; font-family: 'DM Sans', sans-serif;
    font-weight: 500; cursor: pointer; transition: opacity 0.15s;
  }
  .btn-primary:hover { opacity: 0.88; }
  .btn-ghost {
    padding: 7px 16px; background: none; color: var(--text2); border: 1px solid var(--border2);
    border-radius: var(--radius-sm); font-size: 13px; font-family: 'DM Sans', sans-serif;
    cursor: pointer; transition: all 0.15s;
  }
  .btn-ghost:hover { background: var(--surface2); color: var(--text); }

  .mttr-chip { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text3); padding: 5px 10px; background: var(--surface2); border-radius: var(--radius-sm); border: 1px solid var(--border); }

  /* ── Incidents ── */
  .incidents-layout { display: flex; flex: 1; overflow: hidden; }
  .incident-list { width: 360px; flex-shrink: 0; overflow-y: auto; border-right: 1px solid var(--border); padding: 12px; display: flex; flex-direction: column; gap: 6px; }
  .incident-list::-webkit-scrollbar { width: 4px; }
  .incident-list::-webkit-scrollbar-track { background: transparent; }
  .incident-list::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }

  .incident-card {
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 12px 14px; cursor: pointer; transition: all 0.15s;
  }
  .incident-card:hover { background: var(--surface2); border-color: var(--border2); }
  .incident-card.selected { background: var(--surface2); border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent)20; }
  .incident-card.inc-active { border-left: 3px solid var(--orange); }

  .inc-top { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .sev-badge {
    font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 500;
    border: 1px solid; border-radius: 4px; padding: 2px 6px;
  }
  .sev-badge.lg { font-size: 12px; padding: 3px 8px; }
  .inc-id { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text2); flex:1; }
  .inc-time { font-size: 11px; color: var(--text3); }
  .inc-service { font-size: 13px; font-weight: 500; color: var(--text); margin-bottom: 8px; }
  .inc-bottom { display: flex; align-items: center; justify-content: space-between; gap: 8px; }

  .stage-bar { display: flex; gap: 3px; align-items: center; flex: 1; }
  .stage-dot { width: 12px; height: 3px; border-radius: 2px; background: var(--border2); transition: background 0.3s; flex-shrink: 0; }
  .stage-dot.done { background: var(--accent); }
  .stage-dot.active { background: var(--orange); animation: dot-pulse 1.2s ease-in-out infinite; }
  .stage-dot.fail { background: var(--red); }
  @keyframes dot-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }

  .status-pill { font-size: 10px; font-family: 'JetBrains Mono', monospace; border: 1px solid; border-radius: 4px; padding: 2px 6px; flex-shrink: 0; }

  .empty-state { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 60px 20px; color: var(--text3); text-align: center; }
  .empty-icon { font-size: 32px; opacity: 0.3; }
  .empty-sub { font-size: 11px; }

  /* ── Detail ── */
  .detail-panel { flex: 1; overflow-y: auto; }
  .detail-panel::-webkit-scrollbar { width: 4px; }
  .detail-panel::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }
  .detail-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text3); gap: 8px; }
  .de-icon { font-size: 40px; opacity: 0.2; }

  .detail-inner { padding: 24px 28px; }
  .detail-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
  .detail-id { font-family: 'JetBrains Mono', monospace; font-size: 13px; color: var(--text2); margin-left: 10px; }
  .detail-service { font-family: 'Syne', sans-serif; font-size: 20px; font-weight: 700; color: var(--text); margin-bottom: 4px; }
  .detail-meta { display: flex; gap: 16px; font-size: 11px; color: var(--text3); margin-bottom: 14px; font-family: 'JetBrains Mono', monospace; }
  .stage-label { font-size: 11px; color: var(--text3); font-family: 'JetBrains Mono', monospace; margin-top: 4px; margin-bottom: 18px; }

  .review-cta { background: linear-gradient(135deg, #0a1628, #0d1f3c); border: 1px solid #0a84ff40; border-radius: var(--radius); padding: 16px; margin-bottom: 16px; }
  .review-title { font-family: 'Syne', sans-serif; font-weight: 700; font-size: 14px; color: #0a84ff; margin-bottom: 4px; }
  .review-sub { font-size: 12px; color: var(--text2); margin-bottom: 12px; }
  .review-btns { display: flex; gap: 8px; }
  .btn-approve { padding: 7px 16px; background: var(--green); color: #000; border: none; border-radius: var(--radius-sm); font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; }
  .btn-reject { padding: 7px 16px; background: none; color: var(--red); border: 1px solid var(--red); border-radius: var(--radius-sm); font-size: 13px; cursor: pointer; font-family: 'DM Sans', sans-serif; }

  .section { border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: 8px; overflow: hidden; }
  .section-header { width: 100%; display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: var(--surface2); border: none; color: var(--text); font-size: 12px; font-weight: 600; font-family: 'Syne', sans-serif; cursor: pointer; letter-spacing: 0.04em; }
  .section-chevron { font-size: 9px; color: var(--text3); }
  .section-body { padding: 12px 14px; background: var(--surface); display: flex; flex-direction: column; gap: 6px; }

  .kv-row { display: flex; gap: 12px; align-items: baseline; }
  .kv-label { font-size: 11px; color: var(--text3); min-width: 90px; flex-shrink: 0; font-family: 'JetBrains Mono', monospace; }
  .kv-val { font-size: 12px; color: var(--text2); word-break: break-all; }
  .kv-val.mono { font-family: 'JetBrains Mono', monospace; color: var(--accent2); }

  .conf-bar-wrap { position: relative; padding-bottom: 16px; margin-top: 4px; }
  .conf-bar-track { height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; }
  .conf-bar-fill { height: 100%; border-radius: 2px; transition: width 0.6s ease; }
  .conf-thresholds { position: relative; height: 14px; }
  .conf-thresholds span { position: absolute; font-size: 9px; color: var(--text3); transform: translateX(-50%); font-family: 'JetBrains Mono', monospace; }

  .diff-block { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #a0c4a0; background: #0d1a0d; border: 1px solid #1a2e1a; border-radius: 6px; padding: 10px; white-space: pre-wrap; line-height: 1.6; margin-top: 6px; overflow-x: auto; }

  .gate-decision { font-family: 'Syne', sans-serif; font-size: 15px; font-weight: 800; margin-bottom: 8px; letter-spacing: 0.05em; }
  .dec-auto_execute { color: var(--green); }
  .dec-human_review { color: var(--blue); }
  .dec-escalate { color: var(--red); }

  /* ── Analysis ── */
  .analysis-layout { display: flex; flex-direction: column; gap: 0; overflow-y: auto; padding: 20px; gap: 16px; }
  .analysis-layout::-webkit-scrollbar { width: 4px; }
  .analysis-layout::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }
  .analysis-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; }
  .ac-header { display: flex; align-items: baseline; gap: 16px; margin-bottom: 16px; }
  .ac-title { font-family: 'Syne', sans-serif; font-size: 16px; font-weight: 700; }
  .ac-sub { font-size: 12px; color: var(--text2); }

  .module-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px; }
  .module-row { display: flex; flex-direction: column; gap: 4px; }
  .module-name { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text2); }
  .module-meta { display: flex; align-items: center; gap: 8px; }
  .risk-tag { font-size: 9px; font-family: 'JetBrains Mono', monospace; border: 1px solid; border-radius: 3px; padding: 1px 5px; }
  .risk-tag.risk-high { color: var(--red); border-color: var(--red); }
  .risk-tag.risk-medium { color: var(--orange); border-color: var(--orange); }
  .risk-tag.risk-low { color: var(--green); border-color: var(--green); }
  .module-stat { font-size: 10px; color: var(--text3); }
  .module-bar-track { height: 3px; background: var(--border); border-radius: 2px; overflow: hidden; }
  .module-bar-fill { height: 100%; border-radius: 2px; }

  .migration-plan { border-top: 1px solid var(--border); padding-top: 16px; display: flex; flex-direction: column; gap: 6px; }
  .mp-title { font-family: 'Syne', sans-serif; font-size: 12px; font-weight: 600; color: var(--text2); margin-bottom: 6px; }
  .mp-step { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border); }
  .mp-step.label-safe { border-color: #1a2e1a; }
  .mp-step.label-medium { border-color: #2e220a; }
  .mp-step.label-high { border-color: #2e0a14; }
  .mp-sprint { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--text3); min-width: 50px; }
  .mp-task { font-size: 12px; color: var(--text); flex: 1; }
  .mp-days { font-size: 11px; color: var(--text3); }
  .mp-badge { font-size: 10px; background: var(--surface2); border-radius: 4px; padding: 2px 6px; }

  .blame-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .blame-section-title { font-size: 11px; color: var(--text3); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; font-family: 'JetBrains Mono', monospace; }
  .blame-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--border); }
  .blame-row.hotspot { background: #1a080c; margin: 0 -8px; padding: 8px 8px; border-radius: var(--radius-sm); border-color: #3a1020; }
  .blame-name { font-size: 12px; color: var(--text); flex: 1; }
  .blame-p0 { font-size: 11px; font-family: 'JetBrains Mono', monospace; color: var(--red); }
  .blame-commits { font-size: 10px; color: var(--text3); }
  .blame-edge { font-size: 11px; color: var(--text3); }

  /* ── Context ── */
  .context-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; padding: 20px; overflow-y: auto; align-content: start; }
  .context-grid::-webkit-scrollbar { width: 4px; }
  .context-grid::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }
  .ctx-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; display: flex; flex-direction: column; gap: 6px; }
  .ctx-card.ctx-wide { grid-column: 1 / -1; }
  .ctx-title { font-family: 'Syne', sans-serif; font-size: 13px; font-weight: 700; color: var(--text); margin-bottom: 6px; }
  .deploy-row { display: flex; align-items: center; gap: 12px; padding: 6px 0; border-bottom: 1px solid var(--border); }
  .deploy-service { font-size: 12px; color: var(--text); flex: 1; }
  .deploy-ver { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent2); }
  .deploy-status { font-size: 11px; font-weight: 500; }
  .deploy-time { font-size: 11px; color: var(--text3); }

  /* ── Audit ── */
  .audit-wrap { flex: 1; overflow: hidden; display: flex; flex-direction: column; }
  .audit-list { flex: 1; overflow-y: auto; padding: 8px 16px; font-family: 'JetBrains Mono', monospace; }
  .audit-list::-webkit-scrollbar { width: 4px; }
  .audit-list::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }
  .audit-row { display: flex; gap: 12px; align-items: baseline; padding: 7px 0; border-bottom: 1px solid var(--border); font-size: 11px; }
  .audit-time { color: var(--text3); min-width: 80px; flex-shrink: 0; }
  .audit-action { min-width: 180px; flex-shrink: 0; font-weight: 500; }
  .act-error { color: var(--red); }
  .act-pipeline, .act-stage { color: var(--orange); }
  .act-gate { color: var(--blue); }
  .act-patch { color: var(--accent2); }
  .act-incident, .act-shadow, .act-deploy, .act-human { color: var(--green); }
  .act-root { color: var(--accent2); }
  .audit-data { color: var(--text3); flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }

  /* ── Modal ── */
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 100; backdrop-filter: blur(4px); }
  .modal { background: var(--surface); border: 1px solid var(--border2); border-radius: 14px; padding: 28px; width: 360px; display: flex; flex-direction: column; gap: 12px; }
  .modal-title { font-family: 'Syne', sans-serif; font-size: 18px; font-weight: 700; margin-bottom: 4px; }
  .modal-label { font-size: 11px; color: var(--text3); text-transform: uppercase; letter-spacing: 0.06em; }
  .modal-select { width: 100%; padding: 9px 12px; background: var(--surface2); border: 1px solid var(--border2); border-radius: var(--radius-sm); color: var(--text); font-size: 13px; font-family: 'DM Sans', sans-serif; }
  .sev-row { display: flex; gap: 8px; }
  .sev-btn { flex: 1; padding: 7px; background: var(--surface2); border: 1px solid var(--border2); border-radius: var(--radius-sm); color: var(--text2); font-family: 'JetBrains Mono', monospace; font-size: 12px; cursor: pointer; transition: all 0.15s; }
  .sev-btn.sev-sel { background: var(--surface3); font-weight: 600; }
  .modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }
`;
