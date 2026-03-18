// TDD tests for feedback extractor
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { create_feedback_extractor } from './feedback_extractor.js';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock node:child_process
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';

// Helper to create a mock process
const mock_spawn = (stdout: string, code: number = 0) => {
  const proc = {
    stdout: {
      on: vi.fn((event: string, cb: (chunk: Buffer) => void) => {
        if (event === 'data') cb(Buffer.from(stdout));
      }),
    },
    stderr: { on: vi.fn() },
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'close') {
        setTimeout(() => cb(code), 0);
      }
    }),
  };
  (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(proc);
  return proc;
};

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
};

describe('FeedbackExtractor', () => {
  let tmp_dir: string;
  let feedback_path: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmp_dir = join(tmpdir(), `fas-feedback-test-${Date.now()}`);
    mkdirSync(tmp_dir, { recursive: true });
    feedback_path = join(tmp_dir, 'feedback_dev_lessons.md');
    writeFileSync(feedback_path, '# Dev Lessons\n');
  });

  afterEach(() => {
    rmSync(tmp_dir, { recursive: true, force: true });
  });

  it('should append lesson to feedback file on success', async () => {
    mock_spawn('자동화 작업 시 에러 핸들링을 반드시 먼저 구현해야 한다.');

    const extractor = create_feedback_extractor({
      feedback_path,
      gemini_command: 'gemini',
    });

    await extractor.extract('K-Startup 크롤링', 'Found 5 programs');

    const content = readFileSync(feedback_path, 'utf-8');
    expect(content).toContain('K-Startup 크롤링');
    expect(content).toContain('자동화 작업 시 에러 핸들링');
  });

  it('should not crash on Gemini CLI failure', async () => {
    mock_spawn('', 1);

    const extractor = create_feedback_extractor({
      feedback_path,
      gemini_command: 'gemini',
    });

    // Should not throw
    await extractor.extract('Failing task', 'Some output');

    // File should remain unchanged (only header)
    const content = readFileSync(feedback_path, 'utf-8');
    expect(content).toBe('# Dev Lessons\n');
  });

  it('should not crash on spawn error', async () => {
    mock_spawn_error(new Error('ENOENT'));

    const extractor = create_feedback_extractor({
      feedback_path,
      gemini_command: 'nonexistent',
    });

    await extractor.extract('Test', 'Output');

    const content = readFileSync(feedback_path, 'utf-8');
    expect(content).toBe('# Dev Lessons\n');
  });

  it('should skip excessively long responses', async () => {
    mock_spawn('x'.repeat(600));

    const extractor = create_feedback_extractor({
      feedback_path,
      gemini_command: 'gemini',
    });

    await extractor.extract('Test', 'Output');

    // Should not append (too long)
    const content = readFileSync(feedback_path, 'utf-8');
    expect(content).toBe('# Dev Lessons\n');
  });

  it('should include date in feedback entry', async () => {
    mock_spawn('배운 점이 있다.');

    const extractor = create_feedback_extractor({
      feedback_path,
      gemini_command: 'gemini',
    });

    await extractor.extract('Task', 'Done');

    const content = readFileSync(feedback_path, 'utf-8');
    // Should contain an ISO date like [2026-03-18]
    expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}\]/);
  });
});
