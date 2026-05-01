// Core type definitions and schemas for NEX-US platform

export const Severity = { P0: 'P0', P1: 'P1', P2: 'P2', P3: 'P3' };

export const AgentStage = {
  ERROR_INGESTION: 'ErrorIngestion',
  ROOT_CAUSE: 'RootCause',
  PATCH_WRITER: 'PatchWriter',
  CONFIDENCE_GATE: 'ConfidenceGate',
  CONTEXT_READER: 'ContextReader',
  DEPLOY_MESH: 'DeployMesh',
  SHADOW_DEPLOY: 'ShadowDeploy',
  COMPLETE: 'Complete',
  FAILED: 'Failed'
};

export const GateDecision = {
  AUTO_EXECUTE: 'AUTO_EXECUTE',
  HUMAN_REVIEW: 'HUMAN_REVIEW',
  ESCALATE: 'ESCALATE'
};

export function createErrorEvent({ service, severity, stackTrace, endpoints = [] }) {
  return {
    error_id: `ERR-${Date.now()}`,
    stack_trace: stackTrace,
    service,
    severity,
    timestamp: new Date().toISOString(),
    affected_endpoints: endpoints
  };
}

export function createIncident(errorEvent) {
  return {
    id: `INC-${Math.floor(1000 + Math.random() * 9000)}`,
    error_id: errorEvent.error_id,
    service: errorEvent.service,
    severity: errorEvent.severity,
    timestamp: errorEvent.timestamp,
    stage: AgentStage.ERROR_INGESTION,
    status: 'active',
    agents: [],
    patch: null,
    deploy: null,
    resolved_at: null,
    mttr: null
  };
}
