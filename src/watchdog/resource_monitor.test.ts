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
  type ResourceMonitorConfig,
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
      // available = (100000 + 50000 + 20000) * 16384 / (1024*1024) = 170000 * 16384 / 1048576 ≈ 2656.25
      // used = 36864 - 2656.25 ≈ 34208 (rounded)
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

      const monitor = create_resource_monitor({
        on_alert: vi.fn(),
      });

      const snapshot = monitor.take_snapshot();

      // Validate shape
      expect(snapshot).toHaveProperty('timestamp');
      expect(snapshot).toHaveProperty('cpu_usage_percent');
      expect(snapshot).toHaveProperty('memory_used_mb');
      expect(snapshot).toHaveProperty('memory_total_mb');
      expect(snapshot).toHaveProperty('disk_used_gb');
      expect(snapshot).toHaveProperty('disk_total_gb');

      // Validate values from mocked data
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
      // CPU = 45.2 + 12.3 = 57.5%, set threshold to 50%
      setup_full_mocks();
      const on_alert = vi.fn();

      const monitor = create_resource_monitor({
        thresholds: { cpu_percent: 50 },
        on_alert,
      });

      await monitor.check();

      expect(on_alert).toHaveBeenCalledWith('cpu', expect.closeTo(57.5, 1), 50);
    });

    it('should fire on_alert when memory exceeds threshold', async () => {
      // Memory used ≈ 34208 / 36864 ≈ 92.8%, set threshold to 80%
      setup_full_mocks();
      const on_alert = vi.fn();

      const monitor = create_resource_monitor({
        thresholds: { memory_percent: 80 },
        on_alert,
      });

      await monitor.check();

      // Verify memory alert was fired
      const memory_call = on_alert.mock.calls.find((c) => c[0] === 'memory');
      expect(memory_call).toBeDefined();
      expect(memory_call![0]).toBe('memory');
      expect(memory_call![1]).toBeGreaterThan(80);
      expect(memory_call![2]).toBe(80);
    });

    it('should fire on_alert when disk exceeds threshold', async () => {
      // Disk = 230/460 = 50%, set threshold to 40%
      setup_full_mocks();
      const on_alert = vi.fn();

      const monitor = create_resource_monitor({
        thresholds: { disk_percent: 40 },
        on_alert,
      });

      await monitor.check();

      const disk_call = on_alert.mock.calls.find((c) => c[0] === 'disk');
      expect(disk_call).toBeDefined();
      expect(disk_call![0]).toBe('disk');
      expect(disk_call![1]).toBe(50); // 230/460 * 100
      expect(disk_call![2]).toBe(40);
    });

    it('should NOT fire on_alert when all metrics are below thresholds', async () => {
      // CPU = 57.5%, memory ≈ 92.8%, disk = 50%
      // Set thresholds high enough that nothing fires
      setup_full_mocks();
      const on_alert = vi.fn();

      const monitor = create_resource_monitor({
        thresholds: {
          cpu_percent: 99,
          memory_percent: 99,
          disk_percent: 99,
        },
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

      const monitor = create_resource_monitor({
        check_interval_ms: 1000,
        thresholds: { cpu_percent: 50 },
        on_alert,
      });

      monitor.start();

      // Advance time to trigger one interval
      await vi.advanceTimersByTimeAsync(1000);

      // on_alert should have been called (CPU 57.5 > 50)
      expect(on_alert).toHaveBeenCalled();

      // Clear and advance again
      on_alert.mockClear();
      monitor.stop();
      await vi.advanceTimersByTimeAsync(2000);

      // After stop, no more alerts should fire
      expect(on_alert).not.toHaveBeenCalled();
    });

    it('should not start twice if already running', () => {
      setup_full_mocks();
      const on_alert = vi.fn();

      const monitor = create_resource_monitor({
        check_interval_ms: 1000,
        on_alert,
      });

      monitor.start();
      monitor.start(); // should be no-op

      // Advance one interval
      vi.advanceTimersByTime(1000);

      // Only one interval should have been created (one call, not two)
      // Cleanup
      monitor.stop();
    });

    it('should handle stop when not started', () => {
      setup_full_mocks();

      const monitor = create_resource_monitor({
        on_alert: vi.fn(),
      });

      // Should not throw
      expect(() => monitor.stop()).not.toThrow();
    });
  });
});
