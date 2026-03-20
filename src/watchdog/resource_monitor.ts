// FAS Resource Monitor (macOS)
// Monitors system resources (CPU, memory, disk) and AI provider usage,
// fires alerts when thresholds are exceeded.
//
// System resource monitoring uses macOS-specific commands:
//   - top -l 1 -n 0  → CPU usage
//   - vm_stat + sysctl → memory usage
//   - df -g /         → disk usage
//
// AI usage tracking:
//   - Claude Code Max: track via success/failure signals (no official usage API)
//   - Gemini CLI: track via success/failure
//   - ChatGPT Pro (hunter): track via task completion rates
//
// Alert thresholds:
//   - CPU > 90% sustained → alert
//   - RAM > 85% → alert
//   - Disk > 80% → alert
//   - AI usage > 70% daily budget → warning, > 90% → critical
//
// Note: execSync is used here intentionally for system monitoring commands
// (top, vm_stat, sysctl, df) which take no user input — no injection risk.

import { execSync } from 'node:child_process';
import type { ResourceSnapshot, ResourceThresholds, NotificationEvent } from '../shared/types.js';

// === Alert severity levels ===

export type AlertSeverity = 'warning' | 'critical';

export type ResourceAlert = {
  metric: string;
  value: number;
  threshold: number;
  severity: AlertSeverity;
  sustained_count: number; // how many consecutive checks exceeded
};

// === Config type ===

export type ResourceMonitorConfig = {
  thresholds?: Partial<ResourceThresholds>;
  check_interval_ms?: number; // default: 60_000
  on_alert: (metric: string, value: number, threshold: number) => void | Promise<void>;
};

// === Telegram alert thresholds (separate from basic thresholds) ===

export type TelegramAlertThresholds = {
  cpu_percent: number;         // default: 90  — CPU > 90% sustained
  cpu_sustained_count: number; // default: 3   — must exceed for N consecutive checks
  memory_percent: number;      // default: 85  — RAM > 85% → immediate warning
  disk_percent: number;        // default: 90  — Disk > 90% → immediate critical
  cooldown_ms: number;         // default: 300_000 (5 min) — suppress duplicate alerts
};

export type TelegramAlertConfig = {
  thresholds?: Partial<TelegramAlertThresholds>;
  send_notification: (event: NotificationEvent) => Promise<unknown>;
  device_name?: 'captain' | 'hunter'; // default: 'captain'
};

const DEFAULT_TELEGRAM_THRESHOLDS: TelegramAlertThresholds = {
  cpu_percent: 90,
  cpu_sustained_count: 3,
  memory_percent: 85,
  disk_percent: 90,
  cooldown_ms: 300_000, // 5 minutes
};

// === Default thresholds ===

const DEFAULT_THRESHOLDS: ResourceThresholds = {
  cpu_percent: 85,
  memory_percent: 90,
  disk_percent: 85,
};

// === macOS-specific parsers (exported for testing) ===

/**
 * Parse CPU usage from `top -l 1 -n 0` output.
 * Looks for line like: "CPU usage: 45.2% user, 12.3% sys, 42.5% idle"
 * Returns combined user + sys percentage.
 */
export const parse_cpu_usage = (): number => {
  try {
    // Safe: hardcoded command with no user input
    const output = execSync('top -l 1 -n 0', { encoding: 'utf-8', timeout: 10_000 });
    const match = output.match(/CPU usage:\s*([\d.]+)%\s*user,\s*([\d.]+)%\s*sys/);
    if (!match) return 0;
    return parseFloat(match[1]) + parseFloat(match[2]);
  } catch {
    return 0;
  }
};

/**
 * Parse memory usage from `vm_stat` and `sysctl -n hw.memsize`.
 * vm_stat reports pages (page size = 16384 on Apple Silicon, 4096 on Intel).
 * sysctl -n hw.memsize returns total bytes.
 */
