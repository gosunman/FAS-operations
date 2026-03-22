// TDD tests for daily_aggregator module
// Tests cover: format_duration, format_bytes, aggregate_snapshots,
// analyze_bottlenecks, build_daily_report, format_infra_report_telegram

import { describe, it, expect } from 'vitest';
import type {
  ResourceSnapshot,
  DailyMachineStats,
  DailyAIStats,
  DailyInfraReport,
} from '../shared/types.js';
import {
  format_duration,
  format_bytes,
  aggregate_snapshots,
  analyze_bottlenecks,
  build_daily_report,
  format_infra_report_telegram,
  type TimeSummary,
} from './daily_aggregator.js';

// === Test Data Factories ===

const make_snapshot = (overrides: Partial<ResourceSnapshot> = {}): ResourceSnapshot => ({
  timestamp: '2026-03-23T10:00:00.000Z',
  cpu_usage_percent: 45,
  memory_used_mb: 32_000,
  memory_total_mb: 192_000,
  disk_used_gb: 500,
  disk_total_gb: 2000,
  gpu_usage_percent: 30,
  cpu_temp_celsius: 55,
  gpu_temp_celsius: 48,
  network_bytes_sent: 500_000_000,
  network_bytes_recv: 1_200_000_000,
  ...overrides,
});

const make_time_summary = (overrides: Partial<TimeSummary> = {}): TimeSummary => ({
  working_ms: 64_800_000,  // 18h
  idle_ms: 20_820_000,     // 5h47m
  down_ms: 780_000,        // 13m
  ...overrides,
});

const make_machine_stats = (overrides: Partial<DailyMachineStats> = {}): DailyMachineStats => ({
  device: 'captain',
  date: '2026-03-23',
  working_ms: 64_800_000,
  idle_ms: 20_820_000,
  down_ms: 780_000,
  cpu_avg: 34,
  cpu_max: 89,
  cpu_min: 2,
  gpu_avg: 12,
  gpu_max: 67,
  gpu_min: 0,
  cpu_temp_avg: 52,
  cpu_temp_max: 78,
  gpu_temp_avg: 45,
  gpu_temp_max: 60,
  ram_avg_mb: 48_000,
  ram_max_mb: 64_000,
  ram_total_mb: 192_000,
  total_bytes_sent: 890_000_000,
  total_bytes_recv: 2_300_000_000,
  snapshot_count: 1440,
  ...overrides,
});

const make_ai_stats = (overrides: Partial<DailyAIStats> = {}): DailyAIStats => ({
  date: '2026-03-23',
  claude_requests: 150,
  claude_failures: 2,
  claude_throttle_count: 0,
  chatgpt_requests: 23,
  chatgpt_failures: 0,
  gemini_requests: 45,
  gemini_failures: 1,
  ...overrides,
});

// === format_duration ===

describe('format_duration', () => {
  it('formats hours and minutes', () => {
    // 18h 30m = 18*3600*1000 + 30*60*1000 = 66_600_000
    expect(format_duration(66_600_000)).toBe('18h 30m');
  });

  it('formats hours only (no minutes)', () => {
    // 2h exactly = 7_200_000
    expect(format_duration(7_200_000)).toBe('2h 0m');
  });

  it('formats minutes only (no hours)', () => {
    // 13m = 780_000
    expect(format_duration(780_000)).toBe('13m');
  });

  it('formats 0 milliseconds as "0m"', () => {
    expect(format_duration(0)).toBe('0m');
  });

  it('formats 5 hours 47 minutes correctly', () => {
    // 5h47m = 5*3600*1000 + 47*60*1000 = 20_820_000
    expect(format_duration(20_820_000)).toBe('5h 47m');
  });

  it('handles sub-minute values as "0m"', () => {
    expect(format_duration(30_000)).toBe('0m');
  });

  it('truncates partial minutes (does not round up)', () => {
    // 1h 29m 59s → should show 1h 29m
    const ms = 1 * 3_600_000 + 29 * 60_000 + 59_000;
    expect(format_duration(ms)).toBe('1h 29m');
  });
});

// === format_bytes ===

