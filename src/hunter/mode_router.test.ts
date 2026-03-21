// Tests for hunter mode router
// Verifies Captain health monitoring and mode transitions

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { create_mode_router, type ModeRouterDeps } from './mode_router.js';
import type { Logger } from './logger.js';
import type { HunterConfig } from './config.js';
import type { HunterNotify } from './notify.js';

const mock_logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const mock_config: HunterConfig = {
  captain_api_url: 'http://captain.local:3100',
  poll_interval_ms: 10000,
  log_dir: './logs',
  device_name: 'hunter',
  google_profile_dir: './fas-google-profile-hunter',
  deep_research_timeout_ms: 300000,
  notebooklm_timeout_ms: 180000,
  chatgpt_timeout_ms: 180000,
  autonomous_db_path: './data/hunter_projects.db',
  reports_dir: './reports',
  scout_interval_ms: 21600000,
  openclaw_command: 'openclaw',
  openclaw_agent: 'main',
  captain_health_check_interval_ms: 30000,
  captain_failure_threshold: 3,
};

const mock_notify: HunterNotify = {
  send_telegram: vi.fn().mockResolvedValue(true),
  send_slack: vi.fn().mockResolvedValue(true),
  alert: vi.fn().mockResolvedValue(undefined),
  report: vi.fn().mockResolvedValue(undefined),
  is_configured: vi.fn().mockReturnValue(true),
};

