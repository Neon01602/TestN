// Context Relay — persistent shared memory between Build Engine and Deploy Fabric

const store = new Map();
const TTL_MS = 24 * 60 * 60 * 1000; // 24h

export const contextRelay = {
  set(key, value) {
    store.set(key, { value, expires: Date.now() + TTL_MS });
  },
  get(key) {
    const entry = store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) { store.delete(key); return null; }
    return entry.value;
  },
  delete(key) { store.delete(key); },
  all() {
    const result = {};
    for (const [k, v] of store.entries()) {
      if (Date.now() <= v.expires) result[k] = v.value;
    }
    return result;
  },
  init() {
    this.set('active_incidents', []);
    this.set('recent_deploys', [
      { service: 'auth-service', version: 'v3.2.1', time: new Date(Date.now() - 2 * 3600000).toISOString(), status: 'success' },
      { service: 'api-gateway', version: 'v1.9.4', time: new Date(Date.now() - 5 * 3600000).toISOString(), status: 'success' },
      { service: 'payments-service', version: 'v2.14.0', time: new Date(Date.now() - 24 * 3600000).toISOString(), status: 'success' }
    ]);
    this.set('current_on_call', { name: 'Alex Rivera', timezone: 'UTC-5', pagerduty_id: 'PD-8821' });
    this.set('team_context', {
      sprint: 24,
      release_freeze: false,
      upcoming_demos: [
        { title: 'Q2 Product Demo', time: new Date(Date.now() + 47 * 60000).toISOString(), attendees: ['VP Product', 'CEO'] }
      ]
    });
    this.set('risk_events', []);
    this.set('system_metrics', {
      error_rate: 0.003,
      rps: 1240,
      p99_latency_ms: 142,
      deploy_frequency: 4.2,
      mttr_avg_minutes: 8.3,
      rollback_rate: 0.04
    });
  }
};

contextRelay.init();