describe('format_bytes', () => {
  it('formats gigabytes', () => {
    expect(format_bytes(2_300_000_000)).toBe('2.3GB');
  });

  it('formats megabytes', () => {
    expect(format_bytes(890_000_000)).toBe('890.0MB');
  });

  it('formats kilobytes', () => {
    expect(format_bytes(12_000)).toBe('12.0KB');
  });

  it('formats 0 bytes', () => {
    expect(format_bytes(0)).toBe('0B');
  });

  it('formats exact 1GB', () => {
    expect(format_bytes(1_000_000_000)).toBe('1.0GB');
  });

  it('formats small byte values', () => {
    expect(format_bytes(500)).toBe('500B');
  });

  it('formats fractional GB correctly', () => {
    expect(format_bytes(1_500_000_000)).toBe('1.5GB');
  });
});

// === aggregate_snapshots ===

describe('aggregate_snapshots', () => {
  it('computes avg/max/min for CPU from sample snapshots', () => {
    const snapshots: ResourceSnapshot[] = [
      make_snapshot({ cpu_usage_percent: 20, gpu_usage_percent: 10 }),
      make_snapshot({ cpu_usage_percent: 60, gpu_usage_percent: 40 }),
      make_snapshot({ cpu_usage_percent: 80, gpu_usage_percent: 70 }),
    ];

    const result = aggregate_snapshots('captain', '2026-03-23', snapshots, make_time_summary());

    // CPU: avg ~53.33, max 80, min 20
    expect(result.cpu_avg).toBeCloseTo(53.33, 0);
    expect(result.cpu_max).toBe(80);
    expect(result.cpu_min).toBe(20);
  });

  it('computes avg/max/min for GPU', () => {
    const snapshots: ResourceSnapshot[] = [
      make_snapshot({ gpu_usage_percent: 10 }),
      make_snapshot({ gpu_usage_percent: 50 }),
      make_snapshot({ gpu_usage_percent: 30 }),
    ];

    const result = aggregate_snapshots('captain', '2026-03-23', snapshots, make_time_summary());

    expect(result.gpu_avg).toBe(30);
    expect(result.gpu_max).toBe(50);
    expect(result.gpu_min).toBe(10);
  });

  it('computes temperature stats', () => {
    const snapshots: ResourceSnapshot[] = [
      make_snapshot({ cpu_temp_celsius: 45, gpu_temp_celsius: 40 }),
      make_snapshot({ cpu_temp_celsius: 78, gpu_temp_celsius: 65 }),
      make_snapshot({ cpu_temp_celsius: 52, gpu_temp_celsius: 48 }),
    ];

    const result = aggregate_snapshots('captain', '2026-03-23', snapshots, make_time_summary());

    // CPU temp: avg ~58.33, max 78
    expect(result.cpu_temp_avg).toBeCloseTo(58.33, 0);
    expect(result.cpu_temp_max).toBe(78);
    // GPU temp: avg 51, max 65
    expect(result.gpu_temp_avg).toBe(51);
    expect(result.gpu_temp_max).toBe(65);
  });

  it('computes RAM stats', () => {
    const snapshots: ResourceSnapshot[] = [
      make_snapshot({ memory_used_mb: 32_000, memory_total_mb: 192_000 }),
      make_snapshot({ memory_used_mb: 64_000, memory_total_mb: 192_000 }),
      make_snapshot({ memory_used_mb: 48_000, memory_total_mb: 192_000 }),
    ];

    const result = aggregate_snapshots('captain', '2026-03-23', snapshots, make_time_summary());

    expect(result.ram_avg_mb).toBe(48_000);
    expect(result.ram_max_mb).toBe(64_000);
    expect(result.ram_total_mb).toBe(192_000);
  });

  it('computes network delta (last - first)', () => {
    const snapshots: ResourceSnapshot[] = [
      make_snapshot({ network_bytes_sent: 100_000, network_bytes_recv: 200_000 }),
      make_snapshot({ network_bytes_sent: 500_000, network_bytes_recv: 800_000 }),
      make_snapshot({ network_bytes_sent: 990_000, network_bytes_recv: 2_200_000 }),
    ];

    const result = aggregate_snapshots('captain', '2026-03-23', snapshots, make_time_summary());

    // Delta: last - first
    expect(result.total_bytes_sent).toBe(890_000);
    expect(result.total_bytes_recv).toBe(2_000_000);
  });

  it('includes time summary in result', () => {
    const time_summary = make_time_summary({
      working_ms: 50_000_000,
      idle_ms: 30_000_000,
      down_ms: 6_400_000,
    });
    const snapshots: ResourceSnapshot[] = [make_snapshot()];

    const result = aggregate_snapshots('captain', '2026-03-23', snapshots, time_summary);

    expect(result.working_ms).toBe(50_000_000);
    expect(result.idle_ms).toBe(30_000_000);
    expect(result.down_ms).toBe(6_400_000);
  });

  it('sets device and date correctly', () => {
    const result = aggregate_snapshots('hunter', '2026-03-22', [make_snapshot()], make_time_summary());

    expect(result.device).toBe('hunter');
    expect(result.date).toBe('2026-03-22');
  });

  it('sets snapshot_count to the number of snapshots', () => {
    const snapshots = [make_snapshot(), make_snapshot(), make_snapshot()];
    const result = aggregate_snapshots('captain', '2026-03-23', snapshots, make_time_summary());

    expect(result.snapshot_count).toBe(3);
  });

  it('returns all zeros for empty snapshot array', () => {
    const result = aggregate_snapshots(
      'captain',
      '2026-03-23',
      [],
      make_time_summary(),
    );

    expect(result.device).toBe('captain');
    expect(result.date).toBe('2026-03-23');
    expect(result.cpu_avg).toBe(0);
    expect(result.cpu_max).toBe(0);
    expect(result.cpu_min).toBe(0);
    expect(result.gpu_avg).toBe(0);
    expect(result.gpu_max).toBe(0);
    expect(result.gpu_min).toBe(0);
    expect(result.cpu_temp_avg).toBe(0);
    expect(result.cpu_temp_max).toBe(0);
    expect(result.gpu_temp_avg).toBe(0);
    expect(result.gpu_temp_max).toBe(0);
    expect(result.ram_avg_mb).toBe(0);
    expect(result.ram_max_mb).toBe(0);
    expect(result.ram_total_mb).toBe(0);
    expect(result.total_bytes_sent).toBe(0);
    expect(result.total_bytes_recv).toBe(0);
    expect(result.snapshot_count).toBe(0);
    // Time summary should still be preserved
    expect(result.working_ms).toBe(make_time_summary().working_ms);
  });

  it('handles snapshots with missing optional fields (gpu, temp, network)', () => {
    const snapshots: ResourceSnapshot[] = [
      {
        timestamp: '2026-03-23T10:00:00.000Z',
        cpu_usage_percent: 50,
        memory_used_mb: 16_000,
        memory_total_mb: 64_000,
        disk_used_gb: 200,
        disk_total_gb: 1000,
        // No gpu, temp, or network fields
      },
      {
        timestamp: '2026-03-23T10:01:00.000Z',
        cpu_usage_percent: 70,
        memory_used_mb: 20_000,
        memory_total_mb: 64_000,
        disk_used_gb: 200,
        disk_total_gb: 1000,
      },
    ];

    const result = aggregate_snapshots('hunter', '2026-03-23', snapshots, make_time_summary());

    expect(result.cpu_avg).toBe(60);
    expect(result.cpu_max).toBe(70);
    expect(result.cpu_min).toBe(50);
    // Optional fields default to 0
    expect(result.gpu_avg).toBe(0);
    expect(result.gpu_max).toBe(0);
    expect(result.gpu_min).toBe(0);
    expect(result.cpu_temp_avg).toBe(0);
    expect(result.cpu_temp_max).toBe(0);
    expect(result.gpu_temp_avg).toBe(0);
    expect(result.gpu_temp_max).toBe(0);
    expect(result.total_bytes_sent).toBe(0);
    expect(result.total_bytes_recv).toBe(0);
  });

  it('handles single snapshot correctly', () => {
    const snapshots: ResourceSnapshot[] = [
      make_snapshot({
        cpu_usage_percent: 42,
        gpu_usage_percent: 15,
        memory_used_mb: 48_000,
        memory_total_mb: 192_000,
        network_bytes_sent: 100,
        network_bytes_recv: 200,
      }),
    ];

    const result = aggregate_snapshots('captain', '2026-03-23', snapshots, make_time_summary());

    // Single snapshot: avg = max = min = the value
    expect(result.cpu_avg).toBe(42);
    expect(result.cpu_max).toBe(42);
    expect(result.cpu_min).toBe(42);
    expect(result.gpu_avg).toBe(15);
    expect(result.gpu_max).toBe(15);
    expect(result.gpu_min).toBe(15);
    // Single snapshot: network delta = 0 (last - first = same)
    expect(result.total_bytes_sent).toBe(0);
    expect(result.total_bytes_recv).toBe(0);
  });
});