export const parse_memory_usage = (): { used_mb: number; total_mb: number } => {
  try {
    // Safe: hardcoded commands with no user input
    const total_bytes = parseInt(
      execSync('sysctl -n hw.memsize', { encoding: 'utf-8', timeout: 5_000 }).trim(),
      10,
    );
    const total_mb = total_bytes / (1024 * 1024);

    const vm_output = execSync('vm_stat', { encoding: 'utf-8', timeout: 5_000 });

    // Extract page size from first line: "Mach Virtual Memory Statistics: (page size of XXXX bytes)"
    const page_size_match = vm_output.match(/page size of (\d+) bytes/);
    const page_size = page_size_match ? parseInt(page_size_match[1], 10) : 16384;

    // Parse page counts — vm_stat uses "Pages free:", "Pages inactive:", etc.
    const parse_pages = (label: string): number => {
      const regex = new RegExp(`${label}:\\s*(\\d+)`);
      const m = vm_output.match(regex);
      return m ? parseInt(m[1], 10) : 0;
    };

    const free = parse_pages('Pages free');
    const inactive = parse_pages('Pages inactive');
    const speculative = parse_pages('Pages speculative');

    // Available = free + inactive + speculative (rough approximation)
    const available_mb = (free + inactive + speculative) * page_size / (1024 * 1024);
    const used_mb = total_mb - available_mb;

    return { used_mb: Math.round(used_mb), total_mb: Math.round(total_mb) };
  } catch {
    return { used_mb: 0, total_mb: 0 };
  }
};

/**
 * Parse disk usage from `df -g /`.
 * Output format:
 *   Filesystem  1G-blocks  Used Available Capacity
 *   /dev/disk3s1  460  230  200  54%
 */
export const parse_disk_usage = (): { used_gb: number; total_gb: number } => {
  try {
    // Safe: hardcoded command with no user input
    const output = execSync('df -g /', { encoding: 'utf-8', timeout: 5_000 });
    const lines = output.trim().split('\n');
    // Data is on the second line
    if (lines.length < 2) return { used_gb: 0, total_gb: 0 };

    const parts = lines[1].trim().split(/\s+/);
    // parts: [filesystem, 1G-blocks, Used, Available, Capacity, ...]
    if (parts.length < 4) return { used_gb: 0, total_gb: 0 };

    const total_gb = parseInt(parts[1], 10);
    const used_gb = parseInt(parts[2], 10);

    return {
      used_gb: isNaN(used_gb) ? 0 : used_gb,
      total_gb: isNaN(total_gb) ? 0 : total_gb,
    };
  } catch {
    return { used_gb: 0, total_gb: 0 };
  }
};

// === Resource Monitor (returned interface) ===

export type ResourceMonitor = {
  take_snapshot: () => ResourceSnapshot;
  check: () => Promise<ResourceSnapshot>;
  start: () => void;
  stop: () => void;
};

// === Factory function ===

export const create_resource_monitor = (config: ResourceMonitorConfig): ResourceMonitor => {
  const thresholds: ResourceThresholds = {
    ...DEFAULT_THRESHOLDS,
    ...config.thresholds,
  };
  const interval_ms = config.check_interval_ms ?? 60_000;
  let timer: ReturnType<typeof setInterval> | null = null;

  // Capture current system resource state
  const take_snapshot = (): ResourceSnapshot => {
    const cpu_usage_percent = parse_cpu_usage();
    const { used_mb, total_mb } = parse_memory_usage();
    const { used_gb, total_gb } = parse_disk_usage();

    return {
      timestamp: new Date().toISOString(),
      cpu_usage_percent,
      memory_used_mb: used_mb,
      memory_total_mb: total_mb,
      disk_used_gb: used_gb,
      disk_total_gb: total_gb,
    };
  };

  // Take snapshot and fire alerts for any threshold violations
  const check = async (): Promise<ResourceSnapshot> => {
    const snapshot = take_snapshot();

    // Check CPU threshold
    if (snapshot.cpu_usage_percent > thresholds.cpu_percent) {
      await config.on_alert('cpu', snapshot.cpu_usage_percent, thresholds.cpu_percent);
    }

    // Check memory threshold (compute percentage from used/total)
    if (snapshot.memory_total_mb > 0) {
      const memory_percent = (snapshot.memory_used_mb / snapshot.memory_total_mb) * 100;
      if (memory_percent > thresholds.memory_percent) {
        await config.on_alert('memory', memory_percent, thresholds.memory_percent);
      }
    }

    // Check disk threshold (compute percentage from used/total)
    if (snapshot.disk_total_gb > 0) {
      const disk_percent = (snapshot.disk_used_gb / snapshot.disk_total_gb) * 100;
      if (disk_percent > thresholds.disk_percent) {
        await config.on_alert('disk', disk_percent, thresholds.disk_percent);
      }
    }

    return snapshot;
  };

  // Start periodic checking
  const start = (): void => {
    if (timer) return; // already running
    timer = setInterval(() => {
      check().catch(() => {
        // Swallow errors in periodic checks — alert callback might throw
      });
    }, interval_ms);
  };

  // Stop periodic checking
  const stop = (): void => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  return { take_snapshot, check, start, stop };
};

