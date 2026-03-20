// TDD tests for resource monitor
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ResourceSnapshot } from '../shared/types.js';

// Mock child_process before importing the module under test
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'node:child_process';
import {
  parse_cpu_usage,
  parse_memory_usage,
  parse_disk_usage,
  create_resource_monitor,
  create_telegram_alert_handler,
  create_ai_usage_tracker,
  create_unified_monitor,
  type ResourceMonitorConfig,
  type TelegramAlertConfig,
  type AIProvider,
  type AIUsageAlert,
  type ThresholdViolation,
} from './resource_monitor.js';

const mocked_exec = vi.mocked(execSync);

// === Sample macOS command outputs ===

const SAMPLE_TOP_OUTPUT = [
  'Processes: 450 total, 3 running, 447 sleeping, 2000 threads',
  'Load Avg: 3.12, 2.85, 2.50',
  'CPU usage: 45.2% user, 12.3% sys, 42.5% idle',
  'SharedLibs: 600M resident, 80M data, 50M linkedit.',
].join('\n');

const SAMPLE_SYSCTL_OUTPUT = '38654705664'; // 36GB in bytes

const SAMPLE_VM_STAT_OUTPUT = [
  'Mach Virtual Memory Statistics: (page size of 16384 bytes)',
  'Pages free:                             100000.',
  'Pages active:                           500000.',
  'Pages inactive:                          50000.',
  'Pages speculative:                       20000.',
  'Pages throttled:                             0.',
  'Pages wired down:                       200000.',
  'Pages purgeable:                         30000.',
  'Pages stored in compressor:             100000.',
].join('\n');

const SAMPLE_DF_OUTPUT = [
  'Filesystem  1G-blocks  Used Available Capacity  iused ifree %iused  Mounted on',
  '/dev/disk3s1       460   230       200       54% 1000000 2000000   33%   /',
].join('\n');

// Helper: set up mocks for a full snapshot
const setup_full_mocks = (overrides?: {
  top?: string;
  sysctl?: string;
  vm_stat?: string;
  df?: string;
}) => {
  mocked_exec.mockImplementation((cmd: string) => {
    const command = String(cmd);
    if (command.startsWith('top')) return (overrides?.top ?? SAMPLE_TOP_OUTPUT) as any;
    if (command.startsWith('sysctl')) return (overrides?.sysctl ?? SAMPLE_SYSCTL_OUTPUT) as any;
    if (command.startsWith('vm_stat')) return (overrides?.vm_stat ?? SAMPLE_VM_STAT_OUTPUT) as any;
    if (command.startsWith('df')) return (overrides?.df ?? SAMPLE_DF_OUTPUT) as any;
    return '' as any;
  });
};

