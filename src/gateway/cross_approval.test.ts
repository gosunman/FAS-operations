// TDD tests for cross-approval module (Gemini CLI)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create_cross_approval } from './cross_approval.js';

// Mock node:child_process
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';

// Helper to create a mock process that emits stdout data and closes
const mock_spawn = (stdout: string, code: number = 0, stderr: string = '') => {
  const proc = {
    stdout: {
      on: vi.fn((event: string, cb: (chunk: Buffer) => void) => {
        if (event === 'data') cb(Buffer.from(stdout));
      }),
    },
    stderr: {
      on: vi.fn((event: string, cb: (chunk: Buffer) => void) => {
        if (event === 'data' && stderr) cb(Buffer.from(stderr));
      }),
    },
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'close') {
        // Use setTimeout to simulate async close
        setTimeout(() => cb(code), 0);
      }
    }),
  };
  (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(proc);
  return proc;
};

// Helper to create a mock process that emits an error
const mock_spawn_error = (error: Error) => {
  const proc = {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'error') {
        setTimeout(() => cb(error), 0);
      }
    }),
  };
  (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(proc);
  return proc;
};

describe('CrossApproval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('request_approval()', () => {
    it('should return approved when Gemini approves', async () => {
      mock_spawn('{"decision": "approved", "reason": "Safe git commit"}');

      const approval = create_cross_approval({ gemini_command: 'gemini' });
      const result = await approval.request_approval('git commit', 'Committing docs update');

      expect(result.decision).toBe('approved');
      expect(result.reason).toBe('Safe git commit');
      expect(result.reviewed_by).toBe('gemini_a');
      expect(result.reviewed_at).toBeDefined();
    });

    it('should return rejected when Gemini rejects', async () => {
      mock_spawn('{"decision": "rejected", "reason": "Contains sensitive data"}');

      const approval = create_cross_approval();
      const result = await approval.request_approval('git push', 'Pushing to main');

      expect(result.decision).toBe('rejected');
      expect(result.reason).toBe('Contains sensitive data');
    });

    it('should handle JSON embedded in surrounding text', async () => {
      mock_spawn('Here is my response:\n{"decision": "approved", "reason": "Looks good"}\nDone.');

      const approval = create_cross_approval();
      const result = await approval.request_approval('file write', 'Writing config');

      expect(result.decision).toBe('approved');
      expect(result.reason).toBe('Looks good');
    });

    it('should auto-reject on invalid JSON response', async () => {
      mock_spawn('I think this is fine, go ahead!');

      const approval = create_cross_approval();
      const result = await approval.request_approval('deploy', 'Deploy to staging');

      expect(result.decision).toBe('rejected');
      expect(result.reason).toContain('Auto-rejected');
      expect(result.reviewed_by).toBe('system');
    });

    it('should auto-reject on invalid decision value', async () => {
      mock_spawn('{"decision": "maybe", "reason": "Not sure"}');

      const approval = create_cross_approval();
      const result = await approval.request_approval('deploy', 'Deploy');

      expect(result.decision).toBe('rejected');
      expect(result.reason).toContain('Auto-rejected');
    });

    it('should auto-reject on CLI error', async () => {
      mock_spawn('', 1, 'Command not found');

      const approval = create_cross_approval();
      const result = await approval.request_approval('action', 'context');

      expect(result.decision).toBe('rejected');
      expect(result.reason).toContain('Auto-rejected');
    });

    it('should auto-reject on spawn error', async () => {
      mock_spawn_error(new Error('ENOENT: gemini not found'));

      const approval = create_cross_approval();
      const result = await approval.request_approval('action', 'context');

      expect(result.decision).toBe('rejected');
      expect(result.reason).toContain('Auto-rejected');
    });

    it('should throw on error when auto_reject_on_error is false', async () => {
      mock_spawn('not json');

      const approval = create_cross_approval({ auto_reject_on_error: false });

      await expect(
        approval.request_approval('action', 'context'),
      ).rejects.toThrow();
    });

    it('should pass timeout to spawn', async () => {
      mock_spawn('{"decision": "approved", "reason": "ok"}');

      const approval = create_cross_approval({ timeout_ms: 30_000 });
      await approval.request_approval('action', 'context');

      expect(spawn).toHaveBeenCalledWith(
        'gemini',
        expect.any(Array),
        expect.objectContaining({ timeout: 30_000 }),
      );
    });
  });
});
