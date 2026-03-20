// NotebookLM verification module tests
// Verifies: task creation, polling, timeout, result parsing

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  create_notebooklm_verifier,
  parse_verification_output,
  type NotebookLmVerifierDeps,
} from './notebooklm_verify.js';

// === parse_verification_output ===

describe('parse_verification_output', () => {
  it('should parse a valid verified result', () => {
    const raw = JSON.stringify({
      verified: true,
      confidence: 0.92,
      explanation: 'All claims match source material.',
    });
    const result = parse_verification_output(raw);
    expect(result.verified).toBe(true);
    expect(result.confidence).toBe(0.92);
    expect(result.explanation).toBe('All claims match source material.');
  });

  it('should parse a valid unverified result', () => {
    const raw = JSON.stringify({
      verified: false,
      confidence: 0.85,
      explanation: 'Key claim contradicts source.',
    });
    const result = parse_verification_output(raw);
    expect(result.verified).toBe(false);
    expect(result.confidence).toBe(0.85);
  });

  it('should extract JSON embedded in surrounding text', () => {
    const raw = `Here is the result:\n${JSON.stringify({
      verified: true,
      confidence: 0.8,
      explanation: 'Looks good.',
    })}\nDone.`;
    const result = parse_verification_output(raw);
    expect(result.verified).toBe(true);
    expect(result.confidence).toBe(0.8);
  });

  it('should handle missing fields with safe defaults', () => {
    const raw = JSON.stringify({ verified: true });
    const result = parse_verification_output(raw);
    expect(result.verified).toBe(true);
    expect(result.confidence).toBe(0);
    expect(result.explanation).toBe('');
  });

  it('should clamp confidence to [0, 1]', () => {
    const raw = JSON.stringify({ verified: true, confidence: 5.0, explanation: '' });
    const result = parse_verification_output(raw);
    expect(result.confidence).toBe(1);

    const raw2 = JSON.stringify({ verified: true, confidence: -2, explanation: '' });
    const result2 = parse_verification_output(raw2);
    expect(result2.confidence).toBe(0);
  });

  it('should return unverified for non-JSON input', () => {
    const result = parse_verification_output('This is not JSON at all.');
    expect(result.verified).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.explanation).toContain('no JSON found');
  });

  it('should return unverified for invalid JSON', () => {
    const result = parse_verification_output('{ broken json }');
    expect(result.verified).toBe(false);
    expect(result.explanation).toContain('invalid JSON');
  });
});

// === create_notebooklm_verifier ===