describe('Resource Monitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  // === parse_cpu_usage ===

  describe('parse_cpu_usage()', () => {
    it('should parse CPU usage from top output', () => {
      mocked_exec.mockReturnValue(SAMPLE_TOP_OUTPUT as any);

      const result = parse_cpu_usage();

      // 45.2 + 12.3 = 57.5
      expect(result).toBeCloseTo(57.5, 1);
    });

    it('should return 0 on exec failure', () => {
      mocked_exec.mockImplementation(() => { throw new Error('command failed'); });

      expect(parse_cpu_usage()).toBe(0);
    });

    it('should return 0 on unparseable output', () => {
      mocked_exec.mockReturnValue('garbage output' as any);

      expect(parse_cpu_usage()).toBe(0);
    });
  });

  // === parse_memory_usage ===

  describe('parse_memory_usage()', () => {
    it('should parse memory usage from vm_stat and sysctl', () => {
      mocked_exec.mockImplementation((cmd: string) => {
        const command = String(cmd);
        if (command.startsWith('sysctl')) return SAMPLE_SYSCTL_OUTPUT as any;
        if (command.startsWith('vm_stat')) return SAMPLE_VM_STAT_OUTPUT as any;
        return '' as any;
      });

      const result = parse_memory_usage();

      // total_mb = 38654705664 / (1024*1024) = 36864
      expect(result.total_mb).toBe(36864);
      expect(result.used_mb).toBeGreaterThan(0);
      expect(result.used_mb).toBeLessThan(result.total_mb);
    });

    it('should return zeros on exec failure', () => {
      mocked_exec.mockImplementation(() => { throw new Error('fail'); });

      const result = parse_memory_usage();
      expect(result.used_mb).toBe(0);
      expect(result.total_mb).toBe(0);
    });
  });

  // === parse_disk_usage ===

  describe('parse_disk_usage()', () => {
    it('should parse disk usage from df output', () => {
      mocked_exec.mockReturnValue(SAMPLE_DF_OUTPUT as any);

      const result = parse_disk_usage();

      expect(result.total_gb).toBe(460);
      expect(result.used_gb).toBe(230);
    });

    it('should return zeros on exec failure', () => {
      mocked_exec.mockImplementation(() => { throw new Error('fail'); });

      const result = parse_disk_usage();
      expect(result.used_gb).toBe(0);
      expect(result.total_gb).toBe(0);
    });

    it('should return zeros on single-line output', () => {
      mocked_exec.mockReturnValue('Filesystem  1G-blocks  Used Available' as any);

      const result = parse_disk_usage();
      expect(result.used_gb).toBe(0);
      expect(result.total_gb).toBe(0);
    });
  });

  // === take_snapshot ===

  describe('take_snapshot()', () => {
    it('should return a valid ResourceSnapshot', () => {
      setup_full_mocks();

      const monitor = create_resource_monitor({ on_alert: vi.fn() });
      const snapshot = monitor.take_snapshot();

      expect(snapshot).toHaveProperty('timestamp');
      expect(snapshot).toHaveProperty('cpu_usage_percent');
      expect(snapshot).toHaveProperty('memory_used_mb');
      expect(snapshot).toHaveProperty('memory_total_mb');
      expect(snapshot).toHaveProperty('disk_used_gb');
      expect(snapshot).toHaveProperty('disk_total_gb');
      expect(snapshot.cpu_usage_percent).toBeCloseTo(57.5, 1);
      expect(snapshot.memory_total_mb).toBe(36864);
      expect(snapshot.disk_total_gb).toBe(460);
      expect(snapshot.disk_used_gb).toBe(230);
      expect(new Date(snapshot.timestamp).getTime()).not.toBeNaN();
    });
  });

  // === check — threshold alerts ===

  describe('check()', () => {
    it('should fire on_alert when CPU exceeds threshold', async () => {
      setup_full_mocks();
      const on_alert = vi.fn();
      const monitor = create_resource_monitor({ thresholds: { cpu_percent: 50 }, on_alert });
      await monitor.check();
      expect(on_alert).toHaveBeenCalledWith('cpu', expect.closeTo(57.5, 1), 50);
    });

    it('should fire on_alert when memory exceeds threshold', async () => {
      setup_full_mocks();
      const on_alert = vi.fn();
      const monitor = create_resource_monitor({ thresholds: { memory_percent: 80 }, on_alert });
      await monitor.check();
      const memory_call = on_alert.mock.calls.find((c) => c[0] === 'memory');
      expect(memory_call).toBeDefined();
      expect(memory_call![1]).toBeGreaterThan(80);
      expect(memory_call![2]).toBe(80);
    });

    it('should fire on_alert when disk exceeds threshold', async () => {
      setup_full_mocks();
      const on_alert = vi.fn();
      const monitor = create_resource_monitor({ thresholds: { disk_percent: 40 }, on_alert });
      await monitor.check();
      const disk_call = on_alert.mock.calls.find((c) => c[0] === 'disk');
      expect(disk_call).toBeDefined();
      expect(disk_call![1]).toBe(50);
      expect(disk_call![2]).toBe(40);
    });

    it('should NOT fire on_alert when all metrics are below thresholds', async () => {
      setup_full_mocks();
      const on_alert = vi.fn();
      const monitor = create_resource_monitor({
        thresholds: { cpu_percent: 99, memory_percent: 99, disk_percent: 99 },
        on_alert,
      });
      await monitor.check();
      expect(on_alert).not.toHaveBeenCalled();
    });
  });

  // === start / stop ===

  describe('start() / stop()', () => {
    it('should start periodic checks and stop them', async () => {
      setup_full_mocks();
      const on_alert = vi.fn();
      const monitor = create_resource_monitor({ check_interval_ms: 1000, thresholds: { cpu_percent: 50 }, on_alert });
      monitor.start();
      await vi.advanceTimersByTimeAsync(1000);
      expect(on_alert).toHaveBeenCalled();
      on_alert.mockClear();
      monitor.stop();
      await vi.advanceTimersByTimeAsync(2000);
      expect(on_alert).not.toHaveBeenCalled();
    });

    it('should not start twice if already running', () => {
      setup_full_mocks();
      const on_alert = vi.fn();
      const monitor = create_resource_monitor({ check_interval_ms: 1000, on_alert });
      monitor.start();
      monitor.start(); // no-op
      vi.advanceTimersByTime(1000);
      monitor.stop();
    });

    it('should handle stop when not started', () => {
      setup_full_mocks();
      const monitor = create_resource_monitor({ on_alert: vi.fn() });
      expect(() => monitor.stop()).not.toThrow();
    });
  });
});

