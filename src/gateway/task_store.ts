// SQLite-based task store for FAS
// Manages task lifecycle: create -> pending -> in_progress -> done/blocked

import Database from 'better-sqlite3';
import { v4 as uuid_v4 } from 'uuid';
import type { Task, TaskStatus, RiskLevel } from '../shared/types.js';

// === Task store using SQLite ===

export type TaskStoreConfig = {
  db_path: string; // ':memory:' for testing
};

export const create_task_store = (config: TaskStoreConfig) => {
  const db = new Database(config.db_path);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // === Initialize schema ===
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT NOT NULL DEFAULT 'medium',
      assigned_to TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'awake',
      risk_level TEXT NOT NULL DEFAULT 'low',
      requires_personal_info INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      deadline TEXT,
      depends_on TEXT NOT NULL DEFAULT '[]',
      output_summary TEXT,
      output_files TEXT,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to);
  `);

  // === Prepared statements ===
  const stmts = {
    insert: db.prepare(`
      INSERT INTO tasks (id, title, description, priority, assigned_to, mode, risk_level, requires_personal_info, status, created_at, deadline, depends_on)
      VALUES (@id, @title, @description, @priority, @assigned_to, @mode, @risk_level, @requires_personal_info, @status, @created_at, @deadline, @depends_on)
    `),
    get_by_id: db.prepare('SELECT * FROM tasks WHERE id = ?'),
    get_by_status: db.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY created_at ASC'),
    get_by_assigned: db.prepare('SELECT * FROM tasks WHERE assigned_to = ? AND status = ? ORDER BY created_at ASC'),
    update_status: db.prepare('UPDATE tasks SET status = ? WHERE id = ?'),
    update_result: db.prepare(`
      UPDATE tasks SET status = ?, output_summary = ?, output_files = ?, completed_at = ? WHERE id = ?
    `),
    count_by_status: db.prepare('SELECT status, COUNT(*) as count FROM tasks GROUP BY status'),
    all_tasks: db.prepare('SELECT * FROM tasks ORDER BY created_at DESC'),
  };

  // === Row to Task converter ===
  const row_to_task = (row: Record<string, unknown>): Task => ({
    id: row.id as string,
    title: row.title as string,
    description: row.description as string | undefined,
    priority: row.priority as Task['priority'],
    assigned_to: row.assigned_to as string,
    mode: row.mode as Task['mode'],
    risk_level: row.risk_level as RiskLevel,
    requires_personal_info: Boolean(row.requires_personal_info),
    status: row.status as TaskStatus,
    created_at: row.created_at as string,
    deadline: row.deadline as string | null,
    depends_on: JSON.parse(row.depends_on as string) as string[],
    output: row.output_summary ? {
      summary: row.output_summary as string,
      files_created: JSON.parse((row.output_files as string) || '[]') as string[],
    } : undefined,
    completed_at: row.completed_at as string | undefined,
  });

  // === CRUD operations ===

  const create = (params: {
    title: string;
    description?: string;
    priority?: Task['priority'];
    assigned_to: string;
    mode?: Task['mode'];
    risk_level?: RiskLevel;
    requires_personal_info?: boolean;
    deadline?: string | null;
    depends_on?: string[];
  }): Task => {
    const id = uuid_v4();
    const now = new Date().toISOString();

    stmts.insert.run({
      id,
      title: params.title,
      description: params.description ?? null,
      priority: params.priority ?? 'medium',
      assigned_to: params.assigned_to,
      mode: params.mode ?? 'awake',
      risk_level: params.risk_level ?? 'low',
      requires_personal_info: params.requires_personal_info ? 1 : 0,
      status: 'pending',
      created_at: now,
      deadline: params.deadline ?? null,
      depends_on: JSON.stringify(params.depends_on ?? []),
    });

    return get_by_id(id)!;
  };

  const get_by_id = (id: string): Task | null => {
    const row = stmts.get_by_id.get(id) as Record<string, unknown> | undefined;
    return row ? row_to_task(row) : null;
  };

  const get_by_status = (status: TaskStatus): Task[] => {
    const rows = stmts.get_by_status.all(status) as Record<string, unknown>[];
    return rows.map(row_to_task);
  };

  const get_pending_for_agent = (agent_id: string): Task[] => {
    const rows = stmts.get_by_assigned.all(agent_id, 'pending') as Record<string, unknown>[];
    return rows.map(row_to_task);
  };

  const update_status = (id: string, status: TaskStatus): boolean => {
    const result = stmts.update_status.run(status, id);
    return result.changes > 0;
  };

  const complete_task = (id: string, output: { summary: string; files_created?: string[] }): boolean => {
    const result = stmts.update_result.run(
      'done',
      output.summary,
      JSON.stringify(output.files_created ?? []),
      new Date().toISOString(),
      id,
    );
    return result.changes > 0;
  };

  const block_task = (id: string, reason: string): boolean => {
    const result = stmts.update_result.run(
      'blocked',
      reason,
      '[]',
      new Date().toISOString(),
      id,
    );
    return result.changes > 0;
  };

  // Quarantine a task — PII detected in hunter output, needs human review
  const quarantine_task = (id: string, sanitized_preview: string, pii_types: string[]): boolean => {
    const summary = `[QUARANTINED] PII detected: ${pii_types.join(', ')}\n---\n${sanitized_preview}`;
    const result = stmts.update_result.run(
      'quarantined',
      summary,
      '[]',
      new Date().toISOString(),
      id,
    );
    return result.changes > 0;
  };

  const get_stats = (): Record<string, number> => {
    const rows = stmts.count_by_status.all() as { status: string; count: number }[];
    const stats: Record<string, number> = { pending: 0, in_progress: 0, done: 0, blocked: 0, quarantined: 0 };
    for (const row of rows) {
      stats[row.status] = row.count;
    }
    return stats;
  };

  const get_all = (): Task[] => {
    const rows = stmts.all_tasks.all() as Record<string, unknown>[];
    return rows.map(row_to_task);
  };

  const close = () => {
    db.close();
  };

  return {
    create,
    get_by_id,
    get_by_status,
    get_pending_for_agent,
    update_status,
    complete_task,
    block_task,
    quarantine_task,
    get_stats,
    get_all,
    close,
    _db: db, // for testing
  };
};

export type TaskStore = ReturnType<typeof create_task_store>;