describe('create_notebooklm_verifier', () => {
  // Helper: create a mock fetch that responds to different URL patterns
  const create_mock_fetch = (responses: Array<{ url_match: string; response: unknown; status?: number }>) => {
    return vi.fn(async (url: string, _opts?: RequestInit) => {
      const match = responses.find((r) => (url as string).includes(r.url_match));
      if (!match) {
        return { ok: false, status: 404, json: async () => ({}) } as Response;
      }
      return {
        ok: (match.status ?? 200) >= 200 && (match.status ?? 200) < 300,
        status: match.status ?? 200,
        json: async () => match.response,
      } as Response;
    });
  };

  it('should create task and poll for completed result', async () => {
    const task_id = 'test-task-123';
    let poll_count = 0;

    const mock_fetch = vi.fn(async (url: string, opts?: RequestInit) => {
      // POST /api/tasks — create task
      if (opts?.method === 'POST' && (url as string).includes('/api/tasks')) {
        return {
          ok: true,
          status: 201,
          json: async () => ({ id: task_id, status: 'pending' }),
        } as Response;
      }

      // GET /api/tasks/:id — poll
      if ((url as string).includes(`/api/tasks/${task_id}`)) {
        poll_count++;
        if (poll_count < 2) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: task_id, status: 'in_progress' }),
          } as Response;
        }
        // On 2nd poll, return completed
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: task_id,
            status: 'done',
            output: {
              summary: JSON.stringify({
                verified: true,
                confidence: 0.9,
                explanation: 'Verified by NotebookLM.',
              }),
            },
          }),
        } as Response;
      }

      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });

    const verifier = create_notebooklm_verifier({
      task_api_url: 'http://localhost:3100',
      poll_interval_ms: 10, // fast for tests
      timeout_ms: 5_000,
      fetch_fn: mock_fetch as unknown as typeof fetch,
    });

    const result = await verifier.request_notebooklm_verification('The sky is blue.');
    expect(result.verified).toBe(true);
    expect(result.confidence).toBe(0.9);
    expect(result.explanation).toBe('Verified by NotebookLM.');
    expect(poll_count).toBeGreaterThanOrEqual(2);
  });

  it('should handle timeout gracefully', async () => {
    const task_id = 'timeout-task';

    const mock_fetch = vi.fn(async (url: string, opts?: RequestInit) => {
      if (opts?.method === 'POST') {
        return {
          ok: true,
          status: 201,
          json: async () => ({ id: task_id, status: 'pending' }),
        } as Response;
      }
      // Always return pending — never completes
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: task_id, status: 'pending' }),
      } as Response;
    });

    const verifier = create_notebooklm_verifier({
      task_api_url: 'http://localhost:3100',
      poll_interval_ms: 10,
      timeout_ms: 50, // very short timeout for test
      fetch_fn: mock_fetch as unknown as typeof fetch,
    });

    const result = await verifier.request_notebooklm_verification('Some content.');
    expect(result.verified).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.explanation).toContain('timed out');
  });

  it('should handle task creation failure gracefully', async () => {
    const mock_fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response));

    const verifier = create_notebooklm_verifier({
      task_api_url: 'http://localhost:3100',
      poll_interval_ms: 10,
      timeout_ms: 1_000,
      fetch_fn: mock_fetch as unknown as typeof fetch,
    });

    const result = await verifier.request_notebooklm_verification('Some content.');
    expect(result.verified).toBe(false);
    expect(result.explanation).toContain('failed to create');
  });

  it('should handle blocked/failed task status', async () => {
    const task_id = 'blocked-task';

    const mock_fetch = vi.fn(async (url: string, opts?: RequestInit) => {
      if (opts?.method === 'POST') {
        return {
          ok: true,
          status: 201,
          json: async () => ({ id: task_id, status: 'pending' }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: task_id, status: 'blocked' }),
      } as Response;
    });

    const verifier = create_notebooklm_verifier({
      task_api_url: 'http://localhost:3100',
      poll_interval_ms: 10,
      timeout_ms: 1_000,
      fetch_fn: mock_fetch as unknown as typeof fetch,
    });

    const result = await verifier.request_notebooklm_verification('Some content.');
    expect(result.verified).toBe(false);
    expect(result.explanation).toContain('blocked');
  });

  it('should handle network errors during polling gracefully', async () => {
    const task_id = 'network-err-task';
    let poll_count = 0;

    const mock_fetch = vi.fn(async (url: string, opts?: RequestInit) => {
      if (opts?.method === 'POST') {
        return {
          ok: true,
          status: 201,
          json: async () => ({ id: task_id, status: 'pending' }),
        } as Response;
      }

      poll_count++;
      // First poll throws network error
      if (poll_count === 1) {
        throw new Error('Network error');
      }
      // Second poll returns done
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: task_id,
          status: 'done',
          output: {
            summary: JSON.stringify({
              verified: true,
              confidence: 0.7,
              explanation: 'Recovered after network error.',
            }),
          },
        }),
      } as Response;
    });

    const verifier = create_notebooklm_verifier({
      task_api_url: 'http://localhost:3100',
      poll_interval_ms: 10,
      timeout_ms: 5_000,
      fetch_fn: mock_fetch as unknown as typeof fetch,
    });

    const result = await verifier.request_notebooklm_verification('Test content.');
    expect(result.verified).toBe(true);
    expect(result.explanation).toBe('Recovered after network error.');
  });

  it('should handle completed task with empty output', async () => {
    const task_id = 'empty-output-task';

    const mock_fetch = vi.fn(async (url: string, opts?: RequestInit) => {
      if (opts?.method === 'POST') {
        return {
          ok: true,
          status: 201,
          json: async () => ({ id: task_id, status: 'pending' }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: task_id,
          status: 'done',
          output: { summary: '' },
        }),
      } as Response;
    });

    const verifier = create_notebooklm_verifier({
      task_api_url: 'http://localhost:3100',
      poll_interval_ms: 10,
      timeout_ms: 1_000,
      fetch_fn: mock_fetch as unknown as typeof fetch,
    });

    const result = await verifier.request_notebooklm_verification('Content.');
    expect(result.verified).toBe(false);
    expect(result.explanation).toContain('no output');
  });
});
