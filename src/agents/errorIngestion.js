// Error Ingestion Agent — monitors and parses error streams
import { AgentStage, Severity } from '../types/schemas.js';

const SAMPLE_SERVICES = ['payments-service', 'auth-service', 'api-gateway', 'user-service', 'notification-service', 'search-service'];
const SAMPLE_STACKS = {
  'payments-service': `TypeError: Cannot read properties of undefined (reading 'amount')
    at validatePayment (/app/src/payments/validator.js:47:23)
    at processCheckout (/app/src/checkout/handler.js:112:5)
    at Layer.handle [as handle_request] (/app/node_modules/express/lib/router/layer.js:95:5)`,
  'auth-service': `JWT TokenExpiredError: jwt expired
    at /verify (/app/src/auth/jwt.js:84:12)
    at middleware (/app/src/middleware/auth.js:29:7)
    at Layer.handle (/app/node_modules/express/lib/router/layer.js:95:5)`,
  'api-gateway': `ECONNREFUSED connect ECONNREFUSED 10.0.1.45:8080
    at TCPConnectWrap.afterConnect [as oncomplete] (net.js:1148:16)
    at upstream_proxy (/app/src/proxy/upstream.js:203:11)`,
  'user-service': `ValidationError: "email" must be a valid email
    at Object.assert (/app/node_modules/joi/lib/validator.js:104:26)
    at exports.validate (/app/src/users/schema.js:18:3)`,
  'notification-service': `Error: Redis connection lost
    at Socket.<anonymous> (/app/node_modules/ioredis/built/Redis.js:180:26)
    at notifyQueue (/app/src/queue/notify.js:55:12)`,
  'search-service': `elasticsearch.exceptions.ConnectionError: Connection refused
    at SearchClient.search (/app/src/search/client.py:88)
    at handle_query (/app/src/handlers/search.py:45)`
};

export class ErrorIngestionAgent {
  constructor(emitFn) {
    this.emit = emitFn;
    this.running = false;
    this.interval = null;
  }

  parse(rawError) {
    const service = rawError.service || SAMPLE_SERVICES[Math.floor(Math.random() * SAMPLE_SERVICES.length)];
    return {
      error_id: `ERR-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
      stack_trace: rawError.stack_trace || SAMPLE_STACKS[service] || SAMPLE_STACKS['payments-service'],
      service,
      severity: rawError.severity || (Math.random() < 0.15 ? Severity.P0 : Math.random() < 0.35 ? Severity.P1 : Severity.P2),
      timestamp: new Date().toISOString(),
      affected_endpoints: rawError.affected_endpoints || [`/${service.replace('-service', '')}/api`],
      blast_radius: this._estimateBlastRadius(service)
    };
  }

  _estimateBlastRadius(service) {
    const map = {
      'payments-service': ['checkout', 'cart', 'orders'],
      'auth-service': ['all authenticated routes'],
      'api-gateway': ['all downstream services'],
      'user-service': ['profile', 'settings'],
      'notification-service': ['email', 'push', 'sms'],
      'search-service': ['search', 'recommendations']
    };
    return map[service] || ['unknown'];
  }

  startAutoIngest(intervalMs = 45000) {
    if (this.running) return;
    this.running = true;
    this.interval = setInterval(() => {
      if (Math.random() < 0.4) {
        const service = SAMPLE_SERVICES[Math.floor(Math.random() * SAMPLE_SERVICES.length)];
        const event = this.parse({ service });
        this.emit('error_ingested', event);
      }
    }, intervalMs);
  }

  stop() {
    this.running = false;
    if (this.interval) clearInterval(this.interval);
  }
}
