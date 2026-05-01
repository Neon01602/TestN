// Context Reader — reads calendar, Slack, traffic, on-call signals
// Deploy Mesh — deploy scheduling and strategy selection
import { contextRelay } from '../services/contextRelay.js';

export class ContextReader {
  async read() {
    const teamCtx = contextRelay.get('team_context') || {};
    const metrics = contextRelay.get('system_metrics') || {};
    const onCall = contextRelay.get('current_on_call') || {};

    const demos = teamCtx.upcoming_demos || [];
    const nextDemo = demos[0];
    const minutesUntilDemo = nextDemo
      ? Math.floor((new Date(nextDemo.time) - Date.now()) / 60000)
      : null;

    const calendarFlag = nextDemo && minutesUntilDemo !== null && minutesUntilDemo < 60 && minutesUntilDemo > 0;
    const slackUrgency = Math.random() * 0.4; // simulated sentiment
    const trafficNormal = (metrics.p99_latency_ms || 142) < 300;
    const errorRateNormal = (metrics.error_rate || 0.003) < 0.01;

    const signals = {
      calendar: {
        flag: calendarFlag,
        next_event: nextDemo
          ? { title: nextDemo.title, minutes_away: minutesUntilDemo, attendees: nextDemo.attendees }
          : null,
        release_freeze: teamCtx.release_freeze || false
      },
      slack: {
        urgency_score: parseFloat(slackUrgency.toFixed(2)),
        active_incidents_in_channel: Math.floor(Math.random() * 3),
        sentiment: slackUrgency < 0.3 ? 'calm' : slackUrgency < 0.6 ? 'elevated' : 'critical'
      },
      traffic: {
        rps: metrics.rps || 1240,
        p99_latency_ms: metrics.p99_latency_ms || 142,
        error_rate: metrics.error_rate || 0.003,
        normal: trafficNormal && errorRateNormal
      },
      on_call: {
        engineer: onCall.name || 'Unknown',
        timezone: onCall.timezone || 'UTC',
        available: true
      }
    };

    let safetyScore = 1.0;
    if (calendarFlag) safetyScore -= 0.35;
    if (!trafficNormal) safetyScore -= 0.2;
    if (!errorRateNormal) safetyScore -= 0.15;
    if (slackUrgency > 0.5) safetyScore -= 0.1;
    if (teamCtx.release_freeze) safetyScore = 0.0;
    safetyScore = Math.max(0, parseFloat(safetyScore.toFixed(2)));

    let deployWindow;
    if (safetyScore >= 0.72) {
      deployWindow = { ready: true, recommendation: 'Deploy now — all signals green', minutes_until: 0 };
    } else if (calendarFlag && minutesUntilDemo !== null) {
      const bufferAfter = minutesUntilDemo + 30 + Math.floor(Math.random() * 20);
      deployWindow = { ready: false, recommendation: `Deploy in ${bufferAfter} minutes — post-demo window opens`, minutes_until: bufferAfter };
    } else {
      const waitMinutes = 20 + Math.floor(Math.random() * 25);
      deployWindow = { ready: false, recommendation: `Deploy in ${waitMinutes} minutes — traffic anomaly resolving`, minutes_until: waitMinutes };
    }

    return { signals, deploy_safety_score: safetyScore, deploy_window: deployWindow, read_at: new Date().toISOString() };
  }
}

export class DeployMesh {
  selectStrategy(contextResult, patch) {
    const risk = patch.estimated_risk;
    let strategy;

    if (risk <= 0.2) strategy = 'canary';
    else if (risk <= 0.4) strategy = 'blue-green';
    else if (risk <= 0.6) strategy = 'feature-flag';
    else strategy = 'canary'; // most conservative always

    const reasoning = {
      'canary': '5% traffic slice — fastest rollback, safest for medium-risk changes',
      'blue-green': 'Full parallel environment — instant cutover, instant rollback',
      'feature-flag': 'Code ships without activation — toggle per-user, no redeploy needed',
      'full': 'Direct 100% rollout — only for trivial configuration changes'
    };

    return {
      strategy,
      reasoning: reasoning[strategy],
      canary_percentage: strategy === 'canary' ? 5 : null,
      estimated_promote_after_minutes: strategy === 'canary' ? 15 : strategy === 'blue-green' ? 5 : 30,
      safety_score: contextResult.deploy_safety_score,
      window: contextResult.deploy_window,
      selected_at: new Date().toISOString()
    };
  }
}

export class ShadowDeploy {
  async run(durationMinutes = 15) {
    const anomaly = Math.random() < 0.1; // 10% chance of anomaly
    return {
      duration_minutes: durationMinutes,
      traffic_percentage: 5,
      shadow_metrics: {
        error_rate: anomaly ? 0.045 : 0.002 + Math.random() * 0.003,
        p99_latency_ms: anomaly ? 890 : 130 + Math.random() * 30,
        memory_mb: 245 + Math.random() * 20,
        cpu_percent: 18 + Math.random() * 8
      },
      prod_metrics: {
        error_rate: 0.003,
        p99_latency_ms: 142,
        memory_mb: 238,
        cpu_percent: 22
      },
      anomaly_detected: anomaly,
      decision: anomaly
        ? 'ABORT — error rate 15x above baseline in shadow'
        : 'PROMOTE — shadow metrics within acceptable bounds',
      completed_at: new Date().toISOString()
    };
  }
}
