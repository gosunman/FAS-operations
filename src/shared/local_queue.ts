// Local disk-backed queue for network disconnection recovery
// Persists items as individual JSON files in a queue directory
// Phase 7-3: resilience — queue locally when network is down, replay on reconnect

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

// === Types ===

export type QueueItem = {
  id: string;
  type: string;           // e.g. 'telegram', 'slack', 'notion', 'task_result'
  payload: unknown;       // the actual data to send/replay
  created_at: string;     // ISO 8601
  retry_count: number;    // how many times replay was attempted
};

export type LocalQueue = {
  enqueue: (type: string, payload: unknown) => QueueItem;
  dequeue: () => QueueItem | null;
  peek: (n?: number) => QueueItem[];
  replay_all: (handler: (item: QueueItem) => Promise<boolean>) => Promise<ReplayResult>;
  size: () => number;
  clear: () => number;
};

export type ReplayResult = {
  total: number;
  succeeded: number;
  failed: number;
  remaining: number;
};

// === Helpers ===

// Read a single queue item from disk, returns null if file is invalid/missing
const read_item = (file_path: string): QueueItem | null => {
  try {
    const raw = fs.readFileSync(file_path, 'utf-8');
    const parsed = JSON.parse(raw) as QueueItem;
    // Basic validation
    if (!parsed.id || !parsed.type || !parsed.created_at) return null;
    return parsed;
  } catch {
    return null;
  }
};

// List all queue item files sorted by creation time (oldest first)
const list_item_files = (queue_dir: string): string[] => {
  try {
    const files = fs.readdirSync(queue_dir)
      .filter(f => f.endsWith('.json'))
      .map(f => path.join(queue_dir, f));

    // Sort by filename which includes ISO timestamp prefix
    files.sort();
    return files;
  } catch {
    return [];
  }
};

// Monotonic sequence counter to guarantee FIFO ordering
// even when multiple items are enqueued in the same millisecond
let global_sequence = 0;

// Generate a filename that sorts chronologically
// Format: {ISO timestamp}_{sequence}_{uuid}.json
const make_filename = (item: QueueItem): string => {
  // Replace colons with dashes for filesystem compatibility
  const safe_ts = item.created_at.replace(/:/g, '-');
  const seq = String(global_sequence++).padStart(10, '0');
  return `${safe_ts}_${seq}_${item.id}.json`;
};

// === Factory ===

export const create_local_queue = (dir: string): LocalQueue => {
  // Ensure queue directory exists
  fs.mkdirSync(dir, { recursive: true });

  // Enqueue: persist a new item to disk as a JSON file
  const enqueue = (type: string, payload: unknown): QueueItem => {
    const item: QueueItem = {
      id: randomUUID(),
      type,
      payload,
      created_at: new Date().toISOString(),
      retry_count: 0,
    };

    const file_path = path.join(dir, make_filename(item));
    fs.writeFileSync(file_path, JSON.stringify(item, null, 2), 'utf-8');
    return item;
  };

  // Dequeue: read and remove the oldest item
  const dequeue = (): QueueItem | null => {
    const files = list_item_files(dir);
    if (files.length === 0) return null;

    const oldest_file = files[0]!;
    const item = read_item(oldest_file);

    // Remove the file regardless of parse success (corrupted files should be cleaned up)
    try {
      fs.unlinkSync(oldest_file);
    } catch {
      // Ignore: file may have been removed by another process
    }

    return item;
  };

  // Peek: view next N items without removing (default: all)
  const peek = (n?: number): QueueItem[] => {
    const files = list_item_files(dir);
    const limit = n ?? files.length;
    const items: QueueItem[] = [];

    for (let i = 0; i < Math.min(limit, files.length); i++) {
      const item = read_item(files[i]!);
      if (item) items.push(item);
    }

    return items;
  };

  // Replay all: attempt to send each queued item via handler
  // Successful items are removed; failed items stay with incremented retry_count
  const replay_all = async (
    handler: (item: QueueItem) => Promise<boolean>,
  ): Promise<ReplayResult> => {
    const files = list_item_files(dir);
    let succeeded = 0;
    let failed = 0;

    for (const file_path of files) {
      const item = read_item(file_path);
      if (!item) {
        // Corrupted file — remove it
        try { fs.unlinkSync(file_path); } catch { /* ignore */ }
        continue;
      }

      try {
        const success = await handler(item);
        if (success) {
          // Remove successfully replayed item
          try { fs.unlinkSync(file_path); } catch { /* ignore */ }
          succeeded++;
        } else {
          // Increment retry count and rewrite
          item.retry_count++;
          fs.writeFileSync(file_path, JSON.stringify(item, null, 2), 'utf-8');
          failed++;
        }
      } catch {
        // Handler threw — treat as failure
        item.retry_count++;
        fs.writeFileSync(file_path, JSON.stringify(item, null, 2), 'utf-8');
        failed++;
      }
    }

    return {
      total: succeeded + failed,
      succeeded,
      failed,
      remaining: list_item_files(dir).length,
    };
  };

  // Size: count pending items
  const size = (): number => {
    return list_item_files(dir).length;
  };

  // Clear: remove all items, returns count removed
  const clear = (): number => {
    const files = list_item_files(dir);
    let removed = 0;
    for (const f of files) {
      try {
        fs.unlinkSync(f);
        removed++;
      } catch { /* ignore */ }
    }
    return removed;
  };

  return { enqueue, dequeue, peek, replay_all, size, clear };
};
