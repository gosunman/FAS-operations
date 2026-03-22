// Daily Aggregator — aggregates resource snapshots and time classification data
// into daily statistics with bottleneck analysis and Telegram formatting.
//
// Functions:
//   format_duration — format milliseconds as human-readable duration (e.g. "18h 30m")
//   format_bytes — format bytes as human-readable size (e.g. "2.3GB")
//   aggregate_snapshots — compute daily stats from ResourceSnapshot array + TimeSummary
//   analyze_bottlenecks — detect infra bottlenecks from machine stats + AI stats
//   build_daily_report — combine all data into a DailyInfraReport
//   format_infra_report_telegram — render report as a concise Telegram message

import type {
  ResourceSnapshot,
  DailyMachineStats,
  DailyAIStats,
  BottleneckAlert,
  DailyInfraReport,
} from '../shared/types.js';

// === Bottleneck thresholds (as constants, no magic numbers) ===

const IDLE_RATIO_THRESHOLD = 0.6;
const CPU_AVG_BOTTLENECK_THRESHOLD = 70;
const API_THROTTLE_THRESHOLD = 3;
const TEMP_MAX_THRESHOLD = 90;
const MEMORY_PRESSURE_RATIO = 0.85;

// === Byte size thresholds ===

const BYTES_PER_GB = 1_000_000_000;
const BYTES_PER_MB = 1_000_000;
const BYTES_PER_KB = 1_000;

// === Time conversion constants ===

const MS_PER_HOUR = 3_600_000;
const MS_PER_MINUTE = 60_000;

// === Time summary from time_classifier (passed in) ===

export type TimeSummary = {
  working_ms: number;
  idle_ms: number;
  down_ms: number;
};

// === Helper: format milliseconds as human-readable duration ===
// Outputs "Xh Ym" for >= 1h, "Ym" for < 1h, "0m" for 0 or sub-minute

export const format_duration = (ms: number): string => {
  const hours = Math.floor(ms / MS_PER_HOUR);
  const minutes = Math.floor((ms % MS_PER_HOUR) / MS_PER_MINUTE);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
};

// === Helper: format bytes as human-readable size ===
// Outputs GB/MB/KB/B with 1 decimal for GB/MB/KB, integer for B

export const format_bytes = (bytes: number): string => {
  if (bytes === 0) return '0B';

  if (bytes >= BYTES_PER_GB) {
    return `${(bytes / BYTES_PER_GB).toFixed(1)}GB`;
  }

  if (bytes >= BYTES_PER_MB) {
    return `${(bytes / BYTES_PER_MB).toFixed(1)}MB`;
  }

  if (bytes >= BYTES_PER_KB) {
    return `${(bytes / BYTES_PER_KB).toFixed(1)}KB`;
  }

  return `${bytes}B`;
};

// === Internal: safe average calculation for numeric arrays ===

const safe_avg = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return sum / values.length;
};

// === Internal: extract optional numeric field from snapshots, defaulting to 0 ===

const extract_values = (
  snapshots: ResourceSnapshot[],
  key: keyof ResourceSnapshot,
): number[] =>
  snapshots.map((s) => {
    const value = s[key];
    return typeof value === 'number' ? value : 0;
  });

// === Aggregate snapshots into daily stats ===

