// TDD tests for alert_integration — bridges file_logger/crash_recovery to notification router
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  create_log_alert_bridge,
  create_crash_alert_bridge,
  create_daily_log_summary,
  type AlertBridgeConfig,
} from './alert_integration.js';
import type { FileLogger } from './file_logger.js';
import type { CrashMonitor } from './crash_recovery.js';
import type { NotificationRouter } from '../notification/router.js';
import type { NotificationEvent } from '../shared/types.js';

// === Mock factories ===

const create_mock_logger = (): FileLogger => ({
  log: vi.fn(),
  log_approval: vi.fn(),
});

const create_mock_router = (): NotificationRouter & { _routed: NotificationEvent[] } => {
  const _routed: NotificationEvent[] = [];
  return {
    _routed,
    route: vi.fn(async (event: NotificationEvent) => {
      _routed.push(event);
      return { telegram: true, slack: true, notion: false };
    }),
    get_rules: vi.fn(() => ({ telegram: false, slack: true, notion: false })),
  };
};

const create_mock_crash_monitor = (): CrashMonitor => ({
  record_crash: vi.fn((agent: string, error_message: string) => ({
    agent,
    crashed_at: new Date().toISOString(),
    error_message,
    restart_attempt: 1,
  })),
  should_restart: vi.fn(() => true),
  get_crash_history: vi.fn(() => []),
  reset: vi.fn(),
});

// === Tests ===

