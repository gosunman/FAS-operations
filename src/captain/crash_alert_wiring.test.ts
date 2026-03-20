// Tests for crash recovery alert bridge wiring in captain main.ts
// Verifies that crash_monitor is wrapped with alert bridge and routes to Telegram.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create_crash_monitor, type CrashMonitor } from '../watchdog/crash_recovery.js';
import { create_crash_alert_bridge } from '../watchdog/alert_integration.js';
import type { NotificationRouter } from '../notification/router.js';
import type { NotificationEvent } from '../shared/types.js';

// === Mock router that captures routed events ===

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

describe('Crash Alert Wiring (captain main pattern)', () => {
  let mock_router: NotificationRouter & { _routed: NotificationEvent[] };

  beforeEach(() => {
    mock_router = create_mock_router();
  });

  it('should wire crash monitor through alert bridge with same config as main.ts', () => {
    // Mirrors the exact wiring pattern from main.ts
    const raw_monitor = create_crash_monitor({
      state_path: '/tmp/fas-test-crash-wiring.json',
      max_restarts: 3,
      cooldown_ms: 30_000,
    });

    const bridged_monitor = create_crash_alert_bridge({
      monitor: raw_monitor,
      router: mock_router,
      config: { crash_telegram_on_isolation: true },
    });

    // Verify the bridge returns a CrashMonitor-compatible interface
    expect(bridged_monitor).toHaveProperty('record_crash');
    expect(bridged_monitor).toHaveProperty('should_restart');
    expect(bridged_monitor).toHaveProperty('get_crash_history');
    expect(bridged_monitor).toHaveProperty('reset');

    // Clean up state file
    try { require('node:fs').unlinkSync('/tmp/fas-test-crash-wiring.json'); } catch {}
  });

  it('should route crash events to Telegram via notification router', async () => {
    const raw_monitor = create_crash_monitor({
      state_path: '/tmp/fas-test-crash-route.json',
      max_restarts: 3,
      cooldown_ms: 30_000,
    });

    const bridged_monitor = create_crash_alert_bridge({
      monitor: raw_monitor,
      router: mock_router,
      config: { crash_telegram_on_isolation: true },
    });

    // Record a crash — should fire a Slack alert
    bridged_monitor.record_crash('captain', 'OOM killed');

    await vi.waitFor(() => {
      expect(mock_router.route).toHaveBeenCalledTimes(1);
    });

    const event = mock_router._routed[0];
    expect(event.type).toBe('alert');
    expect(event.severity).toBe('high');
    expect(event.message).toContain('captain');
    expect(event.message).toContain('OOM killed');
    expect(event.device).toBe('captain');

    // Clean up
    try { require('node:fs').unlinkSync('/tmp/fas-test-crash-route.json'); } catch {}
  });

  it('should send critical Telegram alert when agent is isolated after 3 crashes', async () => {
    const raw_monitor = create_crash_monitor({
      state_path: '/tmp/fas-test-crash-isolation.json',
      max_restarts: 3,
      cooldown_ms: 30_000,
    });

    const bridged_monitor = create_crash_alert_bridge({
      monitor: raw_monitor,
      router: mock_router,
      config: { crash_telegram_on_isolation: true },
    });

    // Crash 3 times to trigger isolation
    bridged_monitor.record_crash('captain', 'Error 1');
    bridged_monitor.record_crash('captain', 'Error 2');
    bridged_monitor.record_crash('captain', 'Error 3');

    await vi.waitFor(() => {
      // 3 crash alerts + 1 isolation alert = 4 route calls
      expect(mock_router.route).toHaveBeenCalledTimes(4);
    });

    // The last event should be the critical isolation alert
    const isolation_event = mock_router._routed[3];
    expect(isolation_event.type).toBe('error');
    expect(isolation_event.severity).toBe('critical');
    expect(isolation_event.message).toContain('ISOLATED');
    expect(isolation_event.message).toContain('captain');
    expect(isolation_event.message).toContain('Manual intervention required');

    // Verify the agent is now isolated
    expect(bridged_monitor.should_restart('captain')).toBe(false);

    // Clean up
    try { require('node:fs').unlinkSync('/tmp/fas-test-crash-isolation.json'); } catch {}
  });

  it('should preserve crash history through the bridge', () => {
    const raw_monitor = create_crash_monitor({
      state_path: '/tmp/fas-test-crash-history.json',
      max_restarts: 3,
      cooldown_ms: 30_000,
    });

    const bridged_monitor = create_crash_alert_bridge({
      monitor: raw_monitor,
      router: mock_router,
      config: { crash_telegram_on_isolation: true },
    });

    bridged_monitor.record_crash('hunter', 'Network timeout');
    const history = bridged_monitor.get_crash_history('hunter');

    expect(history).toHaveLength(1);
    expect(history[0].agent).toBe('hunter');
    expect(history[0].error_message).toBe('Network timeout');
    expect(history[0].restart_attempt).toBe(1);

    // Clean up
    try { require('node:fs').unlinkSync('/tmp/fas-test-crash-history.json'); } catch {}
  });

  it('should reset crash history through the bridge', () => {
    const raw_monitor = create_crash_monitor({
      state_path: '/tmp/fas-test-crash-reset.json',
      max_restarts: 3,
      cooldown_ms: 30_000,
    });

    const bridged_monitor = create_crash_alert_bridge({
      monitor: raw_monitor,
      router: mock_router,
      config: { crash_telegram_on_isolation: true },
    });

    bridged_monitor.record_crash('captain', 'Error');
    bridged_monitor.reset('captain');

    expect(bridged_monitor.get_crash_history('captain')).toHaveLength(0);
    expect(bridged_monitor.should_restart('captain')).toBe(true);

    // Clean up
    try { require('node:fs').unlinkSync('/tmp/fas-test-crash-reset.json'); } catch {}
  });
});