export const aggregate_snapshots = (
  device: string,
  date: string,
  snapshots: ResourceSnapshot[],
  time_summary: TimeSummary,
): DailyMachineStats => {
  if (snapshots.length === 0) {
    return {
      device,
      date,
      ...time_summary,
      cpu_avg: 0,
      cpu_max: 0,
      cpu_min: 0,
      gpu_avg: 0,
      gpu_max: 0,
      gpu_min: 0,
      cpu_temp_avg: 0,
      cpu_temp_max: 0,
      gpu_temp_avg: 0,
      gpu_temp_max: 0,
      ram_avg_mb: 0,
      ram_max_mb: 0,
      ram_total_mb: 0,
      total_bytes_sent: 0,
      total_bytes_recv: 0,
      snapshot_count: 0,
    };
  }

  // CPU
  const cpu_values = extract_values(snapshots, 'cpu_usage_percent');
  const cpu_avg = safe_avg(cpu_values);
  const cpu_max = Math.max(...cpu_values);
  const cpu_min = Math.min(...cpu_values);

  // GPU (optional field, defaults to 0)
  const gpu_values = extract_values(snapshots, 'gpu_usage_percent');
  const gpu_avg = safe_avg(gpu_values);
  const gpu_max = Math.max(...gpu_values);
  const gpu_min = Math.min(...gpu_values);

  // CPU temperature (optional)
  const cpu_temp_values = extract_values(snapshots, 'cpu_temp_celsius');
  const cpu_temp_avg = safe_avg(cpu_temp_values);
  const cpu_temp_max = Math.max(...cpu_temp_values);

  // GPU temperature (optional)
  const gpu_temp_values = extract_values(snapshots, 'gpu_temp_celsius');
  const gpu_temp_avg = safe_avg(gpu_temp_values);
  const gpu_temp_max = Math.max(...gpu_temp_values);

  // RAM
  const ram_values = extract_values(snapshots, 'memory_used_mb');
  const ram_avg_mb = safe_avg(ram_values);
  const ram_max_mb = Math.max(...ram_values);
  // Use the last snapshot's total (should be consistent across snapshots)
  const ram_total_mb = snapshots[snapshots.length - 1].memory_total_mb;

  // Network: delta between last and first snapshot
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const first_sent = first.network_bytes_sent ?? 0;
  const last_sent = last.network_bytes_sent ?? 0;
  const first_recv = first.network_bytes_recv ?? 0;
  const last_recv = last.network_bytes_recv ?? 0;
  const total_bytes_sent = Math.max(0, last_sent - first_sent);
  const total_bytes_recv = Math.max(0, last_recv - first_recv);

  return {
    device,
    date,
    ...time_summary,
    cpu_avg,
    cpu_max,
    cpu_min,
    gpu_avg,
    gpu_max,
    gpu_min,
    cpu_temp_avg,
    cpu_temp_max,
    gpu_temp_avg,
    gpu_temp_max,
    ram_avg_mb,
    ram_max_mb,
    ram_total_mb,
    total_bytes_sent,
    total_bytes_recv,
    snapshot_count: snapshots.length,
  };
};

// === Bottleneck analysis ===
// Detects infrastructure bottlenecks from machine stats and AI usage stats.

export const analyze_bottlenecks = (
  machines: DailyMachineStats[],
  ai_stats: DailyAIStats,
): BottleneckAlert[] => {
  const alerts: BottleneckAlert[] = [];

  for (const m of machines) {
    const total_time = m.working_ms + m.idle_ms + m.down_ms;

    // Underutilized: idle ratio > 60%
    if (total_time > 0 && m.idle_ms / total_time > IDLE_RATIO_THRESHOLD) {
      const idle_pct = Math.round((m.idle_ms / total_time) * 100);
      alerts.push({
        type: 'underutilized',
        device: m.device,
        message: `${m.device} idle ${idle_pct}% of the day`,
        severity: 'warning',
      });
    }

    // CPU bottleneck: average CPU > 70%
    if (m.cpu_avg > CPU_AVG_BOTTLENECK_THRESHOLD) {
      alerts.push({
        type: 'cpu_bottleneck',
        device: m.device,
        message: `${m.device} CPU avg ${m.cpu_avg.toFixed(0)}% — sustained high load`,
        severity: 'warning',
      });
    }

    // Overheating: any temp max > 90°C
    if (m.cpu_temp_max > TEMP_MAX_THRESHOLD || m.gpu_temp_max > TEMP_MAX_THRESHOLD) {
      const max_temp = Math.max(m.cpu_temp_max, m.gpu_temp_max);
      const source = m.cpu_temp_max > m.gpu_temp_max ? 'CPU' : 'GPU';
      alerts.push({
        type: 'overheating',
        device: m.device,
        message: `${m.device} ${source} temp peaked at ${max_temp}°C`,
        severity: 'critical',
      });
    }

    // Memory pressure: ram_max / ram_total > 85%
    if (m.ram_total_mb > 0 && m.ram_max_mb / m.ram_total_mb > MEMORY_PRESSURE_RATIO) {
      const pct = Math.round((m.ram_max_mb / m.ram_total_mb) * 100);
      alerts.push({
        type: 'memory_pressure',
        device: m.device,
        message: `${m.device} RAM peaked at ${pct}% (${m.ram_max_mb}MB / ${m.ram_total_mb}MB)`,
        severity: 'warning',
      });
    }
  }

  // API limit: throttle count > 3
  if (ai_stats.claude_throttle_count > API_THROTTLE_THRESHOLD) {
    alerts.push({
      type: 'api_limit',
      device: 'captain',
      message: `Claude throttled ${ai_stats.claude_throttle_count} times`,
      severity: 'warning',
    });
  }

  return alerts;
};