// === Telegram Alert Handler Factory ===
// Creates an on_alert callback that sends threshold violations to Telegram
// with sustained CPU checking, cooldown, and severity classification.

export type TelegramAlertHandler = {
  on_alert: (metric: string, value: number, threshold: number) => Promise<void>;
  get_cpu_breach_count: () => number;
  get_last_alert_times: () => Record<string, number>;
  reset: () => void;
};

export const create_telegram_alert_handler = (
  config: TelegramAlertConfig,
): TelegramAlertHandler => {
  const thresholds: TelegramAlertThresholds = {
    ...DEFAULT_TELEGRAM_THRESHOLDS,
    ...config.thresholds,
  };
  const device = config.device_name ?? 'captain';

  // State: consecutive CPU breach count
  let cpu_breach_count = 0;

  // State: last alert timestamp per metric (for cooldown)
  const last_alert_times: Record<string, number> = {};

  // Check if cooldown period has elapsed for a metric
  const is_on_cooldown = (metric: string, now: number): boolean => {
    const last = last_alert_times[metric];
    if (!last) return false;
    return (now - last) < thresholds.cooldown_ms;
  };

  // Format the alert message for Telegram
  const format_alert_message = (
    metric: string,
    value: number,
    threshold: number,
    severity: AlertSeverity,
  ): string => {
    const emoji = severity === 'critical' ? '🔴' : '🟡';
    const level = severity === 'critical' ? 'CRITICAL' : 'WARNING';
    const metric_label = metric === 'cpu' ? 'CPU'
      : metric === 'memory' ? 'RAM'
      : metric === 'disk' ? 'Disk'
      : metric.toUpperCase();

    return [
      `${emoji} *[${level}] Resource Alert — ${device}*`,
      '',
      `*${metric_label}:* ${value.toFixed(1)}% (threshold: ${threshold}%)`,
      metric === 'cpu' ? `*Sustained:* ${cpu_breach_count} consecutive checks` : '',
      '',
      `_${new Date().toISOString()}_`,
    ].filter(Boolean).join('\n');
  };

  // Main alert handler
  const on_alert = async (
    metric: string,
    value: number,
    _threshold: number, // original monitor threshold — we use our own
  ): Promise<void> => {
    const now = Date.now();

    // === CPU: sustained check (must exceed N consecutive times) ===
    if (metric === 'cpu') {
      if (value > thresholds.cpu_percent) {
        cpu_breach_count++;
      } else {
        cpu_breach_count = 0;
        return; // below telegram threshold, reset and skip
      }

      // Only alert after sustained_count consecutive breaches
      if (cpu_breach_count < thresholds.cpu_sustained_count) {
        return;
      }

      // Cooldown check
      if (is_on_cooldown('cpu', now)) return;
      last_alert_times['cpu'] = now;

      const message = format_alert_message('cpu', value, thresholds.cpu_percent, 'warning');
      const event: NotificationEvent = {
        type: 'alert',
        message,
        device,
        severity: 'high',
        metadata: { metric: 'cpu', value, threshold: thresholds.cpu_percent, sustained: cpu_breach_count },
      };
      await config.send_notification(event);
      return;
    }

    // === Memory: immediate warning ===
    if (metric === 'memory') {
      if (value <= thresholds.memory_percent) return;
      if (is_on_cooldown('memory', now)) return;
      last_alert_times['memory'] = now;

      const message = format_alert_message('memory', value, thresholds.memory_percent, 'warning');
      const event: NotificationEvent = {
        type: 'alert',
        message,
        device,
        severity: 'high',
        metadata: { metric: 'memory', value, threshold: thresholds.memory_percent },
      };
      await config.send_notification(event);
      return;
    }

    // === Disk: immediate critical ===
    if (metric === 'disk') {
      if (value <= thresholds.disk_percent) return;
      if (is_on_cooldown('disk', now)) return;
      last_alert_times['disk'] = now;

      const message = format_alert_message('disk', value, thresholds.disk_percent, 'critical');
      const event: NotificationEvent = {
        type: 'alert',
        message,
        device,
        severity: 'critical',
        metadata: { metric: 'disk', value, threshold: thresholds.disk_percent },
      };
      await config.send_notification(event);
      return;
    }
  };

  // Accessors for testing
  const get_cpu_breach_count = () => cpu_breach_count;
  const get_last_alert_times = () => ({ ...last_alert_times });
  const reset = () => {
    cpu_breach_count = 0;
    for (const key of Object.keys(last_alert_times)) {
      delete last_alert_times[key];
    }
  };

  return { on_alert, get_cpu_breach_count, get_last_alert_times, reset };
};

