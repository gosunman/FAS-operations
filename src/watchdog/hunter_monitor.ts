// Hunter Heartbeat Monitor
// Periodically checks hunter's last heartbeat via Gateway API.
// Escalates from WARNING (Slack) to ALERT (Telegram) based on staleness.
// Sends RECOVERY notification when heartbeat resumes.

import type { NotificationRouter } from '../notification/router.js';

// === Configuration ===

export type HunterMonitorConfig = {
  // Gateway API base URL to check agent health
  gateway_url: string;
  // Check interval in milliseconds (default: 30_000 = 30s)
  check_interval_ms?: number;
  // Heartbeat age threshold for WARNING (Slack) — default: 120_000 = 2 min
  warning_threshold_ms?: number;
  // Heartbeat age threshold for ALERT (Telegram) — default: 300_000 = 5 min
  alert_threshold_ms?: number;
  // Notification router for sending warnings/alerts
  notification_router?: NotificationRouter;
  // Optional: custom fetch function (for testing)
  fetch_fn?: typeof fetch;
};

// === Internal state ===

type MonitorState = 'healthy' | 'warning' | 'alert' | 'unknown';

type HunterMonitorInstance = {
  state: MonitorState;
  timer: ReturnType<typeof setInterval> | null;
  last_check: Date | null;
};

// === Module-level singleton ===

let instance: HunterMonitorInstance = {
  state: 'unknown',
  timer: null,
  last_check: null,
};

// === Health check logic ===

// Parse agent health response from Gateway
const parse_hunter_heartbeat = async (
  gateway_url: string,
  fetch_fn: typeof fetch,
): Promise<{ alive: boolean; last_heartbeat: Date | null; age_ms: number }> => {
  try {
    const res = await fetch_fn(`${gateway_url}/api/agents/health`, {
      signal: AbortSignal.timeout(5_000),
    });

    if (!res.ok) {
      return { alive: false, last_heartbeat: null, age_ms: Infinity };
    }

    const data = await res.json() as {
      agents: Array<{
        name: string;
        status: string;
        last_heartbeat: string | null;
      }>;
    };

    const hunter = data.agents.find((a) => a.name === 'openclaw');
    if (!hunter || !hunter.last_heartbeat) {
      return { alive: false, last_heartbeat: null, age_ms: Infinity };
    }

    const last_hb = new Date(hunter.last_heartbeat);
    const age_ms = Date.now() - last_hb.getTime();

    return {
      alive: hunter.status === 'running',
      last_heartbeat: last_hb,
      age_ms,
    };
  } catch {
    // Network error — treat as unknown
    return { alive: false, last_heartbeat: null, age_ms: Infinity };
  }
};

// Determine new state based on heartbeat age
const evaluate_state = (
  age_ms: number,
  warning_threshold_ms: number,
  alert_threshold_ms: number,
): MonitorState => {
  if (age_ms <= warning_threshold_ms) return 'healthy';
  if (age_ms <= alert_threshold_ms) return 'warning';
  return 'alert';
};

// Send appropriate notification based on state transition
const notify_transition = async (
  prev_state: MonitorState,
  new_state: MonitorState,
  age_ms: number,
  router?: NotificationRouter,
): Promise<void> => {
  if (!router) return;

  const age_seconds = Math.floor(age_ms / 1000);

  // RECOVERY: was warning/alert, now healthy
  if ((prev_state === 'warning' || prev_state === 'alert') && new_state === 'healthy') {
    await router.route({
      type: 'milestone',
      message: `[RECOVERY] Hunter heartbeat resumed (was ${prev_state} for ${age_seconds}s)`,
      device: 'captain',
      severity: 'low',
    });
    return;
  }

  // ESCALATION: healthy → warning
  if (new_state === 'warning' && prev_state !== 'warning' && prev_state !== 'alert') {
    await router.route({
      type: 'error',
      message: `[WARNING] Hunter heartbeat stale (${age_seconds}s ago). Check hunter process.`,
      device: 'captain',
      severity: 'mid',
    });
    return;
  }

  // ESCALATION: warning → alert (or unknown → alert)
  if (new_state === 'alert' && prev_state !== 'alert') {
    await router.route({
      type: 'alert',
      message: `[ALERT] Hunter heartbeat DEAD (${age_seconds}s ago). Hunter may be down. Immediate attention needed.`,
      device: 'captain',
      severity: 'high',
    });
    return;
  }
};

// === Public API ===

export const start_hunter_monitor = (config: HunterMonitorConfig): void => {
  // Stop existing monitor if running
  if (instance.timer) {
    stop_hunter_monitor();
  }

  const check_interval = config.check_interval_ms ?? 30_000;
  const warning_threshold = config.warning_threshold_ms ?? 120_000;  // 2 min
  const alert_threshold = config.alert_threshold_ms ?? 300_000;      // 5 min
  const fetch_fn = config.fetch_fn ?? fetch;

  console.log(`[HunterMonitor] Starting — check every ${check_interval / 1000}s, warn at ${warning_threshold / 1000}s, alert at ${alert_threshold / 1000}s`);

  const check = async () => {
    const { age_ms } = await parse_hunter_heartbeat(config.gateway_url, fetch_fn);
    const new_state = evaluate_state(age_ms, warning_threshold, alert_threshold);

    if (new_state !== instance.state) {
      console.log(`[HunterMonitor] State transition: ${instance.state} → ${new_state} (age: ${Math.floor(age_ms / 1000)}s)`);
      await notify_transition(instance.state, new_state, age_ms, config.notification_router);
      instance.state = new_state;
    }

    instance.last_check = new Date();
  };

  // Run first check immediately
  check().catch((err) => {
    console.error('[HunterMonitor] Initial check failed:', err);
  });

  // Set up periodic checks
  instance.timer = setInterval(() => {
    check().catch((err) => {
      console.error('[HunterMonitor] Check failed:', err);
    });
  }, check_interval);

  // Allow process to exit without waiting for interval
  if (instance.timer.unref) {
    instance.timer.unref();
  }
};

export const stop_hunter_monitor = (): void => {
  if (instance.timer) {
    clearInterval(instance.timer);
    instance.timer = null;
    console.log('[HunterMonitor] Stopped');
  }
  instance.state = 'unknown';
  instance.last_check = null;
};

// Get current monitor state (for testing / status checks)
export const get_monitor_state = (): {
  state: MonitorState;
  last_check: Date | null;
  running: boolean;
} => ({
  state: instance.state,
  last_check: instance.last_check,
  running: instance.timer !== null,
});

// Export for testing
export const _test_internals = {
  parse_hunter_heartbeat,
  evaluate_state,
  notify_transition,
  reset: () => {
    stop_hunter_monitor();
    instance = { state: 'unknown', timer: null, last_check: null };
  },
};