// === Build complete daily infrastructure report ===

export const build_daily_report = (
  date: string,
  machines: DailyMachineStats[],
  ai_stats: DailyAIStats,
): DailyInfraReport => ({
  date,
  machines,
  ai_stats,
  bottlenecks: analyze_bottlenecks(machines, ai_stats),
});

// === Internal: format RAM in GB for display ===

const format_ram_gb = (mb: number): string => {
  const gb = mb / 1_000;
  return gb >= 1 ? `${Math.round(gb)}GB` : `${Math.round(mb)}MB`;
};

// === Format DailyInfraReport for Telegram ===
// Produces a concise, emoji-rich message suitable for Telegram.

export const format_infra_report_telegram = (report: DailyInfraReport): string => {
  const lines: string[] = [];

  // Header
  lines.push(`📊 인프라 일일 보고 — ${report.date}`);
  lines.push('');

  // Machine sections
  for (const m of report.machines) {
    lines.push(`[${m.device}]`);
    lines.push(
      `⏱ Work ${format_duration(m.working_ms)} | Idle ${format_duration(m.idle_ms)} | Down ${format_duration(m.down_ms)}`,
    );

    // CPU + GPU line
    const cpu_str = `CPU ${m.cpu_avg}%↗${m.cpu_max}%↘${m.cpu_min}%`;
    const gpu_str = m.gpu_max > 0 ? ` | GPU ${m.gpu_avg}%↗${m.gpu_max}%` : '';
    lines.push(cpu_str + gpu_str);

    // Temperature + RAM line
    lines.push(
      `🌡 ${m.cpu_temp_avg}°C↗${m.cpu_temp_max}°C | RAM ${format_ram_gb(m.ram_avg_mb)}/${format_ram_gb(m.ram_total_mb)}`,
    );

    // Network line
    lines.push(`🌐 ↓${format_bytes(m.total_bytes_recv)} ↑${format_bytes(m.total_bytes_sent)}`);
    lines.push('');
  }

  // AI stats section
  lines.push('[AI API]');
  const { ai_stats: ai } = report;
  lines.push(`Claude: ${ai.claude_requests} req | fail ${ai.claude_failures} | throttle ${ai.claude_throttle_count}`);
  lines.push(`ChatGPT: ${ai.chatgpt_requests} req | fail ${ai.chatgpt_failures}`);
  lines.push(`Gemini: ${ai.gemini_requests} req | fail ${ai.gemini_failures}`);

  // Bottleneck warnings
  if (report.bottlenecks.length > 0) {
    lines.push('');
    for (const b of report.bottlenecks) {
      const icon = b.severity === 'critical' ? '🚨' : '⚠️';
      lines.push(`${icon} ${b.message}`);
    }
  }

  return lines.join('\n');
};
