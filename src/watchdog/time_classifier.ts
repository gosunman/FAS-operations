// Time Classifier — classifies machine state as working, idle, or down
// based on process activity and CPU usage.
//
// States:
//   working: AI process active + CPU > threshold
//   idle: AI process active + CPU <= threshold
//   down: AI process not running or heartbeat failed
//
// Note: execSync is used here intentionally for system monitoring commands
// (pgrep, top) which take no user input — no injection risk.
// This follows the same pattern as resource_monitor.ts.

import { execSync } from 'node:child_process';
import type { MachineState, MachineTimeEntry } from '../shared/types.js';

// === Configuration ===

export type TimeClassifierConfig = {
  device: 'captain' | 'hunter';
  // CPU threshold to distinguish working vs idle (default: 10%)
  cpu_idle_threshold?: number;
  // Process names to check for activity
  process_names?: string[];
  // For hunter: gateway URL for heartbeat check
  hunter_gateway_url?: string;
  // Check interval in ms (default: 60_000)
  check_interval_ms?: number;
};

// === Default process names per device ===

const DEFAULT_PROCESS_NAMES: Record<string, string[]> = {
  captain: ['claude', 'node'],
  hunter: ['openclaw', 'node'],
};

// === Process checker (exported for testing) ===

/**
 * Check if any of the given process names are running.
 * Uses pgrep on macOS.
 * Safe: process names are from config constants, not user input.
 */
export const is_process_running = (names: string[]): boolean => {
  for (const name of names) {
    try {
      // pgrep returns 0 if match found, 1 if no match
      // Safe: hardcoded process names from DEFAULT_PROCESS_NAMES config
      execSync(`pgrep -f "${name}"`, { encoding: 'utf-8', timeout: 3_000 });
      return true;
    } catch {
      // pgrep returns exit code 1 = no match, which throws
      continue;
    }
  }
  return false;
};

/**
 * Get current CPU usage (simplified — reuses top command).
 * Returns combined user + sys percentage.
 * Safe: hardcoded command with no user input.
 */
export const get_current_cpu = (): number => {
  try {
    const output = execSync('top -l 1 -n 0', { encoding: 'utf-8', timeout: 10_000 });
    const match = output.match(/CPU usage:\s*([\d.]+)%\s*user,\s*([\d.]+)%\s*sys/);
    if (!match) return 0;
    return parseFloat(match[1]) + parseFloat(match[2]);
  } catch {
    return 0;
  }
};

/**
 * Check hunter heartbeat via gateway API.
 * Returns true if hunter is responsive (heartbeat < 2 minutes old).
 */
