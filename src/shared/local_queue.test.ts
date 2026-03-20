// TDD tests for local disk-backed queue
// Phase 7-3: network disconnection recovery

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { create_local_queue } from './local_queue.js';
import type { LocalQueue, QueueItem } from './local_queue.js';

// === Test helpers ===

let test_dir: string;
let queue: LocalQueue;

const make_test_dir = (): string => {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fas-queue-test-'));
};

beforeEach(() => {
  test_dir = make_test_dir();
  queue = create_local_queue(test_dir);
});

afterEach(() => {
  // Cleanup test directory
  try {
    fs.rmSync(test_dir, { recursive: true, force: true });
  } catch { /* ignore */ }
});

// === Tests ===

describe('create_local_queue', () => {
  it('should create the queue directory if it does not exist', () => {
    const new_dir = path.join(test_dir, 'nested', 'queue');
    create_local_queue(new_dir);
    expect(fs.existsSync(new_dir)).toBe(true);
  });

  it('should not throw if directory already exists', () => {
    expect(() => create_local_queue(test_dir)).not.toThrow();
  });
});

describe('enqueue', () => {
  it('should create a JSON file in the queue directory', () => {
    queue.enqueue('telegram', { message: 'hello' });
    const files = fs.readdirSync(test_dir).filter(f => f.endsWith('.json'));
    expect(files).toHaveLength(1);
  });

  it('should return a QueueItem with all required fields', () => {
    const item = queue.enqueue('slack', { text: 'test' });
    expect(item.id).toBeDefined();
    expect(item.type).toBe('slack');
    expect(item.payload).toEqual({ text: 'test' });
    expect(item.created_at).toBeDefined();
    expect(item.retry_count).toBe(0);
  });

  it('should persist the item data to disk', () => {
    const item = queue.enqueue('telegram', { msg: 'persisted' });
    const files = fs.readdirSync(test_dir).filter(f => f.endsWith('.json'));
    const raw = fs.readFileSync(path.join(test_dir, files[0]!), 'utf-8');
    const parsed = JSON.parse(raw) as QueueItem;
    expect(parsed.id).toBe(item.id);
    expect(parsed.payload).toEqual({ msg: 'persisted' });
  });

  it('should create unique files for multiple enqueues', () => {
    queue.enqueue('telegram', { n: 1 });
    queue.enqueue('telegram', { n: 2 });
    queue.enqueue('slack', { n: 3 });
    expect(queue.size()).toBe(3);
  });
});

describe('dequeue', () => {
  it('should return null when queue is empty', () => {
    expect(queue.dequeue()).toBeNull();
  });

  it('should return the oldest item', () => {
    const first = queue.enqueue('telegram', { order: 1 });
    queue.enqueue('telegram', { order: 2 });
    const dequeued = queue.dequeue();
    expect(dequeued?.id).toBe(first.id);
    expect(dequeued?.payload).toEqual({ order: 1 });
  });

  it('should remove the item from disk after dequeue', () => {
    queue.enqueue('telegram', { msg: 'to-remove' });
    expect(queue.size()).toBe(1);
    queue.dequeue();
    expect(queue.size()).toBe(0);
  });

  it('should dequeue items in FIFO order', () => {
    queue.enqueue('a', { n: 1 });
    queue.enqueue('b', { n: 2 });
    queue.enqueue('c', { n: 3 });

    expect(queue.dequeue()?.type).toBe('a');
    expect(queue.dequeue()?.type).toBe('b');
    expect(queue.dequeue()?.type).toBe('c');
    expect(queue.dequeue()).toBeNull();
  });
});

describe('peek', () => {
  it('should return empty array when queue is empty', () => {
    expect(queue.peek()).toEqual([]);
  });

  it('should return items without removing them', () => {
    queue.enqueue('telegram', { n: 1 });
    queue.enqueue('slack', { n: 2 });

    const peeked = queue.peek();
    expect(peeked).toHaveLength(2);
    expect(queue.size()).toBe(2); // items still in queue
  });

  it('should respect the n parameter', () => {
    queue.enqueue('a', { n: 1 });
    queue.enqueue('b', { n: 2 });
    queue.enqueue('c', { n: 3 });

    const peeked = queue.peek(2);
    expect(peeked).toHaveLength(2);
    expect(peeked[0]!.type).toBe('a');
    expect(peeked[1]!.type).toBe('b');
  });

  it('should return all items when n exceeds queue size', () => {
    queue.enqueue('a', {});
    expect(queue.peek(100)).toHaveLength(1);
  });
});