describe('Alert Integration', () => {
  let mock_logger: FileLogger;
  let mock_router: NotificationRouter & { _routed: NotificationEvent[] };
  let mock_monitor: CrashMonitor;

  beforeEach(() => {
    mock_logger = create_mock_logger();
    mock_router = create_mock_router();
    mock_monitor = create_mock_crash_monitor();
  });

  // === create_log_alert_bridge ===

  describe('create_log_alert_bridge()', () => {
    it('should return an enhanced logger with the same interface', () => {
      const bridge = create_log_alert_bridge({
        logger: mock_logger,
        router: mock_router,
      });

      expect(bridge).toHaveProperty('log');
      expect(bridge).toHaveProperty('log_approval');
    });

    it('should delegate log calls to the underlying logger', () => {
      const bridge = create_log_alert_bridge({
        logger: mock_logger,
        router: mock_router,
      });

      bridge.log('captain', 'info', 'All systems normal');
      expect(mock_logger.log).toHaveBeenCalledWith('captain', 'info', 'All systems normal');
    });

    it('should NOT send notification for info-level logs', () => {
      const bridge = create_log_alert_bridge({
        logger: mock_logger,
        router: mock_router,
      });

      bridge.log('captain', 'info', 'Routine check');
      expect(mock_router.route).not.toHaveBeenCalled();
    });

    it('should NOT send notification for warn-level logs (below default threshold)', () => {
      const bridge = create_log_alert_bridge({
        logger: mock_logger,
        router: mock_router,
      });

      bridge.log('captain', 'warn', 'Minor issue');
      expect(mock_router.route).not.toHaveBeenCalled();
    });

    it('should send Slack alert notification for error-level logs', async () => {
      const bridge = create_log_alert_bridge({
        logger: mock_logger,
        router: mock_router,
      });

      bridge.log('captain', 'error', 'Database connection failed');

      // Wait for async route call
      await vi.waitFor(() => {
        expect(mock_router.route).toHaveBeenCalledTimes(1);
      });

      const routed_event = mock_router._routed[0];
      expect(routed_event.type).toBe('alert');
      expect(routed_event.severity).toBe('high');
      expect(routed_event.message).toContain('captain');
      expect(routed_event.message).toContain('Database connection failed');
      expect(routed_event.device).toBe('captain');
    });

    it('should send Telegram-level notification for critical logs', async () => {
      const bridge = create_log_alert_bridge({
        logger: mock_logger,
        router: mock_router,
      });

      bridge.log('captain', 'critical', 'System completely down');

      await vi.waitFor(() => {
        expect(mock_router.route).toHaveBeenCalledTimes(1);
      });

      const routed_event = mock_router._routed[0];
      expect(routed_event.type).toBe('error');
      expect(routed_event.severity).toBe('critical');
      expect(routed_event.message).toContain('System completely down');
    });

    it('should respect custom slack_error_threshold', async () => {
      const bridge = create_log_alert_bridge({
        logger: mock_logger,
        router: mock_router,
        config: { slack_error_threshold: 'warn' },
      });

      bridge.log('captain', 'warn', 'Custom threshold test');

      await vi.waitFor(() => {
        expect(mock_router.route).toHaveBeenCalledTimes(1);
      });

      expect(mock_router._routed[0].type).toBe('alert');
    });

    it('should delegate log_approval calls unchanged', () => {
      const bridge = create_log_alert_bridge({
        logger: mock_logger,
        router: mock_router,
      });

      const entry = {
        timestamp: '2026-03-21T10:00:00.000Z',
        request_id: 'req-1',
        requester: 'captain',
        action: 'deploy',
        risk_level: 'high',
        decision: 'approved' as const,
        reviewer: 'gemini_a',
        reason: 'Looks good',
        duration_ms: 1500,
      };

      bridge.log_approval(entry);
      expect(mock_logger.log_approval).toHaveBeenCalledWith(entry);
    });

    it('should map hunter agent to hunter device', async () => {
      const bridge = create_log_alert_bridge({
        logger: mock_logger,
        router: mock_router,
      });

      bridge.log('hunter', 'error', 'Hunter error');

      await vi.waitFor(() => {
        expect(mock_router.route).toHaveBeenCalledTimes(1);
      });

      expect(mock_router._routed[0].device).toBe('hunter');
    });

    it('should not crash if router.route fails', async () => {
      const failing_router = {
        ...mock_router,
        route: vi.fn(async () => { throw new Error('Router offline'); }),
        get_rules: mock_router.get_rules,
      };

      const bridge = create_log_alert_bridge({
        logger: mock_logger,
        router: failing_router as unknown as NotificationRouter,
      });

      // Should not throw — fire-and-forget
      expect(() => bridge.log('captain', 'error', 'Test error')).not.toThrow();
    });
  });

  // === create_crash_alert_bridge ===

  describe('create_crash_alert_bridge()', () => {
    it('should return an enhanced monitor with the same interface', () => {
      const bridge = create_crash_alert_bridge({
        monitor: mock_monitor,
        router: mock_router,
      });

      expect(bridge).toHaveProperty('record_crash');
      expect(bridge).toHaveProperty('should_restart');
      expect(bridge).toHaveProperty('get_crash_history');
      expect(bridge).toHaveProperty('reset');
    });

    it('should delegate record_crash to the underlying monitor', () => {
      const bridge = create_crash_alert_bridge({
        monitor: mock_monitor,
        router: mock_router,
      });

      bridge.record_crash('captain', 'OOM');
      expect(mock_monitor.record_crash).toHaveBeenCalledWith('captain', 'OOM');
    });

    it('should send Slack warning when a crash is recorded', async () => {
      const bridge = create_crash_alert_bridge({
        monitor: mock_monitor,
        router: mock_router,
      });

      bridge.record_crash('captain', 'Segfault');

      await vi.waitFor(() => {
        expect(mock_router.route).toHaveBeenCalledTimes(1);
      });

      const routed_event = mock_router._routed[0];
      expect(routed_event.type).toBe('alert');
      expect(routed_event.severity).toBe('high');
      expect(routed_event.message).toContain('captain');
      expect(routed_event.message).toContain('Segfault');
      expect(routed_event.message).toContain('crash');
    });

    it('should send Telegram critical alert when agent is isolated (3 crashes)', async () => {
      // Mock should_restart to return false (= isolated)
      const isolating_monitor = {
        ...mock_monitor,
        should_restart: vi.fn(() => false),
        record_crash: vi.fn((agent: string, error_message: string) => ({
          agent,
          crashed_at: new Date().toISOString(),
          error_message,
          restart_attempt: 3,
        })),
      };

      const bridge = create_crash_alert_bridge({
        monitor: isolating_monitor,
        router: mock_router,
      });

      bridge.record_crash('captain', 'Fatal error third time');

      await vi.waitFor(() => {
        // Should send TWO notifications: crash warning + isolation critical
        expect(mock_router.route).toHaveBeenCalledTimes(2);
      });

      // First: crash notification
      const crash_event = mock_router._routed[0];
      expect(crash_event.type).toBe('alert');
      expect(crash_event.severity).toBe('high');

      // Second: isolation notification (critical → Telegram)
      const isolation_event = mock_router._routed[1];
      expect(isolation_event.type).toBe('error');
      expect(isolation_event.severity).toBe('critical');
      expect(isolation_event.message).toContain('isolated');
    });

    it('should NOT send isolation alert when agent can still restart', async () => {
      // should_restart returns true — no isolation
      const bridge = create_crash_alert_bridge({
        monitor: mock_monitor,
        router: mock_router,
      });

      bridge.record_crash('captain', 'Recoverable error');

      await vi.waitFor(() => {
        expect(mock_router.route).toHaveBeenCalledTimes(1);
      });

      // Only crash warning, no isolation
      expect(mock_router._routed).toHaveLength(1);
      expect(mock_router._routed[0].severity).toBe('high');
    });

    it('should respect crash_telegram_on_isolation config', async () => {
      const isolating_monitor = {
        ...mock_monitor,
        should_restart: vi.fn(() => false),
        record_crash: vi.fn((agent: string, error_message: string) => ({
          agent,
          crashed_at: new Date().toISOString(),
          error_message,
          restart_attempt: 3,
        })),
      };

      const bridge = create_crash_alert_bridge({
        monitor: isolating_monitor,
        router: mock_router,
        config: { crash_telegram_on_isolation: false },
      });

      bridge.record_crash('captain', 'Error');

      await vi.waitFor(() => {
        expect(mock_router.route).toHaveBeenCalled();
      });

      // Only crash warning, no isolation alert
      const critical_events = mock_router._routed.filter(e => e.severity === 'critical');
      expect(critical_events).toHaveLength(0);
    });

    it('should delegate should_restart, get_crash_history, reset unchanged', () => {
      const bridge = create_crash_alert_bridge({
        monitor: mock_monitor,
        router: mock_router,
      });

      bridge.should_restart('captain');
      expect(mock_monitor.should_restart).toHaveBeenCalledWith('captain');

      bridge.get_crash_history('captain');
      expect(mock_monitor.get_crash_history).toHaveBeenCalledWith('captain');

      bridge.reset('captain');
      expect(mock_monitor.reset).toHaveBeenCalledWith('captain');
    });

    it('should not crash if router.route fails during crash recording', async () => {
      const failing_router = {
        ...mock_router,
        route: vi.fn(async () => { throw new Error('Network down'); }),
        get_rules: mock_router.get_rules,
      };

      const bridge = create_crash_alert_bridge({
        monitor: mock_monitor,
        router: failing_router as unknown as NotificationRouter,
      });

      // Should not throw
      const record = bridge.record_crash('captain', 'Test');
      expect(record).toBeDefined();
      expect(record.agent).toBe('captain');
    });
  });

  // === create_daily_log_summary ===

  describe('create_daily_log_summary()', () => {
    it('should generate summary with counts per level', () => {
      const fs = require('node:fs');
      const os = require('node:os');
      const path = require('node:path');

      const tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fas-summary-'));
      const agent_dir = path.join(tmp_dir, 'captain');
      fs.mkdirSync(agent_dir, { recursive: true });

      // Write sample log file
      const log_lines = [
        '[2026-03-21 08:00:00] [INFO] captain: Started',
        '[2026-03-21 08:01:00] [INFO] captain: Processing task',
        '[2026-03-21 08:02:00] [WARN] captain: Slow query',
        '[2026-03-21 08:03:00] [ERROR] captain: DB timeout',
        '[2026-03-21 08:04:00] [CRITICAL] captain: System failure',
        '[2026-03-21 08:05:00] [INFO] captain: Recovered',
        '[2026-03-21 08:06:00] [DEBUG] captain: Debug trace',
      ].join('\n') + '\n';

      fs.writeFileSync(path.join(agent_dir, '2026-03-21.log'), log_lines);

      // Also create hunter logs
      const hunter_dir = path.join(tmp_dir, 'hunter');
      fs.mkdirSync(hunter_dir, { recursive: true });
      const hunter_lines = [
        '[2026-03-21 09:00:00] [INFO] hunter: Crawling',
        '[2026-03-21 09:01:00] [ERROR] hunter: 404 Not Found',
      ].join('\n') + '\n';
      fs.writeFileSync(path.join(hunter_dir, '2026-03-21.log'), hunter_lines);

      const summary = create_daily_log_summary(tmp_dir, '2026-03-21');

      expect(summary.date).toBe('2026-03-21');
      expect(summary.agents).toHaveProperty('captain');
      expect(summary.agents).toHaveProperty('hunter');

      // Captain counts
      expect(summary.agents['captain'].debug).toBe(1);
      expect(summary.agents['captain'].info).toBe(3);
      expect(summary.agents['captain'].warn).toBe(1);
      expect(summary.agents['captain'].error).toBe(1);
      expect(summary.agents['captain'].critical).toBe(1);
      expect(summary.agents['captain'].total).toBe(7);

      // Hunter counts
      expect(summary.agents['hunter'].info).toBe(1);
      expect(summary.agents['hunter'].error).toBe(1);
      expect(summary.agents['hunter'].total).toBe(2);

      // Totals
      expect(summary.total_entries).toBe(9);
      expect(summary.total_errors).toBe(2);
      expect(summary.total_critical).toBe(1);

      // Cleanup
      fs.rmSync(tmp_dir, { recursive: true, force: true });
    });

    it('should return empty summary when no logs exist for date', () => {
      const fs = require('node:fs');
      const os = require('node:os');
      const path = require('node:path');

      const tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fas-summary-'));

      const summary = create_daily_log_summary(tmp_dir, '2026-03-21');

      expect(summary.date).toBe('2026-03-21');
      expect(summary.agents).toEqual({});
      expect(summary.total_entries).toBe(0);
      expect(summary.total_errors).toBe(0);
      expect(summary.total_critical).toBe(0);

      fs.rmSync(tmp_dir, { recursive: true, force: true });
    });

    it('should return empty summary when base_dir does not exist', () => {
      const summary = create_daily_log_summary('/nonexistent/path', '2026-03-21');

      expect(summary.date).toBe('2026-03-21');
      expect(summary.agents).toEqual({});
      expect(summary.total_entries).toBe(0);
    });

    it('should generate formatted text summary', () => {
      const fs = require('node:fs');
      const os = require('node:os');
      const path = require('node:path');

      const tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fas-summary-'));
      const agent_dir = path.join(tmp_dir, 'captain');
      fs.mkdirSync(agent_dir, { recursive: true });

      const log_lines = [
        '[2026-03-21 08:00:00] [ERROR] captain: Something broke',
      ].join('\n') + '\n';
      fs.writeFileSync(path.join(agent_dir, '2026-03-21.log'), log_lines);

      const summary = create_daily_log_summary(tmp_dir, '2026-03-21');

      expect(summary.formatted_text).toContain('2026-03-21');
      expect(summary.formatted_text).toContain('captain');
      expect(summary.formatted_text).toContain('error');

      fs.rmSync(tmp_dir, { recursive: true, force: true });
    });
  });
});
