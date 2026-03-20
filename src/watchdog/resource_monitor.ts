// FAS Resource Monitor (macOS)
// Monitors system resources (CPU, memory, disk) and fires alerts
// when thresholds are exceeded. Uses macOS-specific commands:
//   - top -l 1 -n 0  → CPU usage
//   - vm_stat + sysctl → memory usage
//   - df -g /         → disk usage

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
