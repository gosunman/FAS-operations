// TDD tests for Gemini CLI wrapper module
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spawn_gemini, parse_gemini_response, check_session_status, get_gemini_command, get_session_name } from './cli_wrapper.js';
import type { GeminiConfig } from './types.js';

// Mock child_process
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
      // Default: simulate successful execution
      setTimeout(() => {
        proc.stdout.push('Hello from Gemini');
        proc.stdout.push(null);
        proc.emit('close', 0);
      }, 10);
      return proc;
    }),
    execSync: vi.fn(() => ''),
  };
});

const TEST_CONFIG: GeminiConfig = {
  account: 'a',
  timeout_ms: 5000,
};

describe('Gemini CLI Wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // === parse_gemini_response() tests ===

  describe('parse_gemini_response()', () => {
    it('should clean ANSI escape codes from output', () => {
      // Given: output with ANSI codes
      const raw = '\x1B[32mHello World\x1B[0m';

      // When: parsed
      const result = parse_gemini_response(raw);

      // Then: ANSI codes are removed
      expect(result).toBe('Hello World');
    });

    it('should extract and format JSON from mixed output', () => {
      // Given: output containing JSON
      const raw = 'Some text before\n{"decision": "approved", "reason": "looks safe"}\nSome text after';

      // When: parsed
      const result = parse_gemini_response(raw);

      // Then: JSON is extracted and formatted
      const parsed = JSON.parse(result);
      expect(parsed.decision).toBe('approved');
      expect(parsed.reason).toBe('looks safe');
    });

    it('should return cleaned text when no JSON present', () => {
      // Given: plain text output
      const raw = 'This is a plain text response from Gemini';

      // When: parsed
      const result = parse_gemini_response(raw);

      // Then: returns cleaned text
      expect(result).toBe('This is a plain text response from Gemini');
    });

    it('should handle empty output', () => {
      // Given: empty string
      const raw = '';

      // When: parsed
      const result = parse_gemini_response(raw);

      // Then: returns empty string
      expect(result).toBe('');
    });

    it('should handle malformed JSON gracefully', () => {
      // Given: output with broken JSON
      const raw = 'Response: {not valid json}';

      // When: parsed
      const result = parse_gemini_response(raw);

      // Then: returns the full cleaned text (not the broken JSON)
      expect(result).toContain('Response:');
    });
  });

  // === spawn_gemini() tests ===

  describe('spawn_gemini()', () => {
    it('should resolve with success on exit code 0', async () => {
      // Given: default mock (exits with 0)
      // When: spawn_gemini is called
      const result = await spawn_gemini(TEST_CONFIG, 'test prompt');

      // Then: success response
      expect(result.success).toBe(true);
      expect(result.content).toBeTruthy();
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it('should resolve with failure on non-zero exit code', async () => {
      // Given: process exits with error
      const { spawn } = await import('node:child_process');
      const { EventEmitter } = await import('node:events');
      const { Readable } = await import('node:stream');

      vi.mocked(spawn).mockImplementationOnce(() => {
        const proc = new EventEmitter() as ReturnType<typeof spawn>;
        (proc as Record<string, unknown>).stdout = new Readable({ read() {} });
        (proc as Record<string, unknown>).stderr = new Readable({ read() {} });
        setTimeout(() => {
          (proc as Record<string, unknown> & { stderr: Readable }).stderr.push('Error occurred');
          (proc as Record<string, unknown> & { stderr: Readable }).stderr.push(null);
          proc.emit('close', 1);
        }, 10);
        return proc;
      });

      // When: spawn_gemini is called
      const result = await spawn_gemini(TEST_CONFIG, 'test prompt');

      // Then: failure response
      expect(result.success).toBe(false);
      expect(result.error).toContain('exited with code 1');
    });

    it('should resolve with failure when spawn itself fails', async () => {
      // Given: spawn throws an error
      const { spawn } = await import('node:child_process');
      const { EventEmitter } = await import('node:events');
      const { Readable } = await import('node:stream');

      vi.mocked(spawn).mockImplementationOnce(() => {
        const proc = new EventEmitter() as ReturnType<typeof spawn>;
        (proc as Record<string, unknown>).stdout = new Readable({ read() {} });
        (proc as Record<string, unknown>).stderr = new Readable({ read() {} });
        setTimeout(() => {
          proc.emit('error', new Error('Command not found'));
        }, 10);
        return proc;
      });

      // When: spawn_gemini is called
      const result = await spawn_gemini(TEST_CONFIG, 'test prompt');

      // Then: failure response
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to spawn');
    });

    it('should pass model flag when specified', async () => {
      // Given: config with model
      const config: GeminiConfig = { account: 'a', model: 'gemini-2.0-flash' };
      const { spawn } = await import('node:child_process');

      // When: spawn_gemini is called
      await spawn_gemini(config, 'test prompt');

      // Then: args include --model flag
      const call_args = vi.mocked(spawn).mock.calls[0];
      const args = call_args[1] as string[];
      expect(args).toContain('--model');
      expect(args).toContain('gemini-2.0-flash');
    });
  });

  // === get_gemini_command() tests ===

  describe('get_gemini_command()', () => {
    it('should return default command for account A', () => {
      // When: get command for account A
      const cmd = get_gemini_command('a');

      // Then: returns bare gemini command
      expect(cmd).toBe('gemini');
    });

    it('should use custom base command', () => {
      // When: custom command provided
      const cmd = get_gemini_command('a', '/usr/local/bin/gemini');

      // Then: uses custom command
      expect(cmd).toBe('/usr/local/bin/gemini');
    });
  });

  // === get_session_name() tests ===

  describe('get_session_name()', () => {
    it('should return fas-gemini-a for account A', () => {
      expect(get_session_name('a')).toBe('fas-gemini-a');
    });

  });

  // === check_session_status() tests ===

  describe('check_session_status()', () => {
    it('should return stopped when tmux session does not exist', async () => {
      // Given: execSync throws (no tmux session)
      const cp = await import('node:child_process');
      vi.spyOn(cp, 'execSync').mockImplementation(() => {
        throw new Error('no server running');
      });

      // When: check status
      const status = check_session_status('a');

      // Then: stopped
      expect(status).toBe('stopped');

      vi.restoreAllMocks();
    });

    it('should return running when session has active pane', async () => {
      // Given: tmux session exists with active pane
      const cp = await import('node:child_process');
      vi.spyOn(cp, 'execSync')
        .mockReturnValueOnce('' as never)           // has-session succeeds
        .mockReturnValueOnce('12345\n' as never);   // list-panes returns PID

      // When: check status
      const status = check_session_status('a');

      // Then: running
      expect(status).toBe('running');

      vi.restoreAllMocks();
    });
  });
});
