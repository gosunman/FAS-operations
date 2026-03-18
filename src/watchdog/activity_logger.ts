// FAS Activity Logger
// Structured activity logging and approval history using SQLite.
// Tracks all agent actions with risk levels and approval decisions,
// enabling audit trails and compliance reporting.

import Database from 'better-sqlite3';
import { v4 as uuid_v4 } from 'uuid';
import type { RiskLevel, CrossApprovalDecision, ActivityLogEntry, ApprovalHistoryEntry } from '../shared/types.js';

// === Config type ===

export type ActivityLoggerConfig = {
  db_path: string;  // ':memory:' for testing
};

// === Factory function ===

export const create_activity_logger = (config: ActivityLoggerConfig) => {
  const db = new Database(config.db_path);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  // === Initialize schema ===
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      agent TEXT NOT NULL,
      action TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      approval_decision TEXT,
      approval_reviewer TEXT,
      details TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS approval_history (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      requester TEXT NOT NULL,
      action TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      decision TEXT NOT NULL,
      reviewer TEXT NOT NULL,
      reason TEXT NOT NULL,
      duration_ms INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_activity_agent ON activity_logs(agent);
    CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_approval_timestamp ON approval_history(timestamp);
  `);

  // === Prepared statements ===

  const stmts = {
    insert_activity: db.prepare(`
      INSERT INTO activity_logs (id, timestamp, agent, action, risk_level, approval_decision, approval_reviewer, details)
      VALUES (@id, @timestamp, @agent, @action, @risk_level, @approval_decision, @approval_reviewer, @details)
    `),
    insert_approval: db.prepare(`
      INSERT INTO approval_history (id, timestamp, requester, action, risk_level, decision, reviewer, reason, duration_ms)
      VALUES (@id, @timestamp, @requester, @action, @risk_level, @decision, @reviewer, @reason, @duration_ms)
    `),
    get_by_agent: db.prepare(`
      SELECT * FROM activity_logs WHERE agent = ? ORDER BY timestamp DESC LIMIT ?
    `),
    get_activities_by_date: db.prepare(`
      SELECT * FROM activity_logs WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC
    `),
    get_approvals_by_date: db.prepare(`
      SELECT * FROM approval_history WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC
    `),
  };

  // === Row converters ===

  const row_to_activity = (row: Record<string, unknown>): ActivityLogEntry => ({
    id: row.id as string,
    timestamp: row.timestamp as string,
    agent: row.agent as string,
    action: row.action as string,
    risk_level: row.risk_level as RiskLevel,
    approval_decision: (row.approval_decision as CrossApprovalDecision) ?? undefined,
    approval_reviewer: (row.approval_reviewer as string) ?? undefined,
    details: JSON.parse(row.details as string) as Record<string, unknown>,
  });

  const row_to_approval = (row: Record<string, unknown>): ApprovalHistoryEntry => ({
    id: row.id as string,
    timestamp: row.timestamp as string,
    requester: row.requester as string,
    action: row.action as string,
    risk_level: row.risk_level as RiskLevel,
    decision: row.decision as CrossApprovalDecision | 'timeout',
    reviewer: row.reviewer as string,
    reason: row.reason as string,
    duration_ms: row.duration_ms as number,
  });

  // === Public methods ===

  // Log an agent activity (action performed, risk level, optional approval info)
  const log_activity = (params: {
    agent: string;
    action: string;
    risk_level: RiskLevel;
    approval_decision?: CrossApprovalDecision;
    approval_reviewer?: string;
    details?: Record<string, unknown>;
  }): string => {
    const id = uuid_v4();
    const now = new Date().toISOString();

    stmts.insert_activity.run({
      id,
      timestamp: now,
      agent: params.agent,
      action: params.action,
      risk_level: params.risk_level,
      approval_decision: params.approval_decision ?? null,
      approval_reviewer: params.approval_reviewer ?? null,
      details: JSON.stringify(params.details ?? {}),
    });

    return id;
  };

  // Log an approval decision (approved/rejected/timeout with reviewer info)
  const log_approval = (params: {
    requester: string;
    action: string;
    risk_level: RiskLevel;
    decision: CrossApprovalDecision | 'timeout';
    reviewer: string;
    reason: string;
    duration_ms: number;
  }): string => {
    const id = uuid_v4();
    const now = new Date().toISOString();

    stmts.insert_approval.run({
      id,
      timestamp: now,
      requester: params.requester,
      action: params.action,
      risk_level: params.risk_level,
      decision: params.decision,
      reviewer: params.reviewer,
      reason: params.reason,
      duration_ms: params.duration_ms,
    });

    return id;
  };

  // Retrieve activity logs for a specific agent, ordered by most recent first
  const get_activities_by_agent = (agent: string, limit = 100): ActivityLogEntry[] => {
    const rows = stmts.get_by_agent.all(agent, limit) as Record<string, unknown>[];
    return rows.map(row_to_activity);
  };

  // Retrieve activity logs within a date range (ISO 8601 strings)
  const get_activities_by_date = (start: string, end: string): ActivityLogEntry[] => {
    const rows = stmts.get_activities_by_date.all(start, end) as Record<string, unknown>[];
    return rows.map(row_to_activity);
  };

  // Retrieve approval history within a date range (ISO 8601 strings)
  const get_approvals_by_date = (start: string, end: string): ApprovalHistoryEntry[] => {
    const rows = stmts.get_approvals_by_date.all(start, end) as Record<string, unknown>[];
    return rows.map(row_to_approval);
  };

  // Close the database connection
  const close = (): void => {
    db.close();
  };

  return {
    log_activity,
    log_approval,
    get_activities_by_agent,
    get_activities_by_date,
    get_approvals_by_date,
    close,
    _db: db, // exposed for testing
  };
};

export type ActivityLogger = ReturnType<typeof create_activity_logger>;
