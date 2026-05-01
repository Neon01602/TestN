// Refactor Coach and Blame Graph Engine

const MODULE_DATA = [
  { name: 'auth/jwt.js', refactor_risk: 0.81, test_coverage: 34, last_modified_days: 847, dependency_count: 12, loc: 4847 },
  { name: 'payments/validator.js', refactor_risk: 0.67, test_coverage: 52, last_modified_days: 14, dependency_count: 8, loc: 892 },
  { name: 'api-gateway/proxy.js', refactor_risk: 0.74, test_coverage: 41, last_modified_days: 120, dependency_count: 15, loc: 2341 },
  { name: 'user/schema.js', refactor_risk: 0.45, test_coverage: 78, last_modified_days: 7, dependency_count: 4, loc: 445 },
  { name: 'search/client.py', refactor_risk: 0.58, test_coverage: 62, last_modified_days: 45, dependency_count: 7, loc: 1203 },
  { name: 'notification/queue.js', refactor_risk: 0.72, test_coverage: 29, last_modified_days: 200, dependency_count: 11, loc: 1876 },
  { name: 'orders/controller.js', refactor_risk: 0.39, test_coverage: 85, last_modified_days: 3, dependency_count: 6, loc: 678 },
  { name: 'checkout/handler.js', refactor_risk: 0.61, test_coverage: 55, last_modified_days: 30, dependency_count: 9, loc: 1124 }
];

export class RefactorCoach {
  scan() {
    const modules = MODULE_DATA.map(m => ({
      ...m,
      risk_level: m.refactor_risk >= 0.7 ? 'HIGH' : m.refactor_risk >= 0.45 ? 'MEDIUM' : 'LOW',
      circular_deps: m.dependency_count > 10 ? Math.floor(m.dependency_count / 4) : 0
    }));

    modules.sort((a, b) => b.refactor_risk - a.refactor_risk);

    const topRisk = modules[0];
    const migrationPlan = this._generateMigrationPlan(topRisk);

    return {
      scanned_at: new Date().toISOString(),
      modules,
      top_risk_module: topRisk,
      migration_plan: migrationPlan,
      tech_debt_score: parseFloat((modules.reduce((s, m) => s + m.refactor_risk, 0) / modules.length).toFixed(2)),
      circular_dependencies_total: modules.reduce((s, m) => s + m.circular_deps, 0)
    };
  }

  _generateMigrationPlan(module) {
    return [
      { sprint: 1, label: 'safe', task: `Extract ${module.name.split('/')[1]} utility functions → standalone lib`, risk: 0.12, estimated_days: 3 },
      { sprint: 2, label: 'safe', task: 'Add test coverage to core paths (target: 70%)', risk: 0.08, estimated_days: 5 },
      { sprint: 3, label: 'medium', task: 'Decompose primary class into strategy pattern', risk: 0.44, estimated_days: 8 },
      { sprint: 4, label: 'medium', task: 'Break circular dependencies', risk: 0.41, estimated_days: 6 },
      { sprint: 5, label: 'high', task: 'Refactor session/state management', risk: 0.68, estimated_days: 10, human_gate: true },
      { sprint: 6, label: 'high', task: 'Migrate to new standards — shadow deploy 48h before cutover', risk: 0.72, estimated_days: 12, shadow_required: true }
    ];
  }
}

export class BlameGraph {
  generate() {
    const teams = ['backend-core', 'platform', 'checkout', 'auth-team', 'infra'];
    const nodes = [];
    const edges = [];

    teams.forEach((team, i) => {
      nodes.push({
        id: `team-${i}`,
        label: team,
        type: 'team',
        p0_rate: parseFloat((Math.random() * 0.08).toFixed(3)),
        avg_commits_per_week: Math.floor(8 + Math.random() * 20)
      });
    });

    ['payments', 'auth', 'api-gateway', 'user', 'notifications'].forEach((svc, i) => {
      nodes.push({ id: `svc-${i}`, label: `${svc}-service`, type: 'service' });
      const teamIdx = i % teams.length;
      edges.push({ from: `team-${teamIdx}`, to: `svc-${i}`, weight: 0.4 + Math.random() * 0.6, label: 'owns' });
    });

    return {
      nodes,
      edges,
      hotspot_team: teams[0],
      hotspot_rate: '3x P0 rate vs average',
      generated_at: new Date().toISOString()
    };
  }
}