// ============================================================
// AI Usage Tracker
// ============================================================
//
// Tracks request counts, success rates, and estimated usage percentage
// per AI provider. Since none of these services expose a real-time usage
// API, we rely on caller-reported success/failure signals and known plan
// limits to estimate daily consumption.

// === AI Provider types ===

export type AIProvider = 'claude' | 'gemini' | 'chatgpt';

export type AIProviderPlanLimits = {
  daily_request_limit: number;  // estimated max requests per day for the plan
};

export type AIProviderStats = {
  provider: AIProvider;
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  success_rate: number;           // 0-100 percentage
  estimated_usage_pct: number;    // 0-100 based on daily plan limits
  last_request_at: string | null; // ISO 8601
  last_failure_reason?: string;
};

export type AIUsageSummary = {
  date: string; // YYYY-MM-DD
  providers: AIProviderStats[];
  overall_estimated_usage_pct: number; // weighted average across providers
};

export type AIUsageAlertLevel = 'none' | 'warning' | 'critical';

export type AIUsageThresholds = {
  warning_pct: number;   // default: 70 — daily budget warning
  critical_pct: number;  // default: 90 — daily budget critical
};

export type AIUsageAlert = {
  provider: AIProvider;
  level: AIUsageAlertLevel;
  usage_pct: number;
  threshold: number;
};

export type AIUsageTrackerConfig = {
  plan_limits?: Partial<Record<AIProvider, AIProviderPlanLimits>>;
  thresholds?: Partial<AIUsageThresholds>;
  on_alert?: (alert: AIUsageAlert) => void | Promise<void>;
};

// === Default plan limits (conservative estimates) ===
// These are rough estimates — adjust based on actual plan observations

const DEFAULT_PLAN_LIMITS: Record<AIProvider, AIProviderPlanLimits> = {
  claude: { daily_request_limit: 200 },   // Claude Code Max — estimated
  gemini: { daily_request_limit: 300 },   // Gemini CLI free tier
  chatgpt: { daily_request_limit: 100 },  // ChatGPT Pro via OpenClaw
};

const DEFAULT_AI_THRESHOLDS: AIUsageThresholds = {
  warning_pct: 70,
  critical_pct: 90,
};

const AI_LOG_PREFIX = '[AIUsageTracker]';

// === Internal per-provider state ===

type ProviderState = {
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  last_request_at: string | null;
  last_failure_reason?: string;
  last_alert_level: AIUsageAlertLevel;
};

// === Factory ===