// ============================================================
// Telegram Alert Handler Tests
// ============================================================

describe('Telegram Alert Handler', () => {
  let send_notification: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    send_notification = vi.fn().mockResolvedValue(undefined);
  });

  describe('CPU sustained alerting', () => {
    it('should NOT send alert on first CPU breach (requires 3 sustained)', async () => {
      const handler = create_telegram_alert_handler({ thresholds: { cpu_percent: 90, cpu_sustained_count: 3 }, send_notification });
      await handler.on_alert('cpu', 95, 85);
      expect(send_notification).not.toHaveBeenCalled();
      expect(handler.get_cpu_breach_count()).toBe(1);
    });

    it('should NOT send alert on second consecutive CPU breach', async () => {
      const handler = create_telegram_alert_handler({ thresholds: { cpu_percent: 90, cpu_sustained_count: 3 }, send_notification });
      await handler.on_alert('cpu', 95, 85);
      await handler.on_alert('cpu', 92, 85);
      expect(send_notification).not.toHaveBeenCalled();
      expect(handler.get_cpu_breach_count()).toBe(2);
    });

    it('should send alert on third consecutive CPU breach (sustained)', async () => {
      const handler = create_telegram_alert_handler({ thresholds: { cpu_percent: 90, cpu_sustained_count: 3 }, send_notification });
      await handler.on_alert('cpu', 95, 85);
      await handler.on_alert('cpu', 92, 85);
      await handler.on_alert('cpu', 91, 85);
      expect(send_notification).toHaveBeenCalledTimes(1);
      const event = send_notification.mock.calls[0][0];
      expect(event.type).toBe('alert');
      expect(event.device).toBe('captain');
      expect(event.severity).toBe('high');
      expect(event.metadata?.metric).toBe('cpu');
      expect(event.metadata?.sustained).toBe(3);
      expect(event.message).toContain('CPU');
      expect(event.message).toContain('WARNING');
    });

    it('should reset CPU breach count when value drops below threshold', async () => {
      const handler = create_telegram_alert_handler({ thresholds: { cpu_percent: 90, cpu_sustained_count: 3 }, send_notification });
      await handler.on_alert('cpu', 95, 85);
      await handler.on_alert('cpu', 92, 85);
      expect(handler.get_cpu_breach_count()).toBe(2);
      await handler.on_alert('cpu', 88, 85);
      expect(handler.get_cpu_breach_count()).toBe(0);
      await handler.on_alert('cpu', 95, 85);
      await handler.on_alert('cpu', 92, 85);
      expect(send_notification).not.toHaveBeenCalled();
    });
  });

  describe('Memory alerting', () => {
    it('should send immediate warning when memory exceeds threshold', async () => {
      const handler = create_telegram_alert_handler({ thresholds: { memory_percent: 85 }, send_notification });
      await handler.on_alert('memory', 88, 80);
      expect(send_notification).toHaveBeenCalledTimes(1);
      const event = send_notification.mock.calls[0][0];
      expect(event.type).toBe('alert');
      expect(event.severity).toBe('high');
      expect(event.metadata?.metric).toBe('memory');
    });

    it('should NOT send alert when memory is below telegram threshold', async () => {
      const handler = create_telegram_alert_handler({ thresholds: { memory_percent: 85 }, send_notification });
      await handler.on_alert('memory', 82, 80);
      expect(send_notification).not.toHaveBeenCalled();
    });
  });

  describe('Disk alerting', () => {
    it('should send immediate critical alert when disk exceeds threshold', async () => {
      const handler = create_telegram_alert_handler({ thresholds: { disk_percent: 90 }, send_notification });
      await handler.on_alert('disk', 95, 85);
      expect(send_notification).toHaveBeenCalledTimes(1);
      const event = send_notification.mock.calls[0][0];
      expect(event.severity).toBe('critical');
      expect(event.metadata?.metric).toBe('disk');
    });

    it('should NOT send alert when disk is below telegram threshold', async () => {
      const handler = create_telegram_alert_handler({ thresholds: { disk_percent: 90 }, send_notification });
      await handler.on_alert('disk', 88, 85);
      expect(send_notification).not.toHaveBeenCalled();
    });
  });

  describe('Cooldown', () => {
    it('should suppress duplicate memory alerts within cooldown period', async () => {
      const handler = create_telegram_alert_handler({ thresholds: { memory_percent: 85, cooldown_ms: 300_000 }, send_notification });
      await handler.on_alert('memory', 90, 80);
      expect(send_notification).toHaveBeenCalledTimes(1);
      await handler.on_alert('memory', 92, 80);
      expect(send_notification).toHaveBeenCalledTimes(1);
    });

    it('should suppress duplicate disk alerts within cooldown period', async () => {
      const handler = create_telegram_alert_handler({ thresholds: { disk_percent: 90, cooldown_ms: 300_000 }, send_notification });
      await handler.on_alert('disk', 95, 85);
      expect(send_notification).toHaveBeenCalledTimes(1);
      await handler.on_alert('disk', 96, 85);
      expect(send_notification).toHaveBeenCalledTimes(1);
    });

    it('should allow alerts after cooldown expires', async () => {
      const handler = create_telegram_alert_handler({ thresholds: { memory_percent: 85, cooldown_ms: 50 }, send_notification });
      await handler.on_alert('memory', 90, 80);
      expect(send_notification).toHaveBeenCalledTimes(1);
      await new Promise(resolve => setTimeout(resolve, 60));
      await handler.on_alert('memory', 91, 80);
      expect(send_notification).toHaveBeenCalledTimes(2);
    });

    it('should track cooldown independently per metric', async () => {
      const handler = create_telegram_alert_handler({ thresholds: { memory_percent: 85, disk_percent: 90, cooldown_ms: 300_000 }, send_notification });
      await handler.on_alert('memory', 90, 80);
      expect(send_notification).toHaveBeenCalledTimes(1);
      await handler.on_alert('disk', 95, 85);
      expect(send_notification).toHaveBeenCalledTimes(2);
      await handler.on_alert('memory', 91, 80);
      expect(send_notification).toHaveBeenCalledTimes(2);
    });
  });

  describe('Device name', () => {
    it('should use captain as default device name', async () => {
      const handler = create_telegram_alert_handler({ thresholds: { memory_percent: 85 }, send_notification });
      await handler.on_alert('memory', 90, 80);
      const event = send_notification.mock.calls[0][0];
      expect(event.device).toBe('captain');
      expect(event.message).toContain('captain');
    });

    it('should use custom device name when provided', async () => {
      const handler = create_telegram_alert_handler({ thresholds: { memory_percent: 85 }, send_notification, device_name: 'hunter' });
      await handler.on_alert('memory', 90, 80);
      const event = send_notification.mock.calls[0][0];
      expect(event.device).toBe('hunter');
      expect(event.message).toContain('hunter');
    });
  });

  describe('reset()', () => {
    it('should reset CPU breach count and cooldown timers', async () => {
      const handler = create_telegram_alert_handler({ thresholds: { cpu_percent: 90, cpu_sustained_count: 3, memory_percent: 85, cooldown_ms: 300_000 }, send_notification });
      await handler.on_alert('cpu', 95, 85);
      await handler.on_alert('cpu', 92, 85);
      expect(handler.get_cpu_breach_count()).toBe(2);
      await handler.on_alert('memory', 90, 80);
      expect(Object.keys(handler.get_last_alert_times()).length).toBeGreaterThan(0);
      handler.reset();
      expect(handler.get_cpu_breach_count()).toBe(0);
      expect(Object.keys(handler.get_last_alert_times()).length).toBe(0);
    });
  });

  describe('Integration with resource monitor', () => {
    it('should work as on_alert callback in create_resource_monitor', async () => {
      setup_full_mocks();
      const handler = create_telegram_alert_handler({
        thresholds: { cpu_percent: 50, cpu_sustained_count: 1, memory_percent: 80, disk_percent: 40, cooldown_ms: 0 },
        send_notification,
      });
      const monitor = create_resource_monitor({
        thresholds: { cpu_percent: 50, memory_percent: 80, disk_percent: 40 },
        on_alert: handler.on_alert,
      });
      await monitor.check();
      expect(send_notification).toHaveBeenCalledTimes(3);
      const metrics = send_notification.mock.calls.map(
        (c: Array<{ metadata?: { metric?: string } }>) => c[0].metadata?.metric,
      );
      expect(metrics).toContain('cpu');
      expect(metrics).toContain('memory');
      expect(metrics).toContain('disk');
    });
  });
});

