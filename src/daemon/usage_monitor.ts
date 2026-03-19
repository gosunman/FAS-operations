// Claude Code Usage Monitor for FAS Daemon
//
// Monitors Claude Code availability and automatically switches between
// normal mode (Claude Code) and fallback mode (Gemini CLI).
//
// Detection strategy:
//   Since Claude Code Max plan doesn't expose a usage API, we rely on
//   failure signal reporting from the daemon or watchdog:
//   - report_claude_failure('rate_limit') — called when Claude Code returns 429/quota error
//   - report_claude_success() — called when Claude Code responds successfully
//
// Mode transitions:
//   normal  → warning  (warning_threshold consecutive failures)
//   warning → fallback (failure_threshold consecutive failures)
//   fallback → normal  (Claude reports success)
//   any     → any      (force_mode() for manual override)
//
// Usage:
//   const monitor = create_usage_monitor({ failure_threshold: 5 });
//   monitor.on_mode_change((old_mode, new_mode) => { ... });
//   monitor.start();

// === Types ===

export type CaptainMode = 'normal' | 'warning' | 'fallback';

export type ClaudeFailureReason = 'rate_limit' | 'timeout' | 'error' | 'unknown';

export type UsageMonitorConfig = {
  failure_threshold?: number;     // Consecutive failures to trigger fallback (default: 5)
  warning_threshold?: number;     // Consecutive failures to trigger warning (default: 3)
  check_interval_ms?: number;     // Periodic check interval (default: 60_000)
};

export type UsageStatus = {
  mode: CaptainMode;
  claude_available: boolean;
  gemini_available: boolean;
  consecutive_failures: number;
  last_check: string;             // ISO 8601
  last_failure_reason?: ClaudeFailureReason;
};

type ModeChangeCallback = (old_mode: CaptainMode, new_mode: CaptainMode) => void;

// === Constants ===

const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_WARNING_THRESHOLD = 3;
const DEFAULT_CHECK_INTERVAL_MS = 60_000;
const LOG_PREFIX = '[UsageMonitor]';

// === Factory ===

export const create_usage_monitor = (config?: UsageMonitorConfig) => {
  const failure_threshold = config?.failure_threshold ?? DEFAULT_FAILURE_THRESHOLD;
  const warning_threshold = config?.warning_threshold ?? DEFAULT_WARNING_THRESHOLD;
  const check_interval_ms = config?.check_interval_ms ?? DEFAULT_CHECK_INTERVAL_MS;

  // Internal state
  let current_mode: CaptainMode = 'normal';
  let consecutive_failures = 0;
  let claude_available = true;
  let gemini_available = false; // Assume unavailable until checked
  let last_check = new Date().toISOString();
  let last_failure_reason: ClaudeFailureReason | undefined;
  let check_timer: ReturnType<typeof setInterval> | null = null;

  // Callbacks
  const mode_change_callbacks: ModeChangeCallback[] = [];

  // === Internal helpers ===

  /** Transition to a new mode and notify listeners */
  const transition_mode = (new_mode: CaptainMode): void => {
    if (current_mode === new_mode) return;

    const old_mode = current_mode;
    current_mode = new_mode;
    console.log(`${LOG_PREFIX} Mode transition: ${old_mode} → ${new_mode}`);

    // Notify all listeners
    for (const cb of mode_change_callbacks) {
      try {
        cb(old_mode, new_mode);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${LOG_PREFIX} Mode change callback error: ${msg}`);
      }
    }
  };

  /** Evaluate current failure state and transition if needed */
  const evaluate_state = (): void => {
    if (consecutive_failures >= failure_threshold) {
      claude_available = false;
      transition_mode('fallback');
    } else if (consecutive_failures >= warning_threshold) {
      transition_mode('warning');
    }
  };

  // === Public API ===

  /** Get the current operating mode */
  const get_mode = (): CaptainMode => current_mode;

  /** Get detailed status */
  const get_status = (): UsageStatus => ({
    mode: current_mode,
    claude_available,
    gemini_available,
    consecutive_failures,
    last_check,
    last_failure_reason,
  });

  /** Force a specific mode (manual override) */
  const force_mode = (mode: CaptainMode): void => {
    transition_mode(mode);
  };

  /** Register a callback for mode changes */
  const on_mode_change = (callback: ModeChangeCallback): void => {
    mode_change_callbacks.push(callback);
  };

  /** Report a Claude Code failure (called by daemon/watchdog) */
  const report_claude_failure = (reason: ClaudeFailureReason): void => {
    consecutive_failures += 1;
    last_failure_reason = reason;
    last_check = new Date().toISOString();
    console.log(
      `${LOG_PREFIX} Claude failure reported: ${reason} (${consecutive_failures}/${failure_threshold})`,
    );
    evaluate_state();
  };

  /** Report a Claude Code success (resets failure counter, auto-recovers) */
  const report_claude_success = (): void => {
    consecutive_failures = 0;
    claude_available = true;
    last_check = new Date().toISOString();
    last_failure_reason = undefined;

    // Auto-recover from fallback or warning to normal
    if (current_mode !== 'normal') {
      console.log(`${LOG_PREFIX} Claude recovered — switching back to normal mode`);
      transition_mode('normal');
    }
  };

  /** Start periodic monitoring */
  const start = (): void => {
    if (check_timer) return;
    console.log(`${LOG_PREFIX} Started (check every ${check_interval_ms}ms)`);
    check_timer = setInterval(() => {
      last_check = new Date().toISOString();
      // Periodic check is passive — actual detection relies on failure/success reports
      // This interval just keeps last_check timestamp fresh
    }, check_interval_ms);
  };

  /** Stop monitoring */
  const stop = (): void => {
    if (check_timer) {
      clearInterval(check_timer);
      check_timer = null;
    }
    console.log(`${LOG_PREFIX} Stopped`);
  };

  return {
    get_mode,
    get_status,
    force_mode,
    on_mode_change,
    report_claude_failure,
    report_claude_success,
    start,
    stop,
  };
};

export type UsageMonitor = ReturnType<typeof create_usage_monitor>;
