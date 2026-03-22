// TDD tests for output watcher
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scan_line, OutputWatcher, create_routed_watcher, type PatternMatch } from './output_watcher.js';
import type { ActivityHooks } from './activity_integration.js';

describe('Output Watcher', () => {
  // === scan_line() — pure function tests ===

  describe('scan_line()', () => {
    it('should detect [APPROVAL_NEEDED] pattern', () => {
      const result = scan_line(
        '[APPROVAL_NEEDED] git push to main requires approval',
        'fas-claude',
      );

      expect(result).not.toBeNull();
      expect(result!.pattern_name).toBe('APPROVAL_NEEDED');
      expect(result!.description).toBe('git push to main requires approval');
      expect(result!.session).toBe('fas-claude');
      expect(result!.timestamp).toBeDefined();
    });

    it('should detect [BLOCKED] pattern', () => {
      const result = scan_line('[BLOCKED] API key not configured', 'fas-gemini-a');

      expect(result).not.toBeNull();
      expect(result!.pattern_name).toBe('BLOCKED');
      expect(result!.description).toBe('API key not configured');
    });

    it('should detect [MILESTONE] pattern', () => {
      const result = scan_line('[MILESTONE] Phase 0 infrastructure complete', 'fas-claude');

      expect(result).not.toBeNull();
      expect(result!.pattern_name).toBe('MILESTONE');
      expect(result!.description).toBe('Phase 0 infrastructure complete');
    });

    it('should detect [DONE] pattern', () => {
      const result = scan_line('[DONE] Crawler setup finished', 'fas-claude');

      expect(result).not.toBeNull();
      expect(result!.pattern_name).toBe('DONE');
      expect(result!.description).toBe('Crawler setup finished');
    });

    it('should detect [ERROR] pattern', () => {
      const result = scan_line('[ERROR] Database connection failed', 'fas-gateway');

      expect(result).not.toBeNull();
      expect(result!.pattern_name).toBe('ERROR');
      expect(result!.description).toBe('Database connection failed');
    });

    it('should detect [LOGIN_REQUIRED] pattern from hunter', () => {
      const result = scan_line(
        '[LOGIN_REQUIRED] Google OAuth session expired on hunter',
        'fas-hunter',
      );

      expect(result).not.toBeNull();
      expect(result!.pattern_name).toBe('LOGIN_REQUIRED');
      expect(result!.description).toBe('Google OAuth session expired on hunter');
      expect(result!.session).toBe('fas-hunter');
    });

    it('should detect [GEMINI_BLOCKED] pattern', () => {
      const result = scan_line(
        "[GEMINI_BLOCKED] Gemini 'gemini-a' crashed 3 times in succession. Manual intervention needed.",
        'fas-gemini-a',
      );

      expect(result).not.toBeNull();
      expect(result!.pattern_name).toBe('GEMINI_BLOCKED');
      expect(result!.description).toBe(
        "Gemini 'gemini-a' crashed 3 times in succession. Manual intervention needed.",
      );
      expect(result!.session).toBe('fas-gemini-a');
    });

    it('should return null for non-matching lines', () => {
      expect(scan_line('Normal log output', 'fas-claude')).toBeNull();
      expect(scan_line('', 'fas-claude')).toBeNull();
      expect(scan_line('compiling src/main.ts...', 'fas-claude')).toBeNull();
    });

    it('should handle pattern at any position in line', () => {
      const result = scan_line(
        '2026-03-17 10:30:00 [MILESTONE] Phase 1 started',
        'fas-claude',
      );

      expect(result).not.toBeNull();
      expect(result!.pattern_name).toBe('MILESTONE');
    });

    it('should handle empty description after pattern', () => {
      const result = scan_line('[BLOCKED]', 'fas-claude');

      expect(result).not.toBeNull();
      expect(result!.pattern_name).toBe('BLOCKED');
      expect(result!.description).toBe('');
    });
  });

  // === OutputWatcher class ===

  describe('OutputWatcher', () => {
    let matches: PatternMatch[];

    beforeEach(() => {
      matches = [];
    });

    it('should create and start/stop without errors', () => {
      const watcher = new OutputWatcher({
        sessions: ['test-session'],
        poll_interval_ms: 100,
        on_match: (match) => { matches.push(match); },
      });

      watcher.start();
      expect(watcher.is_running()).toBe(true);

      watcher.stop();
      expect(watcher.is_running()).toBe(false);
    });

    it('should not start twice', () => {
      const watcher = new OutputWatcher({
        sessions: ['test-session'],
        poll_interval_ms: 100,
        on_match: vi.fn(),
      });

      watcher.start();
      watcher.start(); // should be no-op

      expect(watcher.is_running()).toBe(true);
      watcher.stop();
    });

    it('should accept on_crash and crash_threshold config', () => {
      const on_crash = vi.fn();
      const watcher = new OutputWatcher({
        sessions: ['test-session'],
        poll_interval_ms: 100,
        on_match: vi.fn(),
        on_crash,
        crash_threshold: 5,
      });

      expect(watcher.is_running()).toBe(false);
      watcher.start();
      expect(watcher.is_running()).toBe(true);
      watcher.stop();
    });

    it('should emit started and stopped events', () => {
      const started_handler = vi.fn();
      const stopped_handler = vi.fn();

      const watcher = new OutputWatcher({
        sessions: ['fas-claude'],
        on_match: vi.fn(),
      });

      watcher.on('started', started_handler);
      watcher.on('stopped', stopped_handler);

      watcher.start();
      expect(started_handler).toHaveBeenCalledWith(['fas-claude']);

      watcher.stop();
      expect(stopped_handler).toHaveBeenCalled();
    });
  });

  // === create_routed_watcher AI tracking ===

  describe('create_routed_watcher AI tracking', () => {
    // Helper to create a minimal mock of ActivityHooks
    const create_mock_hooks = (): ActivityHooks => ({
      log_task_created: vi.fn(),
      log_task_completed: vi.fn(),
      log_task_failed: vi.fn(),
      log_hunter_heartbeat: vi.fn(),
      log_notification_sent: vi.fn(),
      log_telegram_command: vi.fn(),
      log_error: vi.fn(),
      log_ai_call: vi.fn(),
    });

    // Helper to create a test PatternMatch
    const make_match = (pattern_name: string, description = 'test description'): PatternMatch => ({
      pattern_name,
      full_match: `[${pattern_name}] ${description}`,
      description,
      timestamp: new Date().toISOString(),
      session: 'fas-claude',
    });

    it('should call log_ai_call with success on DONE pattern', async () => {
      const mock_hooks = create_mock_hooks();
      const watcher = create_routed_watcher(['test-session'], null, 2000, mock_hooks);

      // Trigger on_match via the match event — the watcher emits 'match' and calls on_match internally.
      // Since we can't trigger capture_session directly without tmux, we simulate by
      // creating a watcher and manually invoking the on_match callback through the match event.
      // Instead, we'll use the OutputWatcher's internal on_match callback.
      // The cleanest way: emit 'match' won't call on_match. So we test by creating
      // a watcher with the same logic.

      // Access the on_match callback via a match event listener that verifies hooks were called.
      // Actually, we can use a different approach: test via the OutputWatcher 'match' event
      // which is emitted BEFORE on_match is called, but that only tests event emission.
      // The best approach: spy on the watcher config.

      // Since OutputWatcher stores config, and the on_match is a closure, we need to
      // invoke it directly. We can do this by casting to access the private config.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config = (watcher as unknown as { config: { on_match: (match: PatternMatch) => Promise<void> } }).config;
      await config.on_match(make_match('DONE', 'Task completed successfully'));

      expect(mock_hooks.log_ai_call).toHaveBeenCalledWith('claude', true);
    });

    it('should call log_ai_call with success on MILESTONE pattern', async () => {
      const mock_hooks = create_mock_hooks();
      const watcher = create_routed_watcher(['test-session'], null, 2000, mock_hooks);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config = (watcher as unknown as { config: { on_match: (match: PatternMatch) => Promise<void> } }).config;
      await config.on_match(make_match('MILESTONE', 'Phase 1 complete'));

      expect(mock_hooks.log_ai_call).toHaveBeenCalledWith('claude', true);
    });

    it('should call log_ai_call with failure on ERROR pattern', async () => {
      const mock_hooks = create_mock_hooks();
      const watcher = create_routed_watcher(['test-session'], null, 2000, mock_hooks);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config = (watcher as unknown as { config: { on_match: (match: PatternMatch) => Promise<void> } }).config;
      await config.on_match(make_match('ERROR', 'Database connection failed'));

      expect(mock_hooks.log_ai_call).toHaveBeenCalledWith('claude', false, 'Database connection failed');
    });

    it('should call log_ai_call with blocked prefix on BLOCKED pattern', async () => {
      const mock_hooks = create_mock_hooks();
      const watcher = create_routed_watcher(['test-session'], null, 2000, mock_hooks);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config = (watcher as unknown as { config: { on_match: (match: PatternMatch) => Promise<void> } }).config;
      await config.on_match(make_match('BLOCKED', 'API key not configured'));

      expect(mock_hooks.log_ai_call).toHaveBeenCalledWith('claude', false, 'blocked: API key not configured');
    });

    it('should not call log_ai_call for non-tracked patterns (e.g. APPROVAL_NEEDED)', async () => {
      const mock_hooks = create_mock_hooks();
      const watcher = create_routed_watcher(['test-session'], null, 2000, mock_hooks);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config = (watcher as unknown as { config: { on_match: (match: PatternMatch) => Promise<void> } }).config;
      await config.on_match(make_match('APPROVAL_NEEDED', 'Need human approval'));

      expect(mock_hooks.log_ai_call).not.toHaveBeenCalled();
    });

    it('should work without activity_hooks (backward compatible)', async () => {
      // No activity_hooks passed — should not throw
      const watcher = create_routed_watcher(['test-session'], null, 2000);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config = (watcher as unknown as { config: { on_match: (match: PatternMatch) => Promise<void> } }).config;

      // Should not throw when activity_hooks is undefined
      await expect(config.on_match(make_match('DONE', 'Task done'))).resolves.not.toThrow();
    });

    it('should work with null activity_hooks (backward compatible)', async () => {
      // Explicitly pass null — should not throw
      const watcher = create_routed_watcher(['test-session'], null, 2000, null);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config = (watcher as unknown as { config: { on_match: (match: PatternMatch) => Promise<void> } }).config;

      await expect(config.on_match(make_match('ERROR', 'Something broke'))).resolves.not.toThrow();
    });

    it('should still route notifications when activity_hooks is provided', async () => {
      const mock_hooks = create_mock_hooks();
      const mock_router = {
        route: vi.fn().mockResolvedValue(undefined),
      };
      const watcher = create_routed_watcher(
        ['test-session'],
        mock_router as unknown as import('../notification/router.js').NotificationRouter,
        2000,
        mock_hooks,
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config = (watcher as unknown as { config: { on_match: (match: PatternMatch) => Promise<void> } }).config;
      await config.on_match(make_match('DONE', 'All tasks done'));

      // Both AI tracking and notification routing should fire
      expect(mock_hooks.log_ai_call).toHaveBeenCalledWith('claude', true);
      expect(mock_router.route).toHaveBeenCalled();
    });
  });
});