// ============================================================
// AI Usage Tracker Tests
// ============================================================

describe('AI Usage Tracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe('report_success()', () => {
    it('should increment total and successful request counts', async () => {
      // Given: a fresh tracker
      const tracker = create_ai_usage_tracker();
      // When: reporting 3 successful Claude requests
      await tracker.report_success('claude');
      await tracker.report_success('claude');
      await tracker.report_success('claude');
      // Then: stats reflect 3 successful requests
      const stats = tracker.get_provider_stats('claude');
      expect(stats.total_requests).toBe(3);
      expect(stats.successful_requests).toBe(3);
      expect(stats.failed_requests).toBe(0);
      expect(stats.success_rate).toBe(100);
      expect(stats.last_request_at).not.toBeNull();
    });

    it('should track providers independently', async () => {
      const tracker = create_ai_usage_tracker();
      await tracker.report_success('claude');
      await tracker.report_success('claude');
      await tracker.report_success('gemini');
      expect(tracker.get_provider_stats('claude').total_requests).toBe(2);
      expect(tracker.get_provider_stats('gemini').total_requests).toBe(1);
      expect(tracker.get_provider_stats('chatgpt').total_requests).toBe(0);
    });
  });

  describe('report_failure()', () => {
    it('should increment total and failed request counts', async () => {
      const tracker = create_ai_usage_tracker();
      await tracker.report_failure('claude', 'rate_limit');
      const stats = tracker.get_provider_stats('claude');
      expect(stats.total_requests).toBe(1);
      expect(stats.successful_requests).toBe(0);
      expect(stats.failed_requests).toBe(1);
      expect(stats.last_failure_reason).toBe('rate_limit');
    });

    it('should compute correct success rate with mixed results', async () => {
      const tracker = create_ai_usage_tracker();
      await tracker.report_success('gemini');
      await tracker.report_success('gemini');
      await tracker.report_success('gemini');
      await tracker.report_failure('gemini', 'timeout');
      const stats = tracker.get_provider_stats('gemini');
      expect(stats.success_rate).toBe(75);
      expect(stats.total_requests).toBe(4);
    });

    it('should clear failure reason on subsequent success', async () => {
      const tracker = create_ai_usage_tracker();
      await tracker.report_failure('claude', 'rate_limit');
      expect(tracker.get_provider_stats('claude').last_failure_reason).toBe('rate_limit');
      await tracker.report_success('claude');
      expect(tracker.get_provider_stats('claude').last_failure_reason).toBeUndefined();
    });
  });

  describe('estimated_usage_pct', () => {
    it('should compute usage based on plan limits', async () => {
      const tracker = create_ai_usage_tracker({ plan_limits: { claude: { daily_request_limit: 200 } } });
      for (let i = 0; i < 100; i++) await tracker.report_success('claude');
      expect(tracker.get_provider_stats('claude').estimated_usage_pct).toBe(50);
    });

    it('should handle custom plan limits per provider', async () => {
      const tracker = create_ai_usage_tracker({
        plan_limits: { claude: { daily_request_limit: 100 }, gemini: { daily_request_limit: 50 } },
      });
      for (let i = 0; i < 70; i++) await tracker.report_success('claude');
      for (let i = 0; i < 40; i++) await tracker.report_success('gemini');
      expect(tracker.get_provider_stats('claude').estimated_usage_pct).toBe(70);
      expect(tracker.get_provider_stats('gemini').estimated_usage_pct).toBe(80);
    });
  });

  describe('AI usage alerts', () => {
    it('should fire warning alert when usage exceeds 70%', async () => {
      const on_alert = vi.fn();
      const tracker = create_ai_usage_tracker({
        plan_limits: { claude: { daily_request_limit: 10 } },
        thresholds: { warning_pct: 70, critical_pct: 90 },
        on_alert,
      });
      for (let i = 0; i < 7; i++) await tracker.report_success('claude');
      expect(on_alert).toHaveBeenCalledTimes(1);
      expect(on_alert).toHaveBeenCalledWith(expect.objectContaining({
        provider: 'claude', level: 'warning', usage_pct: 70, threshold: 70,
      }));
    });

    it('should fire critical alert when usage exceeds 90%', async () => {
      const on_alert = vi.fn();
      const tracker = create_ai_usage_tracker({
        plan_limits: { claude: { daily_request_limit: 10 } },
        thresholds: { warning_pct: 70, critical_pct: 90 },
        on_alert,
      });
      for (let i = 0; i < 9; i++) await tracker.report_success('claude');
      expect(on_alert).toHaveBeenCalledTimes(2);
      const levels = on_alert.mock.calls.map((c: AIUsageAlert[]) => c[0].level);
      expect(levels).toContain('warning');
      expect(levels).toContain('critical');
    });

    it('should NOT fire alert when usage is below warning threshold', async () => {
      const on_alert = vi.fn();
      const tracker = create_ai_usage_tracker({
        plan_limits: { claude: { daily_request_limit: 100 } },
        thresholds: { warning_pct: 70 },
        on_alert,
      });
      for (let i = 0; i < 50; i++) await tracker.report_success('claude');
      expect(on_alert).not.toHaveBeenCalled();
    });

    it('should not duplicate alerts at same level', async () => {
      const on_alert = vi.fn();
      const tracker = create_ai_usage_tracker({
        plan_limits: { claude: { daily_request_limit: 10 } },
        thresholds: { warning_pct: 70, critical_pct: 90 },
        on_alert,
      });
      for (let i = 0; i < 8; i++) await tracker.report_success('claude');
      const warning_calls = on_alert.mock.calls.filter((c: AIUsageAlert[]) => c[0].level === 'warning');
      expect(warning_calls.length).toBe(1);
    });
  });

  describe('get_summary()', () => {
    it('should return stats for all three providers', async () => {
      const tracker = create_ai_usage_tracker();
      await tracker.report_success('claude');
      await tracker.report_success('gemini');
      await tracker.report_failure('chatgpt', 'error');
      const summary = tracker.get_summary();
      expect(summary.providers).toHaveLength(3);
      const names = summary.providers.map(p => p.provider);
      expect(names).toContain('claude');
      expect(names).toContain('gemini');
      expect(names).toContain('chatgpt');
      expect(summary.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should compute weighted overall usage', async () => {
      const tracker = create_ai_usage_tracker({
        plan_limits: { claude: { daily_request_limit: 100 }, gemini: { daily_request_limit: 100 }, chatgpt: { daily_request_limit: 100 } },
      });
      for (let i = 0; i < 50; i++) await tracker.report_success('claude');
      for (let i = 0; i < 30; i++) await tracker.report_success('gemini');
      const summary = tracker.get_summary();
      expect(summary.overall_estimated_usage_pct).toBeCloseTo(26.67, 0);
    });
  });

  describe('check_thresholds()', () => {
    it('should return violations for providers above thresholds', async () => {
      const tracker = create_ai_usage_tracker({
        plan_limits: { claude: { daily_request_limit: 10 }, gemini: { daily_request_limit: 10 }, chatgpt: { daily_request_limit: 100 } },
        thresholds: { warning_pct: 70, critical_pct: 90 },
      });
      for (let i = 0; i < 8; i++) await tracker.report_success('claude');
      for (let i = 0; i < 9; i++) await tracker.report_success('gemini');
      for (let i = 0; i < 5; i++) await tracker.report_success('chatgpt');
      const violations = tracker.check_thresholds();
      expect(violations.length).toBe(2);
      const claude_v = violations.find(v => v.provider === 'claude');
      expect(claude_v).toBeDefined();
      expect(claude_v!.level).toBe('warning');
      const gemini_v = violations.find(v => v.provider === 'gemini');
      expect(gemini_v).toBeDefined();
      expect(gemini_v!.level).toBe('critical');
    });

    it('should return empty array when all providers are below thresholds', () => {
      const tracker = create_ai_usage_tracker();
      expect(tracker.check_thresholds()).toEqual([]);
    });
  });

  describe('reset()', () => {
    it('should clear all provider counters', async () => {
      const tracker = create_ai_usage_tracker();
      await tracker.report_success('claude');
      await tracker.report_success('claude');
      await tracker.report_failure('gemini', 'error');
      tracker.reset();
      expect(tracker.get_provider_stats('claude').total_requests).toBe(0);
      expect(tracker.get_provider_stats('gemini').total_requests).toBe(0);
      expect(tracker.get_provider_stats('chatgpt').total_requests).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should return 100% success rate when no requests have been made', () => {
      const tracker = create_ai_usage_tracker();
      expect(tracker.get_provider_stats('claude').success_rate).toBe(100);
    });

    it('should return 0% estimated usage when no requests have been made', () => {
      const tracker = create_ai_usage_tracker();
      expect(tracker.get_provider_stats('claude').estimated_usage_pct).toBe(0);
    });
  });
});

