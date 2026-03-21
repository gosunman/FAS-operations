// SQLite-based project database for Hunter autonomous revenue pipeline
// Manages project lifecycle: discovered -> researching -> planned -> building -> testing -> deployed -> monitoring -> succeeded/failed/needs_owner

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Project, ProjectStatus } from '../shared/types.js';

// === Types ===

export type CreateProjectParams = {
  title: string;
  category: string;
  expected_revenue: string;
  resources_needed: string[];
};

export type ProjectDBConfig = {
  db_path: string;             // ':memory:' for testing
  busy_timeout_ms?: number;    // SQLite busy timeout (default: 5000ms)
};

export type ProjectStats = {
  total: number;
  by_status: Record<string, number>;
  total_revenue: number;
};

export type ProjectDB = {
  create: (params: CreateProjectParams) => Project;
  get_by_id: (id: string) => Project | undefined;
  get_by_status: (status: ProjectStatus) => Project[];
  get_all: () => Project[];
  update_status: (id: string, status: ProjectStatus) => boolean;
  update_revenue: (id: string, actual_revenue: number) => boolean;
  set_owner_action: (id: string, action: string) => boolean;
  set_retrospective: (id: string, retrospective: string) => boolean;
  add_openclaw_session: (id: string, session_id: string) => boolean;
  get_most_promising: () => Project | undefined;
  get_active_count: () => number;
  get_stats: () => ProjectStats;
  close: () => void;
  _db: Database.Database; // exposed for testing
};

// === Factory function ===