export const check_hunter_heartbeat = async (
  gateway_url: string,
  fetch_fn: typeof fetch = fetch,
): Promise<boolean> => {
  try {
    const res = await fetch_fn(`${gateway_url}/api/agents/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return false;
    const data = await res.json() as {
      agents: Array<{ name: string; status: string; last_heartbeat: string | null }>;
    };
    const hunter = data.agents.find((a) => a.name === 'openclaw');
    if (!hunter?.last_heartbeat) return false;
    const age_ms = Date.now() - new Date(hunter.last_heartbeat).getTime();
    return age_ms < 120_000; // less than 2 minutes old
  } catch {
    return false;
  }
};

// === Classify current state ===

export type ClassifyResult = {
  state: MachineState;
  cpu_percent: number;
  process_active: boolean;
};

/**
 * Classify current machine state for captain (synchronous — local checks only).
 */
export const classify_captain_state = (
  cpu_idle_threshold: number = 10,
  process_names: string[] = DEFAULT_PROCESS_NAMES.captain,
): ClassifyResult => {
  const process_active = is_process_running(process_names);
  const cpu_percent = get_current_cpu();

  if (!process_active) {
    return { state: 'down', cpu_percent, process_active };
  }

  if (cpu_percent > cpu_idle_threshold) {
    return { state: 'working', cpu_percent, process_active };
  }

  return { state: 'idle', cpu_percent, process_active };
};

/**
 * Classify hunter state (async — requires heartbeat check).
 */
export const classify_hunter_state = async (
  gateway_url: string,
  fetch_fn: typeof fetch = fetch,
): Promise<ClassifyResult> => {
  const heartbeat_ok = await check_hunter_heartbeat(gateway_url, fetch_fn);

  if (!heartbeat_ok) {
    return { state: 'down', cpu_percent: 0, process_active: false };
  }

  // Hunter is alive — we can't directly check CPU so assume working
  // (hunter_monitor.ts handles detailed health tracking)
  return { state: 'working', cpu_percent: 0, process_active: true };
};

// === Time Classifier with history tracking ===

export type TimeClassifier = {
  classify: () => Promise<ClassifyResult>;
  get_history: () => MachineTimeEntry[];
  get_summary: () => { working_ms: number; idle_ms: number; down_ms: number };
  start: () => void;
  stop: () => void;
  reset: () => void;
};

export const create_time_classifier = (config: TimeClassifierConfig): TimeClassifier => {
  const cpu_idle_threshold = config.cpu_idle_threshold ?? 10;
  const process_names = config.process_names ?? DEFAULT_PROCESS_NAMES[config.device] ?? ['node'];
  const check_interval = config.check_interval_ms ?? 60_000;

  let timer: ReturnType<typeof setInterval> | null = null;
  let last_state: MachineState | null = null;
  let last_check_time: number = Date.now();
  const history: MachineTimeEntry[] = [];

  // Classify based on device type
  const classify = async (): Promise<ClassifyResult> => {
    if (config.device === 'hunter' && config.hunter_gateway_url) {
      return classify_hunter_state(config.hunter_gateway_url);
    }
    return classify_captain_state(cpu_idle_threshold, process_names);
  };

  // Record state transition
  const record_state = (result: ClassifyResult): void => {
    const now = Date.now();
    const duration_ms = now - last_check_time;

    if (last_state !== null) {
      history.push({
        timestamp: new Date(last_check_time).toISOString(),
        state: last_state,
        duration_ms,
      });
    }

    last_state = result.state;
    last_check_time = now;
  };

  // Get full history (defensive copy)
  const get_history = (): MachineTimeEntry[] => [...history];

  // Get summary totals
  const get_summary = (): { working_ms: number; idle_ms: number; down_ms: number } => {
    const summary = { working_ms: 0, idle_ms: 0, down_ms: 0 };
    for (const entry of history) {
      if (entry.state === 'working') summary.working_ms += entry.duration_ms;
      else if (entry.state === 'idle') summary.idle_ms += entry.duration_ms;
      else summary.down_ms += entry.duration_ms;
    }
    // Include current state duration (time since last check)
    if (last_state) {
      const current_duration = Date.now() - last_check_time;
      if (last_state === 'working') summary.working_ms += current_duration;
      else if (last_state === 'idle') summary.idle_ms += current_duration;
      else summary.down_ms += current_duration;
    }
    return summary;
  };

  // Start periodic classification
  const start = (): void => {
    if (timer) return;
    // Initial classification
    classify().then(record_state).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[TimeClassifier] Initial classify error: ${msg}`);
    });
    timer = setInterval(() => {
      classify().then(record_state).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[TimeClassifier] Periodic classify error: ${msg}`);
      });
    }, check_interval);
    if (timer.unref) timer.unref();
  };

  // Stop periodic classification and record final duration
  const stop = (): void => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    // Record final duration for current state
    if (last_state) {
      history.push({
        timestamp: new Date(last_check_time).toISOString(),
        state: last_state,
        duration_ms: Date.now() - last_check_time,
      });
    }
  };

  // Reset all state
  const reset = (): void => {
    history.length = 0;
    last_state = null;
    last_check_time = Date.now();
  };

  return { classify, get_history, get_summary, start, stop, reset };
};
