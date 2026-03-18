// FAS Resource Monitor (macOS)
// Monitors system resources (CPU, memory, disk) and fires alerts
// when thresholds are exceeded. Uses macOS-specific commands:
//   - top -l 1 -n 0  → CPU usage
//   - vm_stat + sysctl → memory usage
//   - df -g /         → disk usage

import { execSync } from 'node:child_process';
import type { ResourceSnapshot, ResourceThresholds } from '../shared/types.js';

// === Config type ===

export type ResourceMonitorConfig = {
  thresholds?: Partial<ResourceThresholds>;
  check_interval_ms?: number; // default: 60_000
  on_alert: (metric: string, value: number, threshold: number) => void | Promise<void>;
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
