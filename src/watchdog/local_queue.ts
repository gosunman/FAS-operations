// FAS Local Queue — Network disconnect resilience layer
// SQLite-backed queue that buffers outbound HTTP requests
// when the network is unavailable. On reconnect, flush()
// replays them in FIFO order via the provided on_flush callback.
//
// Usage:
//   const queue = create_local_queue({
//     db_path: './fas_queue.db',
//     on_flush: async (req) => { /* send HTTP request, return true on success */ },
//   });
//   queue.enqueue('/api/notify', 'POST', { message: 'hello' });
//   await queue.flush();

import Database from 'better-sqlite3';
import { v4 as uuid_v4 } from 'uuid';
import type { QueuedRequest } from '../shared/types.js';

// === Configuration ===

export type LocalQueueConfig = {
  db_path: string;
  max_retries?: number;
  on_flush: (request: QueuedRequest) => Promise<boolean>;
};

// === Public interface ===

export type LocalQueue = {
  /** Enqueue a request for later delivery. Returns generated id. */
  enqueue: (endpoint: string, method: string, body: unknown) => string;
  /** Flush all pending items. Calls on_flush for each, removes successes, increments retry_count for failures. */
  flush: () => Promise<{ sent: number; failed: number }>;
  /** Number of items currently waiting in the queue. */
  pending_count: () => number;
  /** Close the database connection. */
  close: () => void;
  /** Exposed for testing only. */
  _db: Database.Database;
};

// === SQL statements ===

const SQL_CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS queue (
    id          TEXT PRIMARY KEY,
    queued_at   TEXT NOT NULL,
    endpoint    TEXT NOT NULL,
    method      TEXT NOT NULL,
    body        TEXT NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0
  )
`;

const SQL_INSERT = `
  INSERT INTO queue (id, queued_at, endpoint, method, body, retry_count)
  VALUES (?, ?, ?, ?, ?, 0)
`;

const SQL_SELECT_ALL = `SELECT * FROM queue ORDER BY queued_at ASC`;

const SQL_DELETE_BY_ID = `DELETE FROM queue WHERE id = ?`;

const SQL_INCREMENT_RETRY = `UPDATE queue SET retry_count = retry_count + 1 WHERE id = ?`;

const SQL_COUNT = `SELECT COUNT(*) AS cnt FROM queue`;

// === Factory ===

export const create_local_queue = (config: LocalQueueConfig): LocalQueue => {
  const max_retries = config.max_retries ?? 5;

  // Open database with WAL mode for better concurrent read performance
  const db = new Database(config.db_path);
  db.pragma('journal_mode = WAL');
  db.exec(SQL_CREATE_TABLE);

  // Prepare statements for performance
  const stmt_insert = db.prepare(SQL_INSERT);
  const stmt_select_all = db.prepare(SQL_SELECT_ALL);
  const stmt_delete = db.prepare(SQL_DELETE_BY_ID);
  const stmt_increment = db.prepare(SQL_INCREMENT_RETRY);
  const stmt_count = db.prepare(SQL_COUNT);

  // --- enqueue ---
  const enqueue = (endpoint: string, method: string, body: unknown): string => {
    const id = uuid_v4();
    const queued_at = new Date().toISOString();
    const body_json = JSON.stringify(body);
    stmt_insert.run(id, queued_at, endpoint, method, body_json);
    return id;
  };

  // --- flush ---
  const flush = async (): Promise<{ sent: number; failed: number }> => {
    // Snapshot current queue items
    const rows = stmt_select_all.all() as Array<{
      id: string;
      queued_at: string;
      endpoint: string;
      method: string;
      body: string;
      retry_count: number;
    }>;

    let sent = 0;
    let failed = 0;

    for (const row of rows) {
      // Reconstruct the QueuedRequest for the callback
      const request: QueuedRequest = {
        id: row.id,
        queued_at: row.queued_at,
        endpoint: row.endpoint,
        method: row.method,
        body: JSON.parse(row.body),
        retry_count: row.retry_count,
      };

      try {
        const success = await config.on_flush(request);

        if (success) {
          // Remove successfully sent item from queue
          stmt_delete.run(row.id);
          sent += 1;
        } else {
          // Increment retry count; drop if exceeding max_retries
          stmt_increment.run(row.id);
          const new_retry_count = row.retry_count + 1;

          if (new_retry_count >= max_retries) {
            stmt_delete.run(row.id);
          }

          failed += 1;
        }
      } catch {
        // Treat thrown errors as failure
        stmt_increment.run(row.id);
        const new_retry_count = row.retry_count + 1;

        if (new_retry_count >= max_retries) {
          stmt_delete.run(row.id);
        }

        failed += 1;
      }
    }

    return { sent, failed };
  };

  // --- pending_count ---
  const pending_count = (): number => {
    const result = stmt_count.get() as { cnt: number };
    return result.cnt;
  };

  // --- close ---
  const close = (): void => {
    db.close();
  };

  return {
    enqueue,
    flush,
    pending_count,
    close,
    _db: db,
  };
};