// === analyze_bottlenecks ===

describe('analyze_bottlenecks', () => {
  it('detects underutilized device (idle > 60% of total time)', () => {
    const total = 86_400_000; // 24h
    const machines: DailyMachineStats[] = [
      make_machine_stats({
        device: 'hunter',
        working_ms: total * 0.2,
        idle_ms: total * 0.75, // 75% idle
        down_ms: total * 0.05,
      }),
    ];

    const alerts = analyze_bottlenecks(machines, make_ai_stats());
    const underutilized = alerts.filter((a) => a.type === 'underutilized');

    expect(underutilized.length).toBe(1);
    expect(underutilized[0].device).toBe('hunter');
    expect(underutilized[0].severity).toBe('warning');
  });

  it('detects cpu_bottleneck (cpu_avg > 70)', () => {
    const machines: DailyMachineStats[] = [
      make_machine_stats({ device: 'captain', cpu_avg: 85 }),
    ];

    const alerts = analyze_bottlenecks(machines, make_ai_stats());
    const cpu = alerts.filter((a) => a.type === 'cpu_bottleneck');

    expect(cpu.length).toBe(1);
    expect(cpu[0].device).toBe('captain');
    expect(cpu[0].severity).toBe('warning');
  });

  it('detects api_limit (throttle_count > 3)', () => {
    const ai_stats = make_ai_stats({ claude_throttle_count: 5 });

    const alerts = analyze_bottlenecks([make_machine_stats()], ai_stats);
    const api = alerts.filter((a) => a.type === 'api_limit');

    expect(api.length).toBe(1);
    expect(api[0].severity).toBe('warning');
  });

  it('detects overheating (cpu_temp_max > 90)', () => {
    const machines: DailyMachineStats[] = [
      make_machine_stats({ device: 'captain', cpu_temp_max: 95 }),
    ];

    const alerts = analyze_bottlenecks(machines, make_ai_stats());
    const heat = alerts.filter((a) => a.type === 'overheating');

    expect(heat.length).toBe(1);
    expect(heat[0].device).toBe('captain');
    expect(heat[0].severity).toBe('critical');
  });

  it('detects overheating (gpu_temp_max > 90)', () => {
    const machines: DailyMachineStats[] = [
      make_machine_stats({ device: 'hunter', gpu_temp_max: 92 }),
    ];

    const alerts = analyze_bottlenecks(machines, make_ai_stats());
    const heat = alerts.filter((a) => a.type === 'overheating');

    expect(heat.length).toBe(1);
    expect(heat[0].device).toBe('hunter');
  });

  it('detects memory_pressure (ram_max_mb / ram_total_mb > 0.85)', () => {
    const machines: DailyMachineStats[] = [
      make_machine_stats({
        device: 'captain',
        ram_max_mb: 170_000,
        ram_total_mb: 192_000, // 170/192 = 0.885 > 0.85
      }),
    ];

    const alerts = analyze_bottlenecks(machines, make_ai_stats());
    const mem = alerts.filter((a) => a.type === 'memory_pressure');

    expect(mem.length).toBe(1);
    expect(mem[0].device).toBe('captain');
    expect(mem[0].severity).toBe('warning');
  });

  it('returns empty array for healthy stats', () => {
    const machines: DailyMachineStats[] = [
      make_machine_stats({
        device: 'captain',
        // Default: reasonable utilization
        working_ms: 60_000_000,
        idle_ms: 20_000_000,
        down_ms: 6_400_000,
        cpu_avg: 34,
        cpu_temp_max: 78,
        gpu_temp_max: 60,
        ram_max_mb: 64_000,
        ram_total_mb: 192_000,
      }),
    ];

    const ai_stats = make_ai_stats({ claude_throttle_count: 2 });

    const alerts = analyze_bottlenecks(machines, ai_stats);
    expect(alerts).toHaveLength(0);
  });

  it('detects multiple bottlenecks across devices', () => {
    const machines: DailyMachineStats[] = [
      make_machine_stats({
        device: 'captain',
        cpu_avg: 80,             // cpu_bottleneck
        cpu_temp_max: 95,        // overheating
      }),
      make_machine_stats({
        device: 'hunter',
        working_ms: 5_000_000,
        idle_ms: 75_000_000,     // underutilized
        down_ms: 6_400_000,
        ram_max_mb: 58_000,
        ram_total_mb: 64_000,    // memory_pressure (0.906)
      }),
    ];

    const ai_stats = make_ai_stats({ claude_throttle_count: 5 }); // api_limit

    const alerts = analyze_bottlenecks(machines, ai_stats);

    const types = alerts.map((a) => a.type);
    expect(types).toContain('cpu_bottleneck');
    expect(types).toContain('overheating');
    expect(types).toContain('underutilized');
    expect(types).toContain('memory_pressure');
    expect(types).toContain('api_limit');
  });

  it('does not flag underutilized when total time is 0', () => {
    const machines: DailyMachineStats[] = [
      make_machine_stats({
        device: 'captain',
        working_ms: 0,
        idle_ms: 0,
        down_ms: 0,
      }),
    ];

    const alerts = analyze_bottlenecks(machines, make_ai_stats());
    const underutilized = alerts.filter((a) => a.type === 'underutilized');
    expect(underutilized).toHaveLength(0);
  });
});