export const create_ai_usage_tracker = (config?: AIUsageTrackerConfig) => {
  const plan_limits: Record<AIProvider, AIProviderPlanLimits> = {
    ...DEFAULT_PLAN_LIMITS,
    ...config?.plan_limits,
  };
  const thresholds: AIUsageThresholds = {
    ...DEFAULT_AI_THRESHOLDS,
    ...config?.thresholds,
  };

  // State per provider
  let current_day = _get_day_key_util(new Date());
  const providers: Record<AIProvider, ProviderState> = {
    claude: _make_empty_state(),
    gemini: _make_empty_state(),
    chatgpt: _make_empty_state(),
  };

  // === Internal helpers ===

  /** Check if day has rolled over, reset counters if needed */
  const _check_day_reset = (): void => {
    const today = _get_day_key_util(new Date());
    if (today !== current_day) {
      console.log(`${AI_LOG_PREFIX} Day changed (${current_day} → ${today}), resetting counters`);
      current_day = today;
      for (const key of Object.keys(providers) as AIProvider[]) {
        providers[key] = _make_empty_state();
      }
    }
  };

  /** Compute estimated usage % for a provider */
  const _compute_usage_pct = (provider: AIProvider): number => {
    const state = providers[provider];
    const limit = plan_limits[provider].daily_request_limit;
    if (limit <= 0) return 0;
    return (state.total_requests / limit) * 100;
  };

  /** Compute success rate for a provider */
  const _compute_success_rate = (provider: AIProvider): number => {
    const state = providers[provider];
    if (state.total_requests === 0) return 100; // no requests = 100% success
    return (state.successful_requests / state.total_requests) * 100;
  };

  /** Determine alert level from usage percentage */
  const _compute_alert_level = (usage_pct: number): AIUsageAlertLevel => {
    if (usage_pct >= thresholds.critical_pct) return 'critical';
    if (usage_pct >= thresholds.warning_pct) return 'warning';
    return 'none';
  };

  /** Fire alert callback if level changed */
  const _check_and_fire_alert = async (provider: AIProvider): Promise<void> => {
    const usage_pct = _compute_usage_pct(provider);
    const new_level = _compute_alert_level(usage_pct);
    const old_level = providers[provider].last_alert_level;

    // Only fire when transitioning to a higher severity
    if (new_level !== old_level && new_level !== 'none') {
      providers[provider].last_alert_level = new_level;
      const threshold = new_level === 'critical' ? thresholds.critical_pct : thresholds.warning_pct;
      console.log(
        `${AI_LOG_PREFIX} ${provider} usage alert: ${old_level} → ${new_level} (${usage_pct.toFixed(1)}%)`,
      );
      if (config?.on_alert) {
        await config.on_alert({
          provider,
          level: new_level,
          usage_pct,
          threshold,
        });
      }
    } else if (new_level !== old_level) {
      // Downgrade — update level silently (e.g. day reset)
      providers[provider].last_alert_level = new_level;
    }
  };

  // === Public API ===

  /** Report a successful request to a provider */
  const report_success = async (provider: AIProvider): Promise<void> => {
    _check_day_reset();
    const state = providers[provider];
    state.total_requests += 1;
    state.successful_requests += 1;
    state.last_request_at = new Date().toISOString();
    state.last_failure_reason = undefined;
    await _check_and_fire_alert(provider);
  };

  /** Report a failed request to a provider */
  const report_failure = async (provider: AIProvider, reason?: string): Promise<void> => {
    _check_day_reset();
    const state = providers[provider];
    state.total_requests += 1;
    state.failed_requests += 1;
    state.last_request_at = new Date().toISOString();
    state.last_failure_reason = reason;
    console.log(
      `${AI_LOG_PREFIX} ${provider} failure reported: ${reason ?? 'unknown'} ` +
      `(${state.failed_requests}/${state.total_requests} failures today)`,
    );
    await _check_and_fire_alert(provider);
  };

  /** Get stats for a single provider */
  const get_provider_stats = (provider: AIProvider): AIProviderStats => {
    _check_day_reset();
    const state = providers[provider];
    return {
      provider,
      total_requests: state.total_requests,
      successful_requests: state.successful_requests,
      failed_requests: state.failed_requests,
      success_rate: _compute_success_rate(provider),
      estimated_usage_pct: _compute_usage_pct(provider),
      last_request_at: state.last_request_at,
      last_failure_reason: state.last_failure_reason,
    };
  };

  /** Get full usage summary for all providers */
  const get_summary = (): AIUsageSummary => {
    _check_day_reset();
    const all_providers: AIProvider[] = ['claude', 'gemini', 'chatgpt'];
    const provider_stats = all_providers.map(get_provider_stats);

    // Weighted average: weight by daily_request_limit (more expensive plans weigh more)
    const total_weight = all_providers.reduce(
      (sum, p) => sum + plan_limits[p].daily_request_limit, 0,
    );
    const weighted_usage = all_providers.reduce(
      (sum, p) => sum + (_compute_usage_pct(p) * plan_limits[p].daily_request_limit), 0,
    );
    const overall = total_weight > 0 ? weighted_usage / total_weight : 0;

    return {
      date: current_day,
      providers: provider_stats,
      overall_estimated_usage_pct: overall,
    };
  };

  /** Check all providers and return any threshold violations */
  const check_thresholds = (): AIUsageAlert[] => {
    _check_day_reset();
    const all_providers: AIProvider[] = ['claude', 'gemini', 'chatgpt'];
    const violations: AIUsageAlert[] = [];

    for (const provider of all_providers) {
      const usage_pct = _compute_usage_pct(provider);
      const level = _compute_alert_level(usage_pct);
      if (level !== 'none') {
        const threshold = level === 'critical' ? thresholds.critical_pct : thresholds.warning_pct;
        violations.push({ provider, level, usage_pct, threshold });
      }
    }

    return violations;
  };

  /** Reset all counters (for testing or manual reset) */
  const reset = (): void => {
    current_day = _get_day_key_util(new Date());
    for (const key of Object.keys(providers) as AIProvider[]) {
      providers[key] = _make_empty_state();
    }
  };

  /** Get the current tracked date (for testing) */
  const get_current_day = (): string => current_day;

  return {
    report_success,
    report_failure,
    get_provider_stats,
    get_summary,
    check_thresholds,
    reset,
    get_current_day,
  };
};

