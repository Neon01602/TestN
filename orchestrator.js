// Agent Orchestrator — LangGraph-style state machine pipeline
import { createIncident, AgentStage } from '../src/types/schemas.js';
import { ErrorIngestionAgent } from '../src/agents/errorIngestion.js';
import { RootCauseAgent } from '../src/agents/rootCause.js';
import { PatchWriterAgent } from '../src/agents/patchWriter.js';
import { ConfidenceGate } from '../src/agents/confidenceGate.js';
import { ContextReader, DeployMesh, ShadowDeploy } from '../src/agents/deployFabric.js';
import { contextRelay } from '../src/services/contextRelay.js';

export class Orchestrator {
  constructor(broadcastFn) {
    this.broadcast = broadcastFn;
    this.incidents = new Map();
    this.auditLog = [];
    this.metrics = { resolved: 0, auto_resolved: 0, total_mttr_ms: 0 };

    this.ingestion = new ErrorIngestionAgent((event, data) => this.handleErrorIngested(data));
    this.rootCause = new RootCauseAgent();
    this.patchWriter = new PatchWriterAgent();
    this.gate = new ConfidenceGate();
    this.contextReader = new ContextReader();
    this.deployMesh = new DeployMesh();
    this.shadowDeploy = new ShadowDeploy();
  }

  _updateIncident(id, updates) {
    const inc = this.incidents.get(id);
    if (!inc) return;
    Object.assign(inc, updates);
    this.incidents.set(id, inc);
    this.broadcast('incident_update', { incident: inc });
  }

  _log(action, data) {
    const entry = { action, data, timestamp: new Date().toISOString() };
    this.auditLog.unshift(entry);
    if (this.auditLog.length > 500) this.auditLog.pop();
    this.broadcast('audit_log', entry);
  }

  async handleErrorIngested(errorEvent) {
    const incident = createIncident(errorEvent);
    this.incidents.set(incident.id, incident);

    // Update context relay
    const active = contextRelay.get('active_incidents') || [];
    active.unshift({ id: incident.id, service: incident.service, severity: incident.severity });
    contextRelay.set('active_incidents', active.slice(0, 20));

    this.broadcast('incident_created', { incident, error_event: errorEvent });
    this._log('ERROR_INGESTED', { incident_id: incident.id, service: errorEvent.service, severity: errorEvent.severity });

    // Start pipeline
    await this.runPipeline(incident, errorEvent);
  }

  async ingestManual(rawError) {
    const event = this.ingestion.parse(rawError);
    await this.handleErrorIngested(event);
    return event;
  }

  async runPipeline(incident, errorEvent) {
    const startTime = Date.now();
    try {
      // Stage: Root Cause + Context Reader (parallel)
      this._updateIncident(incident.id, { stage: AgentStage.ROOT_CAUSE });
      this._log('STAGE_START', { stage: 'RootCause+ContextReader', incident_id: incident.id });

      const [rootCauseResult, contextResult] = await Promise.all([
        this.rootCause.analyze(errorEvent),
        this.contextReader.read()
      ]);

      this._updateIncident(incident.id, { root_cause: rootCauseResult, context: contextResult, stage: AgentStage.PATCH_WRITER });
      this._log('ROOT_CAUSE_COMPLETE', { incident_id: incident.id, confidence: rootCauseResult.confidence_score, cause: rootCauseResult.cause_commit });

      // Stage: Patch Writer
      const patchResult = await this.patchWriter.generate(errorEvent, rootCauseResult);
      this._updateIncident(incident.id, { patch: patchResult, stage: AgentStage.CONFIDENCE_GATE });
      this._log('PATCH_GENERATED', { incident_id: incident.id, sandbox_pass: patchResult.sandbox_pass, lines: patchResult.lines_changed });

      // Stage: Confidence Gate
      const gateResult = this.gate.evaluate(rootCauseResult, patchResult);
      this._updateIncident(incident.id, { gate: gateResult, stage: AgentStage.CONTEXT_READER });
      this._log('GATE_DECISION', { incident_id: incident.id, decision: gateResult.decision, confidence: gateResult.confidence_score, risk: gateResult.risk_score, audit_id: gateResult.audit_id });

      if (gateResult.decision === 'ESCALATE') {
        this._updateIncident(incident.id, { stage: AgentStage.FAILED, status: 'escalated' });
        this.broadcast('escalation', { incident_id: incident.id, gate: gateResult });
        return;
      }

      if (gateResult.decision === 'HUMAN_REVIEW') {
        this._updateIncident(incident.id, { stage: AgentStage.CONFIDENCE_GATE, status: 'awaiting_review' });
        this.broadcast('human_review_required', { incident_id: incident.id, gate: gateResult, sla_minutes: 15 });
        return; // Pipeline pauses — human must approve
      }

      // AUTO_EXECUTE path continues
      await this.proceedToDeploy(incident.id, contextResult, patchResult, startTime);

    } catch (err) {
      console.error('Pipeline error:', err);
      this._updateIncident(incident.id, { stage: AgentStage.FAILED, status: 'error', error: err.message });
      this._log('PIPELINE_ERROR', { incident_id: incident.id, error: err.message });
    }
  }

