// FAS File-based Activity Logger
// Routes activity logs to per-agent daily files and approval logs to JSON files.
// Supports auto-directory creation, log rotation (configurable retention),
// and structured approval audit trail.
//
// Log format: [YYYY-MM-DD HH:mm:ss] [{LEVEL}] {agent}: {message}
// Approval format: One JSON object per line (JSONL) in approvals/{date}.json

import * as fs from 'node:fs';
import * as path from 'node:path';

// === Types ===

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'critical';

export type FileLoggerConfig = {
  base_dir: string;          // default: './logs'
  retention_days: number;    // default: 30
  max_file_size_mb: number;  // default: 10
};

export type ApprovalAuditEntry = {
  timestamp: string;
  request_id: string;
  requester: string;
  action: string;
  risk_level: string;
  decision: 'approved' | 'rejected' | 'timeout';
  reviewer: string;
  reason: string;
  duration_ms: number;
};

// === Default config ===

const DEFAULT_CONFIG: FileLoggerConfig = {
  base_dir: './logs',
  retention_days: 30,
  max_file_size_mb: 10,
};

// === Helpers ===

// Format current time as YYYY-MM-DD HH:mm:ss
const format_timestamp = (): string => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
};

// Get today's date as YYYY-MM-DD
const today_string = (): string => {
  return new Date().toISOString().slice(0, 10);
};

// Ensure a directory exists, creating it recursively if needed
const ensure_dir = (dir_path: string): void => {
  if (!fs.existsSync(dir_path)) {
    fs.mkdirSync(dir_path, { recursive: true });
  }
};

// Parse a date from a filename like "2026-03-21.log" or "2026-03-21.json"
const parse_date_from_filename = (filename: string): Date | null => {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})\.(log|json)$/);
  if (!match) return null;
  const date = new Date(match[1] + 'T00:00:00.000Z');
  return isNaN(date.getTime()) ? null : date;
};

// === Factory function ===

export const create_file_logger = (config?: Partial<FileLoggerConfig>) => {
  const cfg: FileLoggerConfig = { ...DEFAULT_CONFIG, ...config };

  // Ensure base directory exists
  ensure_dir(cfg.base_dir);

  // --- log: Write a formatted log line to agent-specific daily file ---
  const log = (agent: string, level: LogLevel, message: string): void => {
    const agent_dir = path.join(cfg.base_dir, agent);
    ensure_dir(agent_dir);

    const log_file = path.join(agent_dir, `${today_string()}.log`);
    const line = `[${format_timestamp()}] [${level.toUpperCase()}] ${agent}: ${message}\n`;

    fs.appendFileSync(log_file, line, 'utf-8');
  };

  // --- log_approval: Append a JSON line to the daily approval audit file ---
  const log_approval = (entry: ApprovalAuditEntry): void => {
    const approval_dir = path.join(cfg.base_dir, 'approvals');
    ensure_dir(approval_dir);

    const approval_file = path.join(approval_dir, `${today_string()}.json`);
    const line = JSON.stringify(entry) + '\n';

    fs.appendFileSync(approval_file, line, 'utf-8');
  };

  return {
    log,
    log_approval,
  };
};

// === Cleanup old logs ===
// Deletes log and approval files older than retention_days.
// Returns the number of files removed.

export const cleanup_old_logs = (base_dir: string, retention_days: number): number => {
  if (!fs.existsSync(base_dir)) return 0;

  const cutoff = new Date(Date.now() - retention_days * 24 * 60 * 60 * 1000);
  let removed = 0;

  // Iterate all subdirectories (agent dirs + approvals dir)
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(base_dir, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const sub_dir = path.join(base_dir, entry.name);
    let files: string[];
    try {
      files = fs.readdirSync(sub_dir);
    } catch {
      continue;
    }

    for (const file of files) {
      const file_date = parse_date_from_filename(file);
      if (!file_date) continue;

      if (file_date < cutoff) {
        try {
          fs.unlinkSync(path.join(sub_dir, file));
          removed += 1;
        } catch {
          // Skip files that can't be deleted
        }
      }
    }
  }

  return removed;
};

// === Export type for external use ===

export type FileLogger = ReturnType<typeof create_file_logger>;