export type AIUsageTracker = ReturnType<typeof create_ai_usage_tracker>;

// ============================================================
// Unified Resource Monitor
// ============================================================
//
// Combines system resource monitoring + AI usage tracking into a single
// orchestrator with the complete API surface:
//   - collect_snapshot() — current system resources
//   - check_thresholds() — all threshold violations (system + AI)
//   - get_ai_usage_summary() — AI usage stats per provider
//   - start(interval_ms) / stop() — periodic monitoring

export type ThresholdViolation = {
  category: 'system' | 'ai';
  metric: string;
  value: number;
  threshold: number;
  severity: 'warning' | 'critical';
};

export type UnifiedMonitorConfig = {
  system_thresholds?: Partial<ResourceThresholds>;
  ai_tracker_config?: AIUsageTrackerConfig;
  ai_usage_thresholds?: Partial<AIUsageThresholds>;
  check_interval_ms?: number; // default: 60_000
  on_violation?: (violation: ThresholdViolation) => void | Promise<void>;
};

export const create_unified_monitor = (config?: UnifiedMonitorConfig) => {
  const system_thresholds: ResourceThresholds = {
    cpu_percent: 90,     // task spec: CPU > 90% sustained → alert
    memory_percent: 85,  // task spec: RAM > 85% → alert
    disk_percent: 80,    // task spec: Disk > 80% → alert
    ...config?.system_thresholds,
  };

  const ai_thresholds: AIUsageThresholds = {
    warning_pct: 70,   // task spec: > 70% → warning
    critical_pct: 90,  // task spec: > 90% → critical
    ...config?.ai_usage_thresholds,
  };

  // Wire up AI tracker with our violation callback
  const ai_tracker = create_ai_usage_tracker({
    ...config?.ai_tracker_config,
    thresholds: ai_thresholds,
    on_alert: async (alert) => {
      if (config?.on_violation) {
        await config.on_violation({
          category: 'ai',
          metric: `ai_${alert.provider}`,
          value: alert.usage_pct,
          threshold: alert.threshold,
          severity: alert.level === 'critical' ? 'critical' : 'warning',
        });
      }
    },
  });

  const interval_ms = config?.check_interval_ms ?? 60_000;
  let timer: ReturnType<typeof setInterval> | null = null;

  /** Collect current system resource snapshot */
  const collect_snapshot = (): ResourceSnapshot => {
    const cpu_usage_percent = parse_cpu_usage();
    const { used_mb, total_mb } = parse_memory_usage();
    const { used_gb, total_gb } = parse_disk_usage();

    return {
      timestamp: new Date().toISOString(),
      cpu_usage_percent,
      memory_used_mb: used_mb,
      memory_total_mb: total_mb,
      disk_used_gb: used_gb,
      disk_total_gb: total_gb,
    };
  };

  /** Check all thresholds (system + AI) and return violations */
  const check_thresholds = async (): Promise<ThresholdViolation[]> => {
    const violations: ThresholdViolation[] = [];
    const snapshot = collect_snapshot();

    // System: CPU
    if (snapshot.cpu_usage_percent > system_thresholds.cpu_percent) {
      const v: ThresholdViolation = {
        category: 'system',
        metric: 'cpu',
        value: snapshot.cpu_usage_percent,
        threshold: system_thresholds.cpu_percent,
        severity: snapshot.cpu_usage_percent > 95 ? 'critical' : 'warning',
      };
      violations.push(v);
      if (config?.on_violation) await config.on_violation(v);
    }

    // System: Memory
    if (snapshot.memory_total_mb > 0) {
      const memory_pct = (snapshot.memory_used_mb / snapshot.memory_total_mb) * 100;
      if (memory_pct > system_thresholds.memory_percent) {
        const v: ThresholdViolation = {
          category: 'system',
          metric: 'memory',
          value: memory_pct,
          threshold: system_thresholds.memory_percent,
          severity: memory_pct > 95 ? 'critical' : 'warning',
        };
        violations.push(v);
        if (config?.on_violation) await config.on_violation(v);
      }
    }

    // System: Disk
    if (snapshot.disk_total_gb > 0) {
      const disk_pct = (snapshot.disk_used_gb / snapshot.disk_total_gb) * 100;
      if (disk_pct > system_thresholds.disk_percent) {
        const v: ThresholdViolation = {
          category: 'system',
          metric: 'disk',
          value: disk_pct,
          threshold: system_thresholds.disk_percent,
          severity: disk_pct > 90 ? 'critical' : 'warning',
        };
        violations.push(v);
        if (config?.on_violation) await config.on_violation(v);
      }
    }

    // AI usage violations
    const ai_violations = ai_tracker.check_thresholds();
    for (const av of ai_violations) {
      violations.push({
        category: 'ai',
        metric: `ai_${av.provider}`,
        value: av.usage_pct,
        threshold: av.threshold,
        severity: av.level === 'critical' ? 'critical' : 'warning',
      });
    }

    return violations;
  };

  /** Get AI usage summary for all providers */
  const get_ai_usage_summary = (): AIUsageSummary => {
    return ai_tracker.get_summary();
  };

  /** Get the underlying AI tracker for direct success/failure reporting */
  const get_ai_tracker = (): AIUsageTracker => ai_tracker;

  /** Start periodic monitoring loop */
  const start = (override_interval_ms?: number): void => {
    if (timer) return;
    const ms = override_interval_ms ?? interval_ms;
    console.log(`[UnifiedMonitor] Started (check every ${ms}ms)`);
    timer = setInterval(() => {
      check_thresholds().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[UnifiedMonitor] Periodic check error: ${msg}`);
      });
    }, ms);
  };

  /** Stop periodic monitoring */
  const stop = (): void => {
    if (timer) {
      clearInterval(timer);
      timer = null;
      console.log('[UnifiedMonitor] Stopped');
    }
  };

  return {
    collect_snapshot,
    check_thresholds,
    get_ai_usage_summary,
    get_ai_tracker,
    start,
    stop,
  };
};

export type UnifiedMonitor = ReturnType<typeof create_unified_monitor>;

// ============================================================
// Utility helpers
// ============================================================

/** Get YYYY-MM-DD key from a date */
const _get_day_key_util = (date: Date): string => date.toISOString().slice(0, 10);

/** Create fresh provider state */
const _make_empty_state = (): ProviderState => ({
  total_requests: 0,
  successful_requests: 0,
  failed_requests: 0,
  last_request_at: null,
  last_failure_reason: undefined,
  last_alert_level: 'none',
});