  async proceedToDeploy(incidentId, contextResult, patchResult, startTime) {
    const incident = this.incidents.get(incidentId);
    if (!incident) return;

    // Stage: Deploy Mesh
    this._updateIncident(incidentId, { stage: AgentStage.DEPLOY_MESH });
    const deployPlan = this.deployMesh.selectStrategy(contextResult, patchResult);
    this._log('DEPLOY_PLAN', { incident_id: incidentId, strategy: deployPlan.strategy, window: deployPlan.window });

    // Stage: Shadow Deploy
    this._updateIncident(incidentId, { deploy: deployPlan, stage: AgentStage.SHADOW_DEPLOY });
    const shadowResult = await this.shadowDeploy.run(15);
    this._log('SHADOW_DEPLOY', { incident_id: incidentId, anomaly: shadowResult.anomaly_detected, decision: shadowResult.decision });

    if (shadowResult.anomaly_detected) {
      this._updateIncident(incidentId, { shadow: shadowResult, stage: AgentStage.FAILED, status: 'shadow_abort' });
      this.broadcast('shadow_abort', { incident_id: incidentId, shadow: shadowResult });
      return;
    }

    // Complete
    const mttr = Date.now() - (startTime || Date.now());
    this._updateIncident(incidentId, {
      shadow: shadowResult,
      stage: AgentStage.COMPLETE,
      status: 'resolved',
      resolved_at: new Date().toISOString(),
      mttr_ms: mttr
    });

    this.metrics.resolved++;
    this.metrics.auto_resolved++;
    this.metrics.total_mttr_ms += mttr;

    // Update context relay
    const recentDeploys = contextRelay.get('recent_deploys') || [];
    recentDeploys.unshift({ service: incident.service, version: `v${Math.floor(2+Math.random()*3)}.${Math.floor(10+Math.random()*20)}.${Math.floor(1+Math.random()*9)}`, time: new Date().toISOString(), status: 'success' });
    contextRelay.set('recent_deploys', recentDeploys.slice(0, 10));

    this._log('INCIDENT_RESOLVED', { incident_id: incidentId, mttr_ms: mttr, auto: true });
    this.broadcast('incident_resolved', { incident_id: incidentId, mttr_ms: mttr });
  }

  async approveHumanReview(incidentId) {
    const incident = this.incidents.get(incidentId);
    if (!incident || !incident.context || !incident.patch) return { error: 'Incident not found or not awaiting review' };
    this._log('HUMAN_APPROVED', { incident_id: incidentId });
    await this.proceedToDeploy(incidentId, incident.context, incident.patch, Date.now());
    return { success: true };
  }

  async rejectHumanReview(incidentId, reason) {
    this._updateIncident(incidentId, { stage: AgentStage.FAILED, status: 'rejected' });
    this._log('HUMAN_REJECTED', { incident_id: incidentId, reason });
    return { success: true };
  }

  getStats() {
    const all = [...this.incidents.values()];
    return {
      total: all.length,
      active: all.filter(i => i.status === 'active').length,
      resolved: all.filter(i => i.status === 'resolved').length,
      awaiting_review: all.filter(i => i.status === 'awaiting_review').length,
      escalated: all.filter(i => i.status === 'escalated').length,
      avg_mttr_ms: this.metrics.resolved > 0 ? Math.floor(this.metrics.total_mttr_ms / this.metrics.resolved) : 0,
      auto_resolve_rate: this.metrics.resolved > 0 ? parseFloat((this.metrics.auto_resolved / this.metrics.resolved).toFixed(2)) : 0
    };
  }
}
