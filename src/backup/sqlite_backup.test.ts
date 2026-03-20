// TDD tests for SQLite backup integrity verification
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  check_sqlite_integrity,
  count_tasks,
  compare_original_and_backup,
  type TaskCounts,
  type IntegrityResult,
} from './verify_backup_integrity.js';

// === Helper: create a test DB with the same schema as task_store.ts ===

const create_test_db = (db_path: string): Database.Database => {
  const db = new Database(db_path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      action TEXT,
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

  return db;
};

// === Helper: insert a task row ===

const insert_task = (
  db: Database.Database,
  overrides: Partial<{
    id: string;
    title: string;
    status: string;
    assigned_to: string;
    created_at: string;
    completed_at: string | null;
  }> = {},
) => {
  const defaults = {
    id: `test-${Math.random().toString(36).slice(2, 10)}`,
    title: 'Test task',
    status: 'pending',
    assigned_to: 'captain',
    created_at: new Date().toISOString(),
    completed_at: null,
  };
  const row = { ...defaults, ...overrides };

  db.prepare(`
    INSERT INTO tasks (id, title, status, assigned_to, created_at, completed_at, depends_on)
    VALUES (?, ?, ?, ?, ?, ?, '[]')
  `).run(row.id, row.title, row.status, row.assigned_to, row.created_at, row.completed_at);
};

// === Tests ===

describe('verify_backup_integrity', () => {
  let tmp_dir: string;

  beforeEach(() => {
    tmp_dir = mkdtempSync(join(tmpdir(), 'fas-backup-test-'));
  });

  afterEach(() => {
    rmSync(tmp_dir, { recursive: true, force: true });
  });

  // === check_sqlite_integrity ===

  describe('check_sqlite_integrity()', () => {
    it('should return true for a valid SQLite database', () => {
      const db_path = join(tmp_dir, 'valid.sqlite');
      const db = create_test_db(db_path);
      db.close();

      expect(check_sqlite_integrity(db_path)).toBe(true);
    });

    it('should return false for a corrupt file', () => {
      const db_path = join(tmp_dir, 'corrupt.sqlite');
      // Write garbage data to simulate a corrupt DB
      writeFileSync(db_path, 'this is not a valid sqlite database file at all');

      expect(check_sqlite_integrity(db_path)).toBe(false);
    });

    it('should return false for a non-existent file', () => {
      const db_path = join(tmp_dir, 'nonexistent.sqlite');

      expect(check_sqlite_integrity(db_path)).toBe(false);
    });
  });

  // === count_tasks ===

  describe('count_tasks()', () => {
    it('should return zero counts for an empty database', () => {
      const db_path = join(tmp_dir, 'empty.sqlite');
      const db = create_test_db(db_path);
      db.close();

      const counts: TaskCounts = count_tasks(db_path);

      expect(counts.total).toBe(0);
      expect(counts.completed).toBe(0);
      expect(counts.pending).toBe(0);
    });

    it('should correctly count tasks by status', () => {
      const db_path = join(tmp_dir, 'with-tasks.sqlite');
      const db = create_test_db(db_path);

      // Insert 3 pending, 2 done, 1 in_progress
      insert_task(db, { id: 'p1', status: 'pending' });
      insert_task(db, { id: 'p2', status: 'pending' });
      insert_task(db, { id: 'p3', status: 'pending' });
      insert_task(db, { id: 'd1', status: 'done', completed_at: new Date().toISOString() });
      insert_task(db, { id: 'd2', status: 'done', completed_at: new Date().toISOString() });
      insert_task(db, { id: 'ip1', status: 'in_progress' });

      db.close();

      const counts = count_tasks(db_path);

      expect(counts.total).toBe(6);
      expect(counts.completed).toBe(2);
      // pending = total - completed (includes in_progress, blocked, etc.)
      expect(counts.pending).toBe(4);
    });

    it('should count blocked and quarantined tasks as pending', () => {
      const db_path = join(tmp_dir, 'mixed-status.sqlite');
      const db = create_test_db(db_path);

      insert_task(db, { id: 'b1', status: 'blocked' });
      insert_task(db, { id: 'q1', status: 'quarantined' });
      insert_task(db, { id: 'd1', status: 'done', completed_at: new Date().toISOString() });

      db.close();

      const counts = count_tasks(db_path);

      expect(counts.total).toBe(3);
      expect(counts.completed).toBe(1);
      expect(counts.pending).toBe(2);
    });
  });

  // === compare_original_and_backup ===

  describe('compare_original_and_backup()', () => {
    it('should return match=true when original and backup have identical data', () => {
      const original_path = join(tmp_dir, 'original.sqlite');
      const backup_path = join(tmp_dir, 'backup.sqlite');

      // Create original with tasks
      const original_db = create_test_db(original_path);
      insert_task(original_db, { id: 'a1', status: 'pending' });
      insert_task(original_db, { id: 'a2', status: 'done', completed_at: new Date().toISOString() });
      original_db.close();

      // Create identical backup
      const backup_db = create_test_db(backup_path);
      insert_task(backup_db, { id: 'a1', status: 'pending' });
      insert_task(backup_db, { id: 'a2', status: 'done', completed_at: new Date().toISOString() });
      backup_db.close();

      const result: IntegrityResult = compare_original_and_backup(original_path, backup_path);

      expect(result.match).toBe(true);
      expect(result.sqlite_total).toBe(2);
      expect(result.sqlite_completed).toBe(1);
      expect(result.sqlite_pending).toBe(1);
      expect(result.backup_total).toBe(2);
      expect(result.backup_completed).toBe(1);
      expect(result.checked_at).toBeTruthy();
    });

    it('should return match=false when backup has fewer tasks', () => {
      const original_path = join(tmp_dir, 'original2.sqlite');
      const backup_path = join(tmp_dir, 'backup2.sqlite');

      // Original: 3 tasks
      const original_db = create_test_db(original_path);
      insert_task(original_db, { id: 'x1', status: 'pending' });
      insert_task(original_db, { id: 'x2', status: 'pending' });
      insert_task(original_db, { id: 'x3', status: 'done', completed_at: new Date().toISOString() });
      original_db.close();

      // Backup: 2 tasks (missing one)
      const backup_db = create_test_db(backup_path);
      insert_task(backup_db, { id: 'x1', status: 'pending' });
      insert_task(backup_db, { id: 'x3', status: 'done', completed_at: new Date().toISOString() });
      backup_db.close();

      const result = compare_original_and_backup(original_path, backup_path);

      expect(result.match).toBe(false);
      expect(result.sqlite_total).toBe(3);
      expect(result.backup_total).toBe(2);
    });

    it('should return match=false when status counts differ', () => {
      const original_path = join(tmp_dir, 'original3.sqlite');
      const backup_path = join(tmp_dir, 'backup3.sqlite');

      // Original: 1 done
      const original_db = create_test_db(original_path);
      insert_task(original_db, { id: 'y1', status: 'done', completed_at: new Date().toISOString() });
      original_db.close();

      // Backup: same task but still pending (stale backup)
      const backup_db = create_test_db(backup_path);
      insert_task(backup_db, { id: 'y1', status: 'pending' });
      backup_db.close();

      const result = compare_original_and_backup(original_path, backup_path);

      expect(result.match).toBe(false);
      expect(result.sqlite_completed).toBe(1);
      expect(result.backup_completed).toBe(0);
    });

    it('should include ISO timestamp in checked_at', () => {
      const original_path = join(tmp_dir, 'original4.sqlite');
      const backup_path = join(tmp_dir, 'backup4.sqlite');

      const db1 = create_test_db(original_path);
      db1.close();
      const db2 = create_test_db(backup_path);
      db2.close();

      const result = compare_original_and_backup(original_path, backup_path);

      // Should be a valid ISO date string
      expect(() => new Date(result.checked_at).toISOString()).not.toThrow();
    });
  });
});
