// TDD tests for Gemini Fallback system
// Tests: GeminiFallback wrapper, UsageMonitor, and integration with daemon
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GeminiResponse } from '../../src/gemini/types.js';

// === Mock child_process for gemini CLI calls ===
vi.mock('node:child_process', () => {
  const { EventEmitter } = require('node:events');
  const { Readable } = require('node:stream');

  const create_mock_process = () => {
    const proc = new EventEmitter();
    proc.stdout = new Readable({ read() {} });
    proc.stderr = new Readable({ read() {} });
    return proc;
  };

  return {
    spawn: vi.fn(() => {
      const proc = create_mock_process();
      setTimeout(() => {
        proc.stdout.push('Gemini fallback response');
        proc.stdout.push(null);
        proc.emit('close', 0);
      }, 10);
      return proc;
    }),
    execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
      cb(null, 'Gemini fallback response', '');
      return create_mock_process();
    }),
    execSync: vi.fn(() => ''),
  };
});

// === Mock fs for usage monitor ===
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal() as Record<string, unknown>;
  return {
    ...original,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => ''),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

// =====================================================
// GeminiFallback tests
// =====================================================

describe('GeminiFallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('create_gemini_fallback()', () => {
    it('should create a fallback instance with default config', async () => {
      // Given: default configuration
      const { create_gemini_fallback } = await import('../../src/daemon/gemini_fallback.js');

      // When: creating fallback instance
      const fallback = create_gemini_fallback();

      // Then: instance is created with correct interface
      expect(fallback).toBeDefined();
      expect(typeof fallback.process_message).toBe('function');
      expect(typeof fallback.review_task_result).toBe('function');
      expect(typeof fallback.is_available).toBe('function');
    });

    it('should accept custom gemini config', async () => {
      const { create_gemini_fallback } = await import('../../src/daemon/gemini_fallback.js');

      // When: creating with custom config
      const fallback = create_gemini_fallback({
        timeout_ms: 60_000,
        model: 'gemini-2.5-flash',
      });

      // Then: instance is created
      expect(fallback).toBeDefined();
    });
  });

  describe('process_message()', () => {
    it('should send a message to Gemini CLI and return response', async () => {
      const { create_gemini_fallback } = await import('../../src/daemon/gemini_fallback.js');
      const fallback = create_gemini_fallback();

      // When: processing a message
      const result = await fallback.process_message('Hello, what is the status?');

      // Then: returns a successful response
      expect(result.success).toBe(true);
      expect(result.content).toBeTruthy();
    });

    it('should include captain context in the prompt', async () => {
      const { spawn } = await import('node:child_process');
      const { create_gemini_fallback } = await import('../../src/daemon/gemini_fallback.js');
      const fallback = create_gemini_fallback();

      // When: processing a message
      await fallback.process_message('How are things going?');

      // Then: prompt includes captain fallback context
      const call_args = vi.mocked(spawn).mock.calls;
      expect(call_args.length).toBeGreaterThan(0);
      const prompt_arg = call_args[0][1] as string[];
      const full_prompt = prompt_arg.join(' ');
      expect(full_prompt).toContain('FAS');
    });

    it('should handle Gemini CLI failure gracefully', async () => {
      const { spawn } = await import('node:child_process');
      const { EventEmitter } = await import('node:events');
      const { Readable } = await import('node:stream');

      vi.mocked(spawn).mockImplementationOnce(() => {
        const proc = new EventEmitter() as ReturnType<typeof spawn>;
        (proc as Record<string, unknown>).stdout = new Readable({ read() {} });
        (proc as Record<string, unknown>).stderr = new Readable({ read() {} });
        setTimeout(() => {
          (proc as Record<string, unknown> & { stderr: Readable }).stderr.push('Gemini error');
          (proc as Record<string, unknown> & { stderr: Readable }).stderr.push(null);
          proc.emit('close', 1);
        }, 10);
        return proc;
      });

      const { create_gemini_fallback } = await import('../../src/daemon/gemini_fallback.js');
      const fallback = create_gemini_fallback();

      // When: processing a message that fails
      const result = await fallback.process_message('test');

      // Then: returns failure without throwing
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  describe('review_task_result()', () => {
    it('should create a review prompt with task context', async () => {
      const { spawn } = await import('node:child_process');
      const { create_gemini_fallback } = await import('../../src/daemon/gemini_fallback.js');
      const fallback = create_gemini_fallback();

      // When: reviewing a task result
      await fallback.review_task_result(
        'task-123',
        'Web crawl results',
        'Found 5 articles about AI trends',
      );

      // Then: prompt contains task review context
      const call_args = vi.mocked(spawn).mock.calls;
      expect(call_args.length).toBeGreaterThan(0);
    });

    it('should return a structured review response', async () => {
      const { create_gemini_fallback } = await import('../../src/daemon/gemini_fallback.js');
      const fallback = create_gemini_fallback();

      // When: reviewing a task result
      const result = await fallback.review_task_result(
        'task-123',
        'Research task',
        'Detailed findings...',
      );

      // Then: returns a response (success or failure)
      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
      expect(typeof result.content).toBe('string');
    });
  });

  describe('is_available()', () => {
    it('should return true when gemini CLI is accessible', async () => {
      const { create_gemini_fallback } = await import('../../src/daemon/gemini_fallback.js');
      const fallback = create_gemini_fallback();

      // When: checking availability
      const available = await fallback.is_available();

      // Then: returns true (mocked spawn succeeds)
      expect(available).toBe(true);
    });

    it('should return false when gemini CLI is not found', async () => {
      const { spawn } = await import('node:child_process');
      const { EventEmitter } = await import('node:events');
      const { Readable } = await import('node:stream');

      vi.mocked(spawn).mockImplementationOnce(() => {
        const proc = new EventEmitter() as ReturnType<typeof spawn>;
        (proc as Record<string, unknown>).stdout = new Readable({ read() {} });
        (proc as Record<string, unknown>).stderr = new Readable({ read() {} });
        setTimeout(() => {
          proc.emit('error', new Error('ENOENT: gemini not found'));
        }, 10);
        return proc;
      });

      const { create_gemini_fallback } = await import('../../src/daemon/gemini_fallback.js');
      const fallback = create_gemini_fallback();

      // When: checking availability
      const available = await fallback.is_available();

      // Then: returns false
      expect(available).toBe(false);
    });
  });
});

// =====================================================
// UsageMonitor tests
// =====================================================

describe('UsageMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('create_usage_monitor()', () => {
    it('should create a monitor instance with default config', async () => {
      const { create_usage_monitor } = await import('../../src/daemon/usage_monitor.js');

      // When: creating monitor
      const monitor = create_usage_monitor();

      // Then: instance has correct interface
      expect(monitor).toBeDefined();
      expect(typeof monitor.get_status).toBe('function');
      expect(typeof monitor.get_mode).toBe('function');
      expect(typeof monitor.force_mode).toBe('function');
      expect(typeof monitor.on_mode_change).toBe('function');
      expect(typeof monitor.start).toBe('function');
      expect(typeof monitor.stop).toBe('function');
    });
  });

  describe('get_mode()', () => {
    it('should return normal mode by default', async () => {
      const { create_usage_monitor } = await import('../../src/daemon/usage_monitor.js');
      const monitor = create_usage_monitor();

      // When: getting initial mode
      const mode = monitor.get_mode();

      // Then: starts in normal mode
      expect(mode).toBe('normal');
    });
  });

  describe('force_mode()', () => {
    it('should allow forcing fallback mode', async () => {
      const { create_usage_monitor } = await import('../../src/daemon/usage_monitor.js');
      const monitor = create_usage_monitor();

      // When: forcing fallback mode
      monitor.force_mode('fallback');

      // Then: mode changes
      expect(monitor.get_mode()).toBe('fallback');
    });

    it('should allow forcing normal mode', async () => {
      const { create_usage_monitor } = await import('../../src/daemon/usage_monitor.js');
      const monitor = create_usage_monitor();

      // Given: currently in fallback
      monitor.force_mode('fallback');

      // When: forcing back to normal
      monitor.force_mode('normal');

      // Then: mode changes
      expect(monitor.get_mode()).toBe('normal');
    });

    it('should trigger mode change callback', async () => {
      const { create_usage_monitor } = await import('../../src/daemon/usage_monitor.js');
      const monitor = create_usage_monitor();
      const callback = vi.fn();

      // Given: listener registered
      monitor.on_mode_change(callback);

      // When: forcing mode change
      monitor.force_mode('fallback');

      // Then: callback is called with old and new mode
      expect(callback).toHaveBeenCalledWith('normal', 'fallback');
    });

    it('should not trigger callback when mode is the same', async () => {
      const { create_usage_monitor } = await import('../../src/daemon/usage_monitor.js');
      const monitor = create_usage_monitor();
      const callback = vi.fn();

      // Given: listener registered
      monitor.on_mode_change(callback);

      // When: forcing same mode
      monitor.force_mode('normal');

      // Then: callback is not called
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('get_status()', () => {
    it('should return current status info', async () => {
      const { create_usage_monitor } = await import('../../src/daemon/usage_monitor.js');
      const monitor = create_usage_monitor();

      // When: getting status
      const status = monitor.get_status();

      // Then: returns structured status
      expect(status).toBeDefined();
      expect(status.mode).toBe('normal');
      expect(typeof status.claude_available).toBe('boolean');
      expect(typeof status.gemini_available).toBe('boolean');
      expect(typeof status.last_check).toBe('string');
    });
  });

  describe('Claude Code availability detection', () => {
    it('should detect Claude Code unavailability from rate limit signals', async () => {
      const { create_usage_monitor } = await import('../../src/daemon/usage_monitor.js');
      const monitor = create_usage_monitor({ failure_threshold: 3 });

      // When: reporting enough failures to reach threshold
      monitor.report_claude_failure('rate_limit');
      monitor.report_claude_failure('rate_limit');
      monitor.report_claude_failure('rate_limit');

      // Then: status reflects unavailability
      const status = monitor.get_status();
      expect(status.claude_available).toBe(false);
    });

    it('should auto-switch to fallback after consecutive failures', async () => {
      const { create_usage_monitor } = await import('../../src/daemon/usage_monitor.js');
      const monitor = create_usage_monitor({
        failure_threshold: 3,
      });
      const callback = vi.fn();
      monitor.on_mode_change(callback);

      // When: reporting consecutive failures
      monitor.report_claude_failure('rate_limit');
      monitor.report_claude_failure('rate_limit');
      monitor.report_claude_failure('rate_limit');

      // Then: automatically switches to fallback
      expect(monitor.get_mode()).toBe('fallback');
      expect(callback).toHaveBeenCalledWith('normal', 'fallback');
    });

    it('should reset failure count on success', async () => {
      const { create_usage_monitor } = await import('../../src/daemon/usage_monitor.js');
      const monitor = create_usage_monitor({
        failure_threshold: 3,
      });

      // Given: 2 failures (below threshold)
      monitor.report_claude_failure('rate_limit');
      monitor.report_claude_failure('rate_limit');

      // When: success reported
      monitor.report_claude_success();

      // Then: still in normal mode
      expect(monitor.get_mode()).toBe('normal');

      // And: counter is reset, so 2 more failures won't trigger switch
      monitor.report_claude_failure('rate_limit');
      monitor.report_claude_failure('rate_limit');
      expect(monitor.get_mode()).toBe('normal');
    });

    it('should auto-recover to normal when Claude becomes available', async () => {
      const { create_usage_monitor } = await import('../../src/daemon/usage_monitor.js');
      const monitor = create_usage_monitor({
        failure_threshold: 3,
      });
      const callback = vi.fn();
      monitor.on_mode_change(callback);

      // Given: in fallback mode
      monitor.report_claude_failure('rate_limit');
      monitor.report_claude_failure('rate_limit');
      monitor.report_claude_failure('rate_limit');
      expect(monitor.get_mode()).toBe('fallback');

      // When: Claude reports success
      monitor.report_claude_success();

      // Then: auto-recovers to normal
      expect(monitor.get_mode()).toBe('normal');
      expect(callback).toHaveBeenCalledWith('fallback', 'normal');
    });
  });

  describe('warning mode', () => {
    it('should enter warning mode at warning threshold', async () => {
      const { create_usage_monitor } = await import('../../src/daemon/usage_monitor.js');
      const monitor = create_usage_monitor({
        failure_threshold: 6,
        warning_threshold: 3,
      });
      const callback = vi.fn();
      monitor.on_mode_change(callback);

      // When: reaching warning threshold
      monitor.report_claude_failure('rate_limit');
      monitor.report_claude_failure('rate_limit');
      monitor.report_claude_failure('rate_limit');

      // Then: enters warning mode (not fallback yet)
      expect(monitor.get_mode()).toBe('warning');
      expect(callback).toHaveBeenCalledWith('normal', 'warning');
    });
  });

  describe('start/stop', () => {
    it('should start and stop without errors', async () => {
      const { create_usage_monitor } = await import('../../src/daemon/usage_monitor.js');
      const monitor = create_usage_monitor();

      // When: starting and stopping
      monitor.start();
      monitor.stop();

      // Then: no errors thrown, mode is normal
      expect(monitor.get_mode()).toBe('normal');
    });
  });
});
