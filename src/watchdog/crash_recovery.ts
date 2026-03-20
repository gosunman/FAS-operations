// FAS Crash Recovery Monitor
// Tracks agent crashes, manages restart decisions, and enforces
// a 3-strike isolation policy. After max_restarts consecutive failures,
// the agent should be isolated (alerting the owner).
//
// Crash history is persisted to a JSON file so it survives process restarts.
// Each agent has independent crash tracking.

import * as fs from 'node:fs';
import * as path from 'node:path';

// === Types ===

export type CrashRecord = {
  agent: string;
  crashed_at: string;
  error_message: string;
  restart_attempt: number;
};

export type CrashRecoveryConfig = {
  max_restarts: number;       // default: 3
  cooldown_ms: number;        // default: 30_000 (30 seconds)
  state_path: string;         // default: './state/crash_history.json'
};

// Internal state shape: { [agent]: CrashRecord[] }
type CrashState = Record<string, CrashRecord[]>;

// === Default config ===

const DEFAULT_CONFIG: CrashRecoveryConfig = {
  max_restarts: 3,
  cooldown_ms: 30_000,
  state_path: './state/crash_history.json',
};

// === Helpers ===

// Load state from disk, returning empty object if file doesn't exist
const load_state = (state_path: string): CrashState => {
  try {
    if (fs.existsSync(state_path)) {
      const raw = fs.readFileSync(state_path, 'utf-8');
      return JSON.parse(raw) as CrashState;
    }
  } catch {
    // Corrupted or unreadable state file — start fresh
  }
  return {};
};

// Persist state to disk, creating parent directories as needed
const save_state = (state_path: string, state: CrashState): void => {
  const dir = path.dirname(state_path);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(state_path, JSON.stringify(state, null, 2), 'utf-8');
};

// === Factory function ===

export const create_crash_monitor = (config?: Partial<CrashRecoveryConfig>) => {
  const cfg: CrashRecoveryConfig = { ...DEFAULT_CONFIG, ...config };

  // Load existing crash history from disk
  let state: CrashState = load_state(cfg.state_path);

  // --- record_crash: Record a crash event for an agent ---
  // Returns the new CrashRecord with incremented restart_attempt
  const record_crash = (agent: string, error_message: string): CrashRecord => {
    if (!state[agent]) {
      state[agent] = [];
    }

    const attempt = state[agent].length + 1;
    const record: CrashRecord = {
      agent,
      crashed_at: new Date().toISOString(),
      error_message,
      restart_attempt: attempt,
    };

    state[agent].push(record);
    save_state(cfg.state_path, state);

    return record;
  };

  // --- should_restart: Check if agent is allowed to restart ---
  // Returns true if crash count is below max_restarts
  const should_restart = (agent: string): boolean => {
    const history = state[agent] ?? [];
    return history.length < cfg.max_restarts;
  };

  // --- get_crash_history: Get all crash records for an agent ---
  const get_crash_history = (agent: string): CrashRecord[] => {
    return [...(state[agent] ?? [])];
  };

  // --- reset: Clear crash history for a specific agent ---
  // Allows the agent to be restarted fresh after manual intervention
  const reset = (agent: string): void => {
    state[agent] = [];
    save_state(cfg.state_path, state);
  };

  return {
    record_crash,
    should_restart,
    get_crash_history,
    reset,
  };
};

// === Export type for external use ===

export type CrashMonitor = ReturnType<typeof create_crash_monitor>;
