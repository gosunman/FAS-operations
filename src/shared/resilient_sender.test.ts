// TDD tests for resilient sender with local queue fallback
// Phase 7-3: network disconnection recovery

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { create_resilient_sender, is_network_error } from './resilient_sender.js';
import type { ResilientSender, SendFunction } from './resilient_sender.js';

// === Test helpers ===

let test_dir: string;

const make_test_dir = (): string => {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fas-resilient-test-'));
};

beforeEach(() => {
  test_dir = make_test_dir();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  try {
    fs.rmSync(test_dir, { recursive: true, force: true });
  } catch { /* ignore */ }
});

// === is_network_error tests ===

describe('is_network_error', () => {
  it('should detect ECONNREFUSED', () => {
    expect(is_network_error(new Error('connect ECONNREFUSED 127.0.0.1:443'))).toBe(true);
  });

  it('should detect ETIMEDOUT', () => {
    expect(is_network_error(new Error('request ETIMEDOUT'))).toBe(true);
  });

  it('should detect ENOTFOUND', () => {
    expect(is_network_error(new Error('getaddrinfo ENOTFOUND api.telegram.org'))).toBe(true);
  });

  it('should detect fetch failed', () => {
    expect(is_network_error(new Error('fetch failed'))).toBe(true);
  });

  it('should detect socket hang up', () => {
    expect(is_network_error(new Error('socket hang up'))).toBe(true);
  });

  it('should NOT detect application errors', () => {
    expect(is_network_error(new Error('Invalid token'))).toBe(false);
    expect(is_network_error(new Error('Rate limited'))).toBe(false);
    expect(is_network_error(new Error('Bad Request'))).toBe(false);
  });

  it('should handle non-Error values', () => {
    expect(is_network_error('string error')).toBe(false);
    expect(is_network_error(null)).toBe(false);
    expect(is_network_error(42)).toBe(false);
  });
});

// === create_resilient_sender tests ===