// === build_daily_report ===

describe('build_daily_report', () => {
  it('combines machines, ai_stats, and bottlenecks into a report', () => {
    const machines = [make_machine_stats({ cpu_avg: 85 })]; // triggers cpu_bottleneck
    const ai_stats = make_ai_stats();

    const report = build_daily_report('2026-03-23', machines, ai_stats);

    expect(report.date).toBe('2026-03-23');
    expect(report.machines).toHaveLength(1);
    expect(report.ai_stats).toBe(ai_stats);
    expect(report.bottlenecks.length).toBeGreaterThanOrEqual(1);
    expect(report.bottlenecks.some((b) => b.type === 'cpu_bottleneck')).toBe(true);
  });

  it('returns empty bottlenecks for healthy report', () => {
    const machines = [make_machine_stats()];
    const ai_stats = make_ai_stats();

    const report = build_daily_report('2026-03-23', machines, ai_stats);

    expect(report.bottlenecks).toHaveLength(0);
  });

  it('includes all machines in the report', () => {
    const machines = [
      make_machine_stats({ device: 'captain' }),
      make_machine_stats({ device: 'hunter' }),
    ];
    const ai_stats = make_ai_stats();

    const report = build_daily_report('2026-03-23', machines, ai_stats);

    expect(report.machines).toHaveLength(2);
    expect(report.machines[0].device).toBe('captain');
    expect(report.machines[1].device).toBe('hunter');
  });
});