// ============================================================
// Unified Resource Monitor Tests
// ============================================================

describe('Unified Resource Monitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  describe('collect_snapshot()', () => {
    it('should return a valid ResourceSnapshot from system commands', () => {
      setup_full_mocks();
      const monitor = create_unified_monitor();
      const snapshot = monitor.collect_snapshot();
      expect(snapshot.cpu_usage_percent).toBeCloseTo(57.5, 1);
      expect(snapshot.memory_total_mb).toBe(36864);
      expect(snapshot.disk_total_gb).toBe(460);
      expect(snapshot.disk_used_gb).toBe(230);
      expect(new Date(snapshot.timestamp).getTime()).not.toBeNaN();
    });
  });

  describe('check_thresholds()', () => {
    it('should detect system CPU violation when above threshold', async () => {
      setup_full_mocks();
      const on_violation = vi.fn();
      const monitor = create_unified_monitor({
        system_thresholds: { cpu_percent: 50, memory_percent: 99, disk_percent: 99 },
        on_violation,
      });
      const violations = await monitor.check_thresholds();
      const cpu_v = violations.find(v => v.metric === 'cpu');
      expect(cpu_v).toBeDefined();
      expect(cpu_v!.category).toBe('system');
      expect(cpu_v!.value).toBeCloseTo(57.5, 1);
      expect(cpu_v!.threshold).toBe(50);
      expect(on_violation).toHaveBeenCalled();
    });

    it('should detect system memory violation when above threshold', async () => {
      setup_full_mocks();
      const monitor = create_unified_monitor({
        system_thresholds: { cpu_percent: 99, memory_percent: 80, disk_percent: 99 },
      });
      const violations = await monitor.check_thresholds();
      const mem_v = violations.find(v => v.metric === 'memory');
      expect(mem_v).toBeDefined();
      expect(mem_v!.category).toBe('system');
      expect(mem_v!.value).toBeGreaterThan(80);
    });

    it('should detect system disk violation when above threshold', async () => {
      setup_full_mocks();
      const monitor = create_unified_monitor({
        system_thresholds: { cpu_percent: 99, memory_percent: 99, disk_percent: 40 },
      });
      const violations = await monitor.check_thresholds();
      const disk_v = violations.find(v => v.metric === 'disk');
      expect(disk_v).toBeDefined();
      expect(disk_v!.category).toBe('system');
      expect(disk_v!.value).toBe(50);
    });

    it('should include AI usage violations alongside system violations', async () => {
      setup_full_mocks();
      const monitor = create_unified_monitor({
        system_thresholds: { cpu_percent: 99, memory_percent: 99, disk_percent: 99 },
        ai_tracker_config: { plan_limits: { claude: { daily_request_limit: 10 } } },
        ai_usage_thresholds: { warning_pct: 70, critical_pct: 90 },
      });
      const tracker = monitor.get_ai_tracker();
      for (let i = 0; i < 8; i++) await tracker.report_success('claude');
      const violations = await monitor.check_thresholds();
      const ai_v = violations.find(v => v.metric === 'ai_claude');
      expect(ai_v).toBeDefined();
      expect(ai_v!.category).toBe('ai');
      expect(ai_v!.severity).toBe('warning');
    });

    it('should return empty array when everything is within limits', async () => {
      setup_full_mocks();
      const monitor = create_unified_monitor({
        system_thresholds: { cpu_percent: 99, memory_percent: 99, disk_percent: 99 },
      });
      const violations = await monitor.check_thresholds();
      expect(violations).toEqual([]);
    });
  });

  describe('get_ai_usage_summary()', () => {
    it('should return summary with all providers', async () => {
      setup_full_mocks();
      const monitor = create_unified_monitor();
      const tracker = monitor.get_ai_tracker();
      await tracker.report_success('claude');
      await tracker.report_success('gemini');
      const summary = monitor.get_ai_usage_summary();
      expect(summary.providers).toHaveLength(3);
      expect(summary.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const claude_stats = summary.providers.find(p => p.provider === 'claude');
      expect(claude_stats!.total_requests).toBe(1);
    });
  });

  describe('start() / stop()', () => {
    it('should run periodic checks and stop them', async () => {
      setup_full_mocks();
      const on_violation = vi.fn();
      const monitor = create_unified_monitor({
        system_thresholds: { cpu_percent: 50, memory_percent: 99, disk_percent: 99 },
        check_interval_ms: 1000,
        on_violation,
      });
      monitor.start();
      await vi.advanceTimersByTimeAsync(1000);
      expect(on_violation).toHaveBeenCalled();
      on_violation.mockClear();
      monitor.stop();
      await vi.advanceTimersByTimeAsync(2000);
      expect(on_violation).not.toHaveBeenCalled();
    });

    it('should accept override interval_ms in start()', async () => {
      setup_full_mocks();
      const on_violation = vi.fn();
      const monitor = create_unified_monitor({
        system_thresholds: { cpu_percent: 50, memory_percent: 99, disk_percent: 99 },
        check_interval_ms: 60_000,
        on_violation,
      });
      monitor.start(500);
      await vi.advanceTimersByTimeAsync(500);
      expect(on_violation).toHaveBeenCalled();
      monitor.stop();
    });

    it('should not start twice', () => {
      setup_full_mocks();
      const monitor = create_unified_monitor();
      monitor.start();
      monitor.start(); // no-op
      monitor.stop();
    });

    it('should handle stop when not started', () => {
      setup_full_mocks();
      const monitor = create_unified_monitor();
      expect(() => monitor.stop()).not.toThrow();
    });
  });

  describe('get_ai_tracker()', () => {
    it('should return the underlying AI tracker for direct reporting', async () => {
      setup_full_mocks();
      const monitor = create_unified_monitor();
      const tracker = monitor.get_ai_tracker();
      await tracker.report_success('claude');
      await tracker.report_failure('claude', 'rate_limit');
      const stats = tracker.get_provider_stats('claude');
      expect(stats.total_requests).toBe(2);
      expect(stats.successful_requests).toBe(1);
      expect(stats.failed_requests).toBe(1);
    });
  });

  describe('severity classification', () => {
    it('should classify CPU > 95% as critical', async () => {
      const high_cpu_top = [
        'Processes: 450 total, 3 running, 447 sleeping, 2000 threads',
        'Load Avg: 3.12, 2.85, 2.50',
        'CPU usage: 90.0% user, 7.0% sys, 3.0% idle',
        'SharedLibs: 600M resident, 80M data, 50M linkedit.',
      ].join('\n');
      setup_full_mocks({ top: high_cpu_top });
      const monitor = create_unified_monitor({
        system_thresholds: { cpu_percent: 90, memory_percent: 99, disk_percent: 99 },
      });
      const violations = await monitor.check_thresholds();
      const cpu_v = violations.find(v => v.metric === 'cpu');
      expect(cpu_v).toBeDefined();
      expect(cpu_v!.severity).toBe('critical');
      expect(cpu_v!.value).toBeCloseTo(97, 0);
    });

    it('should classify disk > 90% as critical', async () => {
      const high_disk_df = [
        'Filesystem  1G-blocks  Used Available Capacity  iused ifree %iused  Mounted on',
        '/dev/disk3s1       460   420        40       92% 1000000 2000000   33%   /',
      ].join('\n');
      setup_full_mocks({ df: high_disk_df });
      const monitor = create_unified_monitor({
        system_thresholds: { cpu_percent: 99, memory_percent: 99, disk_percent: 80 },
      });
      const violations = await monitor.check_thresholds();
      const disk_v = violations.find(v => v.metric === 'disk');
      expect(disk_v).toBeDefined();
      expect(disk_v!.severity).toBe('critical');
    });
  });
});