describe('create_resilient_sender', () => {
  describe('send - happy path', () => {
    it('should send directly when network is available', async () => {
      const send_fn = vi.fn().mockResolvedValue(true);
      const sender = create_resilient_sender(send_fn, {
        queue_dir: test_dir,
        channel_name: 'telegram',
      });

      const result = await sender.send({ message: 'hello' });
      expect(result).toBe(true);
      expect(send_fn).toHaveBeenCalledWith({ message: 'hello' });
      expect(sender.queue_size()).toBe(0);
    });
  });

  describe('send - network error fallback', () => {
    it('should enqueue when send throws network error', async () => {
      const send_fn = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));
      const sender = create_resilient_sender(send_fn, {
        queue_dir: test_dir,
        channel_name: 'telegram',
      });

      const result = await sender.send({ message: 'queued' });
      expect(result).toBe(false);
      expect(sender.queue_size()).toBe(1);
    });

    it('should enqueue when send returns false', async () => {
      const send_fn = vi.fn().mockResolvedValue(false);
      const sender = create_resilient_sender(send_fn, {
        queue_dir: test_dir,
        channel_name: 'slack',
      });

      const result = await sender.send({ text: 'failed' });
      expect(result).toBe(false);
      expect(sender.queue_size()).toBe(1);
    });

    it('should rethrow non-network errors', async () => {
      const send_fn = vi.fn().mockRejectedValue(new Error('Invalid token'));
      const sender = create_resilient_sender(send_fn, {
        queue_dir: test_dir,
        channel_name: 'telegram',
      });

      await expect(sender.send({ msg: 'bad' })).rejects.toThrow('Invalid token');
      expect(sender.queue_size()).toBe(0);
    });
  });

  describe('replay_now', () => {
    it('should replay all queued items on success', async () => {
      let call_count = 0;
      const send_fn: SendFunction = vi.fn().mockImplementation(async () => {
        call_count++;
        // First 2 calls fail (network), next calls succeed
        if (call_count <= 2) throw new Error('ECONNREFUSED');
        return true;
      });

      const sender = create_resilient_sender(send_fn, {
        queue_dir: test_dir,
        channel_name: 'telegram',
      });

      // Enqueue 2 items (both fail on send)
      await sender.send({ n: 1 });
      await sender.send({ n: 2 });
      expect(sender.queue_size()).toBe(2);

      // Replay — now send works
      const result = await sender.replay_now();
      expect(result.succeeded).toBe(2);
      expect(result.remaining).toBe(0);
      expect(sender.queue_size()).toBe(0);
    });

    it('should keep items that still fail during replay', async () => {
      const send_fn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      const sender = create_resilient_sender(send_fn, {
        queue_dir: test_dir,
        channel_name: 'telegram',
      });

      await sender.send({ n: 1 });
      expect(sender.queue_size()).toBe(1);

      // Replay also fails
      const result = await sender.replay_now();
      expect(result.failed).toBe(1);
      expect(sender.queue_size()).toBe(1);
    });

    it('should discard items that exceed max_retry_count', async () => {
      // Use a real send_fn that always fails with network error
      const send_fn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      const sender = create_resilient_sender(send_fn, {
        queue_dir: test_dir,
        channel_name: 'telegram',
        max_retry_count: 3,
      });

      // Enqueue one item
      await sender.send({ msg: 'doomed' });

      // Replay 3 times (retry_count goes 0→1→2→3)
      await sender.replay_now();
      await sender.replay_now();
      await sender.replay_now();

      // On 4th replay, item has retry_count=3 >= max_retry_count=3, gets discarded
      const result = await sender.replay_now();
      expect(result.succeeded).toBe(1); // "succeeded" because discarded = removed
      expect(sender.queue_size()).toBe(0);
    });
  });

  describe('retry loop', () => {
    it('should start and stop retry loop', () => {
      const send_fn = vi.fn().mockResolvedValue(true);
      const sender = create_resilient_sender(send_fn, {
        queue_dir: test_dir,
        channel_name: 'telegram',
        retry_interval_ms: 5000,
      });

      expect(sender.is_retrying()).toBe(false);
      sender.start_retry_loop();
      expect(sender.is_retrying()).toBe(true);
      sender.stop_retry_loop();
      expect(sender.is_retrying()).toBe(false);
    });

    it('should not start duplicate retry loops', () => {
      const send_fn = vi.fn().mockResolvedValue(true);
      const sender = create_resilient_sender(send_fn, {
        queue_dir: test_dir,
        channel_name: 'telegram',
      });

      sender.start_retry_loop();
      sender.start_retry_loop(); // second call should be no-op
      expect(sender.is_retrying()).toBe(true);
      sender.stop_retry_loop();
    });

    it('should call replay on interval when items are queued', async () => {
      let succeed = false;
      const send_fn = vi.fn().mockImplementation(async () => {
        if (!succeed) throw new Error('ECONNREFUSED');
        return true;
      });

      const on_replay_complete = vi.fn();
      const sender = create_resilient_sender(send_fn, {
        queue_dir: test_dir,
        channel_name: 'telegram',
        retry_interval_ms: 1000,
        on_replay_complete,
      });

      // Enqueue an item
      await sender.send({ msg: 'retry-me' });
      expect(sender.queue_size()).toBe(1);

      // Start retry loop
      sender.start_retry_loop();

      // Network recovers
      succeed = true;

      // Advance timer to trigger retry
      await vi.advanceTimersByTimeAsync(1000);

      expect(on_replay_complete).toHaveBeenCalled();
      expect(sender.queue_size()).toBe(0);

      sender.stop_retry_loop();
    });

    it('should not call replay when queue is empty', async () => {
      const send_fn = vi.fn().mockResolvedValue(true);
      const on_replay_complete = vi.fn();
      const sender = create_resilient_sender(send_fn, {
        queue_dir: test_dir,
        channel_name: 'telegram',
        retry_interval_ms: 1000,
        on_replay_complete,
      });

      sender.start_retry_loop();
      await vi.advanceTimersByTimeAsync(3000);

      // on_replay_complete should NOT be called since queue is empty
      expect(on_replay_complete).not.toHaveBeenCalled();

      sender.stop_retry_loop();
    });
  });

  describe('on_replay_complete callback', () => {
    it('should fire with result after manual replay', async () => {
      const send_fn = vi.fn().mockResolvedValue(true);
      const on_replay_complete = vi.fn();
      const sender = create_resilient_sender(send_fn, {
        queue_dir: test_dir,
        channel_name: 'test',
        on_replay_complete,
      });

      // Nothing to replay but callback should still fire
      const result = await sender.replay_now();
      expect(on_replay_complete).toHaveBeenCalledWith(result);
    });
  });
});
