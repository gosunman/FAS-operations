// Tests for safe_fire_forget utility

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { safe_fire_forget, reset_rate_limits } from './safe_fire_forget.js';
import type { NotificationRouter } from '../notification/router.js';

const make_mock_router = (): NotificationRouter => ({
  route: vi.fn().mockResolvedValue(undefined),
  get_queue_sizes: vi.fn().mockReturnValue({ telegram: 0, slack: 0, notion: 0 }),
  stop: vi.fn(),
});

describe('safe_fire_forget', () => {
  beforeEach(() => {
    reset_rate_limits();
    vi.restoreAllMocks();
  });

  it('does not throw when promise resolves', () => {
    expect(() => {
      safe_fire_forget(Promise.resolve('ok'), 'test');
    }).not.toThrow();
  });

  it('does not throw when promise rejects', () => {
    expect(() => {
      safe_fire_forget(Promise.reject(new Error('fail')), 'test');
    }).not.toThrow();
  });

  it('sends Slack alert via router on failure', async () => {
    const router = make_mock_router();
    const failing = Promise.reject(new Error('db timeout'));

    safe_fire_forget(failing, 'Notion backup', { router });

    // Wait for microtask queue to flush
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(router.route).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'alert',
        severity: 'medium',
        message: expect.stringContaining('Notion backup'),
      }),
    );
  });

  it('includes error message in alert', async () => {
    const router = make_mock_router();
    safe_fire_forget(Promise.reject(new Error('connection refused')), 'API call', { router });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(router.route).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('connection refused'),
      }),
    );
  });

  it('rate-limits alerts per context', async () => {
    const router = make_mock_router();

    // Fire 10 failures for the same context
    for (let i = 0; i < 10; i++) {
      safe_fire_forget(Promise.reject(new Error(`fail ${i}`)), 'same-context', {
        router,
        max_alerts_per_hour: 3,
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 20));

    // Should only send 3 alerts (rate-limited)
    expect((router.route as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('works without router (console.warn only)', async () => {
    const warn_spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    safe_fire_forget(Promise.reject(new Error('no router')), 'offline');

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(warn_spy).toHaveBeenCalledWith(
      expect.stringContaining('offline'),
    );
  });

  it('handles non-Error rejections', async () => {
    const router = make_mock_router();
    safe_fire_forget(Promise.reject('string error'), 'string-reject', { router });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(router.route).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('string error'),
      }),
    );
  });
});