export const create_project_db = (config: ProjectDBConfig): ProjectDB => {
  const db = new Database(config.db_path);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // Busy timeout: wait instead of failing immediately on SQLITE_BUSY
  db.pragma(`busy_timeout = ${config.busy_timeout_ms ?? 5000}`);

  // === Initialize schema ===
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'discovered',
      expected_revenue TEXT NOT NULL DEFAULT '',
      actual_revenue REAL NOT NULL DEFAULT 0,
      resources_needed TEXT NOT NULL DEFAULT '[]',
      owner_action_needed TEXT,
      retrospective TEXT,
      openclaw_sessions TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
    CREATE INDEX IF NOT EXISTS idx_projects_category ON projects(category);
  `);

  // === Prepared statements ===
  const stmts = {
    insert: db.prepare(`
      INSERT INTO projects (id, title, category, status, expected_revenue, actual_revenue, resources_needed, owner_action_needed, retrospective, openclaw_sessions, created_at, updated_at)
      VALUES (@id, @title, @category, @status, @expected_revenue, @actual_revenue, @resources_needed, @owner_action_needed, @retrospective, @openclaw_sessions, @created_at, @updated_at)
    `),
    get_by_id: db.prepare('SELECT * FROM projects WHERE id = ?'),
    get_by_status: db.prepare('SELECT * FROM projects WHERE status = ? ORDER BY updated_at DESC'),
    get_all: db.prepare('SELECT * FROM projects ORDER BY updated_at DESC'),
    update_status: db.prepare('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?'),
    update_revenue: db.prepare('UPDATE projects SET actual_revenue = ?, updated_at = ? WHERE id = ?'),
    set_owner_action: db.prepare('UPDATE projects SET owner_action_needed = ?, status = ?, updated_at = ? WHERE id = ?'),
    set_retrospective: db.prepare('UPDATE projects SET retrospective = ?, updated_at = ? WHERE id = ?'),
    update_openclaw_sessions: db.prepare('UPDATE projects SET openclaw_sessions = ?, updated_at = ? WHERE id = ?'),
    // Get active projects ordered by status priority (furthest along first)
    get_most_promising: db.prepare(`
      SELECT * FROM projects
      WHERE status IN ('discovered', 'researching', 'planned', 'building', 'testing')
      ORDER BY
        CASE status
          WHEN 'testing' THEN 5
          WHEN 'building' THEN 4
          WHEN 'planned' THEN 3
          WHEN 'researching' THEN 2
          WHEN 'discovered' THEN 1
        END DESC
      LIMIT 1
    `),
    count_active: db.prepare(`
      SELECT COUNT(*) as count FROM projects
      WHERE status NOT IN ('succeeded', 'failed')
    `),
    count_by_status: db.prepare('SELECT status, COUNT(*) as count FROM projects GROUP BY status'),
    sum_revenue: db.prepare('SELECT COALESCE(SUM(actual_revenue), 0) as total FROM projects'),
  };

  // === Row to Project converter ===
  const row_to_project = (row: Record<string, unknown>): Project => ({
    id: row.id as string,
    title: row.title as string,
    category: row.category as string,
    status: row.status as ProjectStatus,
    expected_revenue: row.expected_revenue as string,
    actual_revenue: row.actual_revenue as number,
    resources_needed: JSON.parse(row.resources_needed as string) as string[],
    owner_action_needed: (row.owner_action_needed as string | null) ?? undefined,
    retrospective: (row.retrospective as string | null) ?? undefined,
    openclaw_sessions: JSON.parse(row.openclaw_sessions as string) as string[],
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  });

  // === CRUD operations ===

  const create = (params: CreateProjectParams): Project => {
    const id = randomUUID();
    const now = new Date().toISOString();

    stmts.insert.run({
      id,
      title: params.title,
      category: params.category,
      status: 'discovered',
      expected_revenue: params.expected_revenue,
      actual_revenue: 0,
      resources_needed: JSON.stringify(params.resources_needed),
      owner_action_needed: null,
      retrospective: null,
      openclaw_sessions: JSON.stringify([]),
      created_at: now,
      updated_at: now,
    });

    return get_by_id(id)!;
  };

  const get_by_id = (id: string): Project | undefined => {
    const row = stmts.get_by_id.get(id) as Record<string, unknown> | undefined;
    return row ? row_to_project(row) : undefined;
  };

  const get_by_status = (status: ProjectStatus): Project[] => {
    const rows = stmts.get_by_status.all(status) as Record<string, unknown>[];
    return rows.map(row_to_project);
  };

  const get_all = (): Project[] => {
    const rows = stmts.get_all.all() as Record<string, unknown>[];
    return rows.map(row_to_project);
  };

  const update_status = (id: string, status: ProjectStatus): boolean => {
    const now = new Date().toISOString();
    const result = stmts.update_status.run(status, now, id);
    return result.changes > 0;
  };

  const update_revenue = (id: string, actual_revenue: number): boolean => {
    const now = new Date().toISOString();
    const result = stmts.update_revenue.run(actual_revenue, now, id);
    return result.changes > 0;
  };

  const set_owner_action = (id: string, action: string): boolean => {
    const now = new Date().toISOString();
    // Setting owner_action also transitions status to 'needs_owner'
    const result = stmts.set_owner_action.run(action, 'needs_owner', now, id);
    return result.changes > 0;
  };

  const set_retrospective = (id: string, retrospective: string): boolean => {
    const now = new Date().toISOString();
    const result = stmts.set_retrospective.run(retrospective, now, id);
    return result.changes > 0;
  };

  const add_openclaw_session = (id: string, session_id: string): boolean => {
    // Read current sessions, append, and write back
    const project = get_by_id(id);
    if (!project) return false;

    const sessions = [...project.openclaw_sessions, session_id];
    const now = new Date().toISOString();
    const result = stmts.update_openclaw_sessions.run(JSON.stringify(sessions), now, id);
    return result.changes > 0;
  };

  const get_most_promising = (): Project | undefined => {
    const row = stmts.get_most_promising.get() as Record<string, unknown> | undefined;
    return row ? row_to_project(row) : undefined;
  };

  const get_active_count = (): number => {
    const row = stmts.count_active.get() as { count: number };
    return row.count;
  };

  const get_stats = (): ProjectStats => {
    const status_rows = stmts.count_by_status.all() as { status: string; count: number }[];
    const revenue_row = stmts.sum_revenue.get() as { total: number };

    const by_status: Record<string, number> = {};
    let total = 0;
    for (const row of status_rows) {
      by_status[row.status] = row.count;
      total += row.count;
    }

    return {
      total,
      by_status,
      total_revenue: revenue_row.total,
    };
  };

  const close = () => {
    db.close();
  };

  return {
    create,
    get_by_id,
    get_by_status,
    get_all,
    update_status,
    update_revenue,
    set_owner_action,
    set_retrospective,
    add_openclaw_session,
    get_most_promising,
    get_active_count,
    get_stats,
    close,
    _db: db,
  };
};