// === format_infra_report_telegram ===

describe('format_infra_report_telegram', () => {
  it('produces expected output format with header', () => {
    const report: DailyInfraReport = {
      date: '2026-03-23',
      machines: [make_machine_stats({ device: 'captain' })],
      ai_stats: make_ai_stats(),
      bottlenecks: [],
    };

    const output = format_infra_report_telegram(report);

    expect(output).toContain('인프라 일일 보고');
    expect(output).toContain('2026-03-23');
  });

  it('includes machine section with device name', () => {
    const report: DailyInfraReport = {
      date: '2026-03-23',
      machines: [make_machine_stats({ device: 'captain' })],
      ai_stats: make_ai_stats(),
      bottlenecks: [],
    };

    const output = format_infra_report_telegram(report);

    expect(output).toContain('captain');
  });

  it('includes time breakdown for each machine', () => {
    const report: DailyInfraReport = {
      date: '2026-03-23',
      machines: [make_machine_stats({
        device: 'captain',
        working_ms: 64_800_000,  // 18h
        idle_ms: 20_820_000,     // 5h47m
        down_ms: 780_000,        // 13m
      })],
      ai_stats: make_ai_stats(),
      bottlenecks: [],
    };

    const output = format_infra_report_telegram(report);

    expect(output).toContain('18h 0m');
    expect(output).toContain('5h 47m');
    expect(output).toContain('13m');
  });

  it('includes CPU and GPU stats', () => {
    const report: DailyInfraReport = {
      date: '2026-03-23',
      machines: [make_machine_stats({
        cpu_avg: 34,
        cpu_max: 89,
        cpu_min: 2,
        gpu_avg: 12,
        gpu_max: 67,
      })],
      ai_stats: make_ai_stats(),
      bottlenecks: [],
    };

    const output = format_infra_report_telegram(report);

    expect(output).toContain('CPU');
    expect(output).toContain('34%');
    expect(output).toContain('89%');
  });

  it('includes temperature and RAM info', () => {
    const report: DailyInfraReport = {
      date: '2026-03-23',
      machines: [make_machine_stats({
        cpu_temp_avg: 52,
        cpu_temp_max: 78,
        ram_avg_mb: 48_000,
        ram_total_mb: 192_000,
      })],
      ai_stats: make_ai_stats(),
      bottlenecks: [],
    };

    const output = format_infra_report_telegram(report);

    expect(output).toContain('52°C');
    expect(output).toContain('78°C');
    expect(output).toContain('RAM');
  });

  it('includes AI stats section', () => {
    const report: DailyInfraReport = {
      date: '2026-03-23',
      machines: [],
      ai_stats: make_ai_stats({
        claude_requests: 847,
        chatgpt_requests: 23,
        gemini_requests: 156,
      }),
      bottlenecks: [],
    };

    const output = format_infra_report_telegram(report);

    expect(output).toContain('Claude');
    expect(output).toContain('847');
    expect(output).toContain('ChatGPT');
    expect(output).toContain('23');
    expect(output).toContain('Gemini');
    expect(output).toContain('156');
  });

  it('includes bottleneck warnings', () => {
    const report: DailyInfraReport = {
      date: '2026-03-23',
      machines: [],
      ai_stats: make_ai_stats(),
      bottlenecks: [
        {
          type: 'underutilized',
          device: 'hunter',
          message: 'Hunter idle 75%',
          severity: 'warning',
        },
        {
          type: 'api_limit',
          device: 'captain',
          message: 'Claude throttle 5 times',
          severity: 'warning',
        },
      ],
    };

    const output = format_infra_report_telegram(report);

    expect(output).toContain('Hunter idle 75%');
    expect(output).toContain('Claude throttle 5 times');
  });

  it('includes network stats', () => {
    const report: DailyInfraReport = {
      date: '2026-03-23',
      machines: [make_machine_stats({
        total_bytes_sent: 890_000_000,
        total_bytes_recv: 2_300_000_000,
      })],
      ai_stats: make_ai_stats(),
      bottlenecks: [],
    };

    const output = format_infra_report_telegram(report);

    expect(output).toContain('890.0MB');
    expect(output).toContain('2.3GB');
  });

  it('handles empty machines list', () => {
    const report: DailyInfraReport = {
      date: '2026-03-23',
      machines: [],
      ai_stats: make_ai_stats(),
      bottlenecks: [],
    };

    const output = format_infra_report_telegram(report);

    // Should still produce a valid string with header and AI section
    expect(output).toContain('인프라 일일 보고');
    expect(output).toContain('AI API');
  });

  it('handles empty bottlenecks without warning section', () => {
    const report: DailyInfraReport = {
      date: '2026-03-23',
      machines: [make_machine_stats()],
      ai_stats: make_ai_stats(),
      bottlenecks: [],
    };

    const output = format_infra_report_telegram(report);

    // No warning emoji line when no bottlenecks
    expect(output).not.toContain('⚠️');
  });
});