describe('mode_router', () => {
  let mock_fetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    mock_fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', mock_fetch);

    // Re-create mock_notify spies after restoreAllMocks
    mock_notify.send_telegram = vi.fn().mockResolvedValue(true);
    mock_notify.send_slack = vi.fn().mockResolvedValue(true);
    mock_notify.alert = vi.fn().mockResolvedValue(undefined);
    mock_notify.report = vi.fn().mockResolvedValue(undefined);
    mock_notify.is_configured = vi.fn().mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const make_deps = (overrides?: Partial<ModeRouterDeps>): ModeRouterDeps => ({
    config: mock_config,
    logger: mock_logger,
    notify: mock_notify,
    ...overrides,
  });

  // --- Initial state ---

  it('should start in captain mode', () => {
    // Given
    const router = create_mode_router(make_deps());

    // When
    const state = router.get_state();

    // Then
    expect(state.current_mode).toBe('captain');
    expect(state.consecutive_failures).toBe(0);
    expect(state.last_check_at).toBeNull();
    expect(state.last_transition_at).toBeNull();
    expect(router.get_mode()).toBe('captain');
  });

  // --- Successful health checks ---

  it('should stay in captain mode when health checks succeed', async () => {
    // Given — fetch returns 200 OK
    const router = create_mode_router(make_deps());

    // When — multiple successful checks
    await router.check_captain_health();
    await router.check_captain_health();
    await router.check_captain_health();

    // Then — still in captain mode with zero failures
    expect(router.get_mode()).toBe('captain');
    expect(router.get_state().consecutive_failures).toBe(0);
    expect(router.get_state().last_check_at).not.toBeNull();
    expect(mock_notify.alert).not.toHaveBeenCalled();
  });

  it('should call the correct health endpoint', async () => {
    // Given
    const router = create_mode_router(make_deps());

    // When
    await router.check_captain_health();

    // Then
    expect(mock_fetch).toHaveBeenCalledOnce();
    const [url, options] = mock_fetch.mock.calls[0];
    expect(url).toBe('http://captain.local:3100/api/health');
    expect(options.signal).toBeDefined();
  });

  // --- Transition to autonomous mode ---

  it('should switch to autonomous mode after N consecutive failures', async () => {
    // Given — fetch always fails
    mock_fetch.mockRejectedValue(new Error('Connection refused'));
    const router = create_mode_router(make_deps());

    // When — fail exactly threshold (3) times
    await router.check_captain_health(); // failure 1
    await router.check_captain_health(); // failure 2
    await router.check_captain_health(); // failure 3 → transition

    // Then
    expect(router.get_mode()).toBe('autonomous');
    expect(router.get_state().consecutive_failures).toBe(3);
    expect(router.get_state().last_transition_at).not.toBeNull();
  });

  it('should not switch to autonomous before reaching threshold', async () => {
    // Given — fetch fails with HTTP 503
    mock_fetch.mockResolvedValue({ ok: false, status: 503 });
    const router = create_mode_router(make_deps());

    // When — fail fewer times than threshold
    await router.check_captain_health(); // failure 1
    await router.check_captain_health(); // failure 2

    // Then — still in captain mode
    expect(router.get_mode()).toBe('captain');
    expect(router.get_state().consecutive_failures).toBe(2);
  });

  it('should handle non-200 responses as failures', async () => {
    // Given — fetch returns 500
    mock_fetch.mockResolvedValue({ ok: false, status: 500 });
    const router = create_mode_router(make_deps());

    // When
    await router.check_captain_health();

    // Then
    expect(router.get_state().consecutive_failures).toBe(1);
    expect(router.get_mode()).toBe('captain');
  });

  // --- Transition back to captain mode ---

  it('should switch back to captain mode when health check recovers', async () => {
    // Given — fail 3 times to enter autonomous mode
    mock_fetch.mockRejectedValue(new Error('Connection refused'));
    const router = create_mode_router(make_deps());

    await router.check_captain_health();
    await router.check_captain_health();
    await router.check_captain_health();
    expect(router.get_mode()).toBe('autonomous');

    // When — Captain recovers
    mock_fetch.mockResolvedValue({ ok: true, status: 200 });
    await router.check_captain_health();

    // Then — back in captain mode
    expect(router.get_mode()).toBe('captain');
    expect(router.get_state().consecutive_failures).toBe(0);
  });

  it('should reset consecutive_failures on successful health check', async () => {
    // Given — 2 failures, then success
    mock_fetch.mockRejectedValue(new Error('timeout'));
    const router = create_mode_router(make_deps());

    await router.check_captain_health(); // failure 1
    await router.check_captain_health(); // failure 2
    expect(router.get_state().consecutive_failures).toBe(2);

    // When — success resets counter
    mock_fetch.mockResolvedValue({ ok: true, status: 200 });
    await router.check_captain_health();

    // Then
    expect(router.get_state().consecutive_failures).toBe(0);
    expect(router.get_mode()).toBe('captain');
  });

  // --- Telegram notification on transition ---

  it('should send Telegram alert when switching to autonomous mode', async () => {
    // Given
    mock_fetch.mockRejectedValue(new Error('Connection refused'));
    const router = create_mode_router(make_deps());

    // When — reach failure threshold
    await router.check_captain_health();
    await router.check_captain_health();
    await router.check_captain_health();

    // Then — alert sent with failure count
    expect(mock_notify.alert).toHaveBeenCalledOnce();
    const alert_message = (mock_notify.alert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(alert_message).toContain('AUTONOMOUS');
    expect(alert_message).toContain('3 failures');
  });

  it('should send Telegram alert when switching back to captain mode', async () => {
    // Given — enter autonomous mode
    mock_fetch.mockRejectedValue(new Error('Connection refused'));
    const router = create_mode_router(make_deps());

    await router.check_captain_health();
    await router.check_captain_health();
    await router.check_captain_health();
    expect(mock_notify.alert).toHaveBeenCalledOnce();

    // When — Captain recovers
    mock_fetch.mockResolvedValue({ ok: true, status: 200 });
    await router.check_captain_health();

    // Then — second alert for recovery
    expect(mock_notify.alert).toHaveBeenCalledTimes(2);
    const recovery_message = (mock_notify.alert as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(recovery_message).toContain('CAPTAIN');
    expect(recovery_message).toContain('reconnected');
  });

  // --- Idempotent transitions ---

  it('should not re-trigger transition if already in autonomous mode', async () => {
    // Given — enter autonomous mode
    mock_fetch.mockRejectedValue(new Error('Connection refused'));
    const router = create_mode_router(make_deps());

    await router.check_captain_health();
    await router.check_captain_health();
    await router.check_captain_health(); // → autonomous
    expect(mock_notify.alert).toHaveBeenCalledOnce();

    // When — more failures continue
    await router.check_captain_health(); // failure 4
    await router.check_captain_health(); // failure 5

    // Then — no additional transition alerts
    expect(mock_notify.alert).toHaveBeenCalledOnce();
    expect(router.get_mode()).toBe('autonomous');
    expect(router.get_state().consecutive_failures).toBe(5);
  });

  it('should not re-trigger transition if already in captain mode on success', async () => {
    // Given — already in captain mode (default)
    const router = create_mode_router(make_deps());

    // When — health check succeeds
    await router.check_captain_health();

    // Then — no alert, no transition
    expect(mock_notify.alert).not.toHaveBeenCalled();
    expect(router.get_state().last_transition_at).toBeNull();
  });

  // --- Works without notify ---

  it('should work without notify dependency', async () => {
    // Given — no notify provided
    mock_fetch.mockRejectedValue(new Error('Connection refused'));
    const router = create_mode_router(make_deps({ notify: undefined }));

    // When — reach failure threshold
    await router.check_captain_health();
    await router.check_captain_health();
    await router.check_captain_health();

    // Then — mode switches even without notifications
    expect(router.get_mode()).toBe('autonomous');
  });

  it('should not fail if notify.alert throws', async () => {
    // Given — notify.alert rejects
    const broken_notify: HunterNotify = {
      ...mock_notify,
      alert: vi.fn().mockRejectedValue(new Error('Telegram API down')),
    };
    mock_fetch.mockRejectedValue(new Error('Connection refused'));
    const router = create_mode_router(make_deps({ notify: broken_notify }));

    // When — reach failure threshold
    await router.check_captain_health();
    await router.check_captain_health();
    await router.check_captain_health();

    // Then — mode still switches despite notification failure
    expect(router.get_mode()).toBe('autonomous');
  });

  // --- Custom threshold ---

  it('should respect custom failure threshold', async () => {
    // Given — threshold set to 5
    const custom_config = { ...mock_config, captain_failure_threshold: 5 };
    mock_fetch.mockRejectedValue(new Error('Connection refused'));
    const router = create_mode_router(make_deps({ config: custom_config }));

    // When — fail 4 times (below threshold)
    await router.check_captain_health();
    await router.check_captain_health();
    await router.check_captain_health();
    await router.check_captain_health();

    // Then — still captain mode
    expect(router.get_mode()).toBe('captain');

    // When — 5th failure reaches threshold
    await router.check_captain_health();

    // Then — now autonomous
    expect(router.get_mode()).toBe('autonomous');
  });

  // --- Health check return value ---

  it('should return true on successful health check', async () => {
    // Given
    const router = create_mode_router(make_deps());

    // When
    const result = await router.check_captain_health();

    // Then
    expect(result).toBe(true);
  });

  it('should return false on failed health check', async () => {
    // Given
    mock_fetch.mockRejectedValue(new Error('Network error'));
    const router = create_mode_router(make_deps());

    // When
    const result = await router.check_captain_health();

    // Then
    expect(result).toBe(false);
  });

  // --- Start / Stop ---

  it('should start periodic health checking with start()', () => {
    // Given
    vi.useFakeTimers();
    const router = create_mode_router(make_deps());

    // When
    router.start();

    // Then — immediate check + one interval fired
    expect(mock_fetch).toHaveBeenCalledOnce(); // immediate check

    vi.advanceTimersByTime(30000);
    expect(mock_fetch).toHaveBeenCalledTimes(2); // interval check

    router.stop();
    vi.useRealTimers();
  });

  it('should stop periodic health checking with stop()', () => {
    // Given
    vi.useFakeTimers();
    const router = create_mode_router(make_deps());
    router.start();
    expect(mock_fetch).toHaveBeenCalledOnce();

    // When
    router.stop();
    vi.advanceTimersByTime(60000);

    // Then — no more checks after stop
    expect(mock_fetch).toHaveBeenCalledOnce();

    vi.useRealTimers();
  });

  it('should not start twice if already running', () => {
    // Given
    vi.useFakeTimers();
    const router = create_mode_router(make_deps());

    // When — call start twice
    router.start();
    router.start();

    // Then — only one immediate check
    expect(mock_fetch).toHaveBeenCalledOnce();

    router.stop();
    vi.useRealTimers();
  });
});
