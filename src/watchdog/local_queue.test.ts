// TDD tests for local queue (network disconnect resilience)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { create_local_queue, type LocalQueue } from './local_queue.js';

describe('Local Queue', () => {
  let queue: LocalQueue;
  let on_flush_mock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    on_flush_mock = vi.fn().mockResolvedValue(true);
    queue = create_local_queue({
      db_path: ':memory:',
      on_flush: on_flush_mock,
    });
  });

  afterEach(() => {
    queue.close();
  });

  // === enqueue & pending_count ===

  describe('enqueue()', () => {
    it('should add items and increment pending_count', () => {
      expect(queue.pending_count()).toBe(0);

      const id1 = queue.enqueue('/api/notify', 'POST', { msg: 'hello' });
      expect(id1).toBeDefined();
      expect(typeof id1).toBe('string');
      expect(queue.pending_count()).toBe(1);

      const id2 = queue.enqueue('/api/log', 'PUT', { level: 'info' });
      expect(id2).not.toBe(id1);
      expect(queue.pending_count()).toBe(2);
    });

    it('should store endpoint, method, and body correctly', () => {
      queue.enqueue('/api/test', 'POST', { key: 'value' });

      // Verify via raw DB query
      const row = queue._db.prepare('SELECT * FROM queue').get() as Record<string, unknown>;
      expect(row.endpoint).toBe('/api/test');
      expect(row.method).toBe('POST');
      expect(JSON.parse(row.body as string)).toEqual({ key: 'value' });
      expect(row.retry_count).toBe(0);
    });
  });

  // === flush — successful delivery ===

  describe('flush() with successful on_flush', () => {
    it('should remove all items when on_flush returns true', async () => {
      queue.enqueue('/api/a', 'POST', {});
      queue.enqueue('/api/b', 'POST', {});
      expect(queue.pending_count()).toBe(2);

      const result = await queue.flush();

      expect(result.sent).toBe(2);
      expect(result.failed).toBe(0);
      expect(queue.pending_count()).toBe(0);
      expect(on_flush_mock).toHaveBeenCalledTimes(2);
    });

    it('should pass correct QueuedRequest to on_flush', async () => {
      queue.enqueue('/api/notify', 'POST', { text: 'hi' });

      await queue.flush();

      const call_arg = on_flush_mock.mock.calls[0][0];
      expect(call_arg.endpoint).toBe('/api/notify');
      expect(call_arg.method).toBe('POST');
      expect(call_arg.body).toEqual({ text: 'hi' });
      expect(call_arg.retry_count).toBe(0);
      expect(call_arg.id).toBeDefined();
      expect(call_arg.queued_at).toBeDefined();
    });
  });

  // === flush — failed delivery ===

  describe('flush() with failing on_flush', () => {
    it('should increment retry_count when on_flush returns false', async () => {
      on_flush_mock.mockResolvedValue(false);
      queue.enqueue('/api/fail', 'POST', {});

      const result = await queue.flush();

      expect(result.sent).toBe(0);
      expect(result.failed).toBe(1);
      expect(queue.pending_count()).toBe(1);

      // Verify retry_count was incremented
      const row = queue._db.prepare('SELECT retry_count FROM queue').get() as { retry_count: number };
      expect(row.retry_count).toBe(1);
    });

    it('should increment retry_count when on_flush throws', async () => {
      on_flush_mock.mockRejectedValue(new Error('network error'));
      queue.enqueue('/api/error', 'POST', {});

      const result = await queue.flush();

      expect(result.sent).toBe(0);
      expect(result.failed).toBe(1);
      expect(queue.pending_count()).toBe(1);

      const row = queue._db.prepare('SELECT retry_count FROM queue').get() as { retry_count: number };
      expect(row.retry_count).toBe(1);
    });
  });

  // === flush — max_retries exceeded ===

  describe('flush() drops items exceeding max_retries', () => {
    it('should drop item after reaching max_retries (default 5)', async () => {
      on_flush_mock.mockResolvedValue(false);
      queue.enqueue('/api/doomed', 'POST', {});

      // Flush 5 times to reach max_retries
      for (let i = 0; i < 5; i++) {
        await queue.flush();
      }

      // Item should be dropped after the 5th failure
      expect(queue.pending_count()).toBe(0);
    });

    it('should respect custom max_retries', async () => {
      queue.close(); // close default queue

      const custom_flush = vi.fn().mockResolvedValue(false);
      queue = create_local_queue({
        db_path: ':memory:',
        max_retries: 2,
        on_flush: custom_flush,
      });

      queue.enqueue('/api/limited', 'POST', {});

      // First flush: retry_count goes 0 -> 1, still under max_retries=2
      await queue.flush();
      expect(queue.pending_count()).toBe(1);

      // Second flush: retry_count goes 1 -> 2, now >= max_retries, dropped
      await queue.flush();
      expect(queue.pending_count()).toBe(0);
    });
  });

  // === flush — mixed success/failure ===

  describe('flush() with mixed success/failure', () => {
    it('should handle mix of successful and failed deliveries', async () => {
      // First call succeeds, second fails, third succeeds
      on_flush_mock
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      queue.enqueue('/api/ok-1', 'POST', {});
      queue.enqueue('/api/fail', 'POST', {});
      queue.enqueue('/api/ok-2', 'POST', {});

      const result = await queue.flush();

      expect(result.sent).toBe(2);
      expect(result.failed).toBe(1);
      expect(queue.pending_count()).toBe(1);

      // The remaining item should be the failed one
      const row = queue._db.prepare('SELECT endpoint FROM queue').get() as { endpoint: string };
      expect(row.endpoint).toBe('/api/fail');
    });
  });
});
