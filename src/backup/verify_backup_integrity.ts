// SQLite backup integrity verification for FAS Operations
// Provides functions to check DB integrity, count tasks, and compare original vs backup
//
// CLI usage: npx tsx src/backup/verify_backup_integrity.ts <original_db> <backup_db>

import Database from 'better-sqlite3';
import { existsSync } from 'fs';

// === Types ===

export type TaskCounts = {
  total: number;
  completed: number;
  pending: number;
};

export type IntegrityResult = {
  sqlite_total: number;
  sqlite_completed: number;
  sqlite_pending: number;
  backup_total: number;
  backup_completed: number;
  match: boolean;
  checked_at: string;
};

// === Core functions ===

/**
 * Check SQLite database integrity using PRAGMA integrity_check.
 * Returns true if the database is valid, false if corrupt or missing.
 */
export const check_sqlite_integrity = (db_path: string): boolean => {
  try {
    if (!existsSync(db_path)) {
      return false;
    }

    const db = new Database(db_path, { readonly: true });
    try {
      const result = db.pragma('integrity_check') as { integrity_check: string }[];
      // integrity_check returns [{ integrity_check: 'ok' }] for valid DBs
      return result.length > 0 && result[0].integrity_check === 'ok';
    } finally {
      db.close();
    }
  } catch {
    // Any error (corrupt file, not a DB, etc.) means integrity check failed
    return false;
  }
};

/**
 * Count tasks in a SQLite database by status.
 * Returns total, completed (status='done'), and pending (everything else).
 */
export const count_tasks = (db_path: string): TaskCounts => {
  const db = new Database(db_path, { readonly: true });
  try {
    const total_row = db.prepare('SELECT COUNT(*) as count FROM tasks').get() as { count: number };
    const completed_row = db.prepare(
      "SELECT COUNT(*) as count FROM tasks WHERE status = 'done'"
    ).get() as { count: number };

    const total = total_row.count;
    const completed = completed_row.count;

    return {
      total,
      completed,
      pending: total - completed,
    };
  } finally {
    db.close();
  }
};

/**
 * Compare the original database against a backup.
 * Checks if task counts (total, completed, pending) match between the two.
 */
export const compare_original_and_backup = (
  original_path: string,
  backup_path: string,
): IntegrityResult => {
  const original_counts = count_tasks(original_path);
  const backup_counts = count_tasks(backup_path);

  const match =
    original_counts.total === backup_counts.total &&
    original_counts.completed === backup_counts.completed &&
    original_counts.pending === backup_counts.pending;

  return {
    sqlite_total: original_counts.total,
    sqlite_completed: original_counts.completed,
    sqlite_pending: original_counts.pending,
    backup_total: backup_counts.total,
    backup_completed: backup_counts.completed,
    match,
    checked_at: new Date().toISOString(),
  };
};

// === CLI entrypoint ===

const main = () => {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: npx tsx src/backup/verify_backup_integrity.ts <original_db> <backup_db>');
    process.exit(1);
  }

  const [original_path, backup_path] = args;

  // Check integrity of both files first
  console.log(`Checking original: ${original_path}`);
  const original_ok = check_sqlite_integrity(original_path);
  console.log(`  Integrity: ${original_ok ? 'OK' : 'FAILED'}`);

  if (!original_ok) {
    console.error('ERROR: Original database integrity check failed');
    process.exit(2);
  }

  console.log(`Checking backup: ${backup_path}`);
  const backup_ok = check_sqlite_integrity(backup_path);
  console.log(`  Integrity: ${backup_ok ? 'OK' : 'FAILED'}`);

  if (!backup_ok) {
    console.error('ERROR: Backup database integrity check failed');
    process.exit(2);
  }

  // Compare counts
  const result = compare_original_and_backup(original_path, backup_path);

  console.log('\n=== Integrity Verification Result ===');
  console.log(`Original — total: ${result.sqlite_total}, completed: ${result.sqlite_completed}, pending: ${result.sqlite_pending}`);
  console.log(`Backup   — total: ${result.backup_total}, completed: ${result.backup_completed}`);
  console.log(`Match: ${result.match ? 'YES' : 'NO'}`);
  console.log(`Checked at: ${result.checked_at}`);

  if (!result.match) {
    console.error('\nWARNING: Original and backup do NOT match!');
    process.exit(3);
  }

  console.log('\nBackup verification: PASSED');
};

// Run CLI only when executed directly (not imported)
if (process.argv[1]?.endsWith('verify_backup_integrity.ts') ||
    process.argv[1]?.endsWith('verify_backup_integrity.js')) {
  main();
}