describe('size', () => {
  it('should return 0 for empty queue', () => {
    expect(queue.size()).toBe(0);
  });

  it('should reflect enqueue and dequeue operations', () => {
    queue.enqueue('a', {});
    queue.enqueue('b', {});
    expect(queue.size()).toBe(2);

    queue.dequeue();
    expect(queue.size()).toBe(1);
  });
});

describe('clear', () => {
  it('should remove all items and return count', () => {
    queue.enqueue('a', {});
    queue.enqueue('b', {});
    queue.enqueue('c', {});

    const removed = queue.clear();
    expect(removed).toBe(3);
    expect(queue.size()).toBe(0);
  });

  it('should return 0 for empty queue', () => {
    expect(queue.clear()).toBe(0);
  });
});

describe('replay_all', () => {
  it('should call handler for each item in order', async () => {
    queue.enqueue('a', { n: 1 });
    queue.enqueue('b', { n: 2 });

    const called: string[] = [];
    const result = await queue.replay_all(async (item) => {
      called.push(item.type);
      return true;
    });

    expect(called).toEqual(['a', 'b']);
    expect(result.total).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.remaining).toBe(0);
  });

  it('should remove successful items from disk', async () => {
    queue.enqueue('a', {});
    queue.enqueue('b', {});

    await queue.replay_all(async () => true);
    expect(queue.size()).toBe(0);
  });

  it('should keep failed items in queue with incremented retry_count', async () => {
    queue.enqueue('fail', { data: 'keep-me' });

    const result = await queue.replay_all(async () => false);
    expect(result.failed).toBe(1);
    expect(result.remaining).toBe(1);

    // Check retry_count was incremented
    const peeked = queue.peek(1);
    expect(peeked[0]!.retry_count).toBe(1);
  });

  it('should handle mixed success/failure', async () => {
    queue.enqueue('ok', { n: 1 });
    queue.enqueue('fail', { n: 2 });
    queue.enqueue('ok', { n: 3 });

    const result = await queue.replay_all(async (item) => {
      return item.type === 'ok';
    });

    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.remaining).toBe(1);
  });

  it('should handle handler that throws as failure', async () => {
    queue.enqueue('throw', {});

    const result = await queue.replay_all(async () => {
      throw new Error('boom');
    });

    expect(result.failed).toBe(1);
    expect(result.remaining).toBe(1);

    const peeked = queue.peek(1);
    expect(peeked[0]!.retry_count).toBe(1);
  });

  it('should increment retry_count across multiple replays', async () => {
    queue.enqueue('persistent-fail', {});

    await queue.replay_all(async () => false);
    await queue.replay_all(async () => false);
    await queue.replay_all(async () => false);

    const peeked = queue.peek(1);
    expect(peeked[0]!.retry_count).toBe(3);
  });

  it('should return correct result for empty queue', async () => {
    const result = await queue.replay_all(async () => true);
    expect(result.total).toBe(0);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.remaining).toBe(0);
  });
});

describe('corrupted files', () => {
  it('should skip corrupted JSON files during peek', () => {
    queue.enqueue('valid', { ok: true });
    // Write a corrupted file
    fs.writeFileSync(path.join(test_dir, '0000_corrupt.json'), 'not json', 'utf-8');

    // peek should skip the corrupted file but still return valid item
    const items = queue.peek();
    // The corrupted file sorts first (0000 prefix), so it gets skipped
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items.some(i => i.type === 'valid')).toBe(true);
  });

  it('should clean up corrupted files during replay', async () => {
    fs.writeFileSync(path.join(test_dir, '0000_corrupt.json'), '{invalid', 'utf-8');
    queue.enqueue('valid', {});

    await queue.replay_all(async () => true);
    // Both should be removed (corrupted cleaned, valid succeeded)
    expect(queue.size()).toBe(0);
  });
});
