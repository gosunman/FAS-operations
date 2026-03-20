// TDD tests for file-based activity logger
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { create_file_logger, cleanup_old_logs, type FileLoggerConfig, type ApprovalAuditEntry } from './file_logger.js';

describe('File Logger', () => {
  let tmp_dir: string;

  beforeEach(() => {
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fas-file-logger-'));
  });

  afterEach(() => {
    fs.rmSync(tmp_dir, { recursive: true, force: true });
  });

  // === create_file_logger ===

  describe('create_file_logger()', () => {
    it('should create logger with default config', () => {
      const logger = create_file_logger({ base_dir: tmp_dir });
      expect(logger).toHaveProperty('log');
      expect(logger).toHaveProperty('log_approval');
    });

    it('should auto-create base directory if it does not exist', () => {
      const nested = path.join(tmp_dir, 'nested', 'logs');
      const logger = create_file_logger({ base_dir: nested });
      logger.log('captain', 'info', 'test message');
      expect(fs.existsSync(nested)).toBe(true);
    });
  });

  // === log() ===

  describe('log()', () => {
    it('should write log entry to agent-specific file', () => {
      const logger = create_file_logger({ base_dir: tmp_dir });
      logger.log('captain', 'info', 'System started');

      const today = new Date().toISOString().slice(0, 10);
      const log_file = path.join(tmp_dir, 'captain', `${today}.log`);
      expect(fs.existsSync(log_file)).toBe(true);

      const content = fs.readFileSync(log_file, 'utf-8');
      expect(content).toContain('[INFO]');
      expect(content).toContain('captain:');
      expect(content).toContain('System started');
    });

    it('should create agent subdirectory automatically', () => {
      const logger = create_file_logger({ base_dir: tmp_dir });
      logger.log('hunter', 'warn', 'Task delayed');

      const agent_dir = path.join(tmp_dir, 'hunter');
      expect(fs.existsSync(agent_dir)).toBe(true);
    });

    it('should append multiple log entries to same file', () => {
      const logger = create_file_logger({ base_dir: tmp_dir });
      logger.log('captain', 'info', 'First message');
      logger.log('captain', 'error', 'Second message');

      const today = new Date().toISOString().slice(0, 10);
      const log_file = path.join(tmp_dir, 'captain', `${today}.log`);
      const content = fs.readFileSync(log_file, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(2);
    });

    it('should format log entries correctly', () => {
      const logger = create_file_logger({ base_dir: tmp_dir });
      logger.log('captain', 'critical', 'Disk full');

      const today = new Date().toISOString().slice(0, 10);
      const log_file = path.join(tmp_dir, 'captain', `${today}.log`);
      const content = fs.readFileSync(log_file, 'utf-8').trim();

      // Format: [YYYY-MM-DD HH:mm:ss] [CRITICAL] captain: Disk full
      expect(content).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \[CRITICAL\] captain: Disk full$/);
    });

    it('should handle all log levels', () => {
      const logger = create_file_logger({ base_dir: tmp_dir });
      const levels = ['debug', 'info', 'warn', 'error', 'critical'] as const;

      for (const level of levels) {
        logger.log('captain', level, `${level} message`);
      }

      const today = new Date().toISOString().slice(0, 10);
      const log_file = path.join(tmp_dir, 'captain', `${today}.log`);
      const content = fs.readFileSync(log_file, 'utf-8');

      expect(content).toContain('[DEBUG]');
      expect(content).toContain('[INFO]');
      expect(content).toContain('[WARN]');
      expect(content).toContain('[ERROR]');
      expect(content).toContain('[CRITICAL]');
    });

    it('should separate logs by agent', () => {
      const logger = create_file_logger({ base_dir: tmp_dir });
      logger.log('captain', 'info', 'Captain log');
      logger.log('hunter', 'info', 'Hunter log');

      const today = new Date().toISOString().slice(0, 10);
      const captain_file = path.join(tmp_dir, 'captain', `${today}.log`);
      const hunter_file = path.join(tmp_dir, 'hunter', `${today}.log`);

      expect(fs.readFileSync(captain_file, 'utf-8')).toContain('Captain log');
      expect(fs.readFileSync(captain_file, 'utf-8')).not.toContain('Hunter log');
      expect(fs.readFileSync(hunter_file, 'utf-8')).toContain('Hunter log');
    });
  });

  // === log_approval() ===

  describe('log_approval()', () => {
    it('should write approval entry to approvals JSON file', () => {
      const logger = create_file_logger({ base_dir: tmp_dir });
      const entry: ApprovalAuditEntry = {
        timestamp: '2026-03-21T10:00:00.000Z',
        request_id: 'req-001',
        requester: 'claude',
        action: 'git push',
        risk_level: 'high',
        decision: 'approved',
        reviewer: 'gemini_a',
        reason: 'Code review passed',
        duration_ms: 5000,
      };
      logger.log_approval(entry);

      const today = new Date().toISOString().slice(0, 10);
      const approval_file = path.join(tmp_dir, 'approvals', `${today}.json`);
      expect(fs.existsSync(approval_file)).toBe(true);

      const content = fs.readFileSync(approval_file, 'utf-8');
      const entries = JSON.parse(`[${content.split('\n').filter(Boolean).join(',')}]`);
      expect(entries).toHaveLength(1);
      expect(entries[0].request_id).toBe('req-001');
      expect(entries[0].decision).toBe('approved');
    });

    it('should append multiple approval entries', () => {
      const logger = create_file_logger({ base_dir: tmp_dir });
      const base: ApprovalAuditEntry = {
        timestamp: '2026-03-21T10:00:00.000Z',
        request_id: 'req-001',
        requester: 'claude',
        action: 'git push',
        risk_level: 'high',
        decision: 'approved',
        reviewer: 'gemini_a',
        reason: 'OK',
        duration_ms: 5000,
      };

      logger.log_approval(base);
      logger.log_approval({ ...base, request_id: 'req-002', decision: 'rejected' });

      const today = new Date().toISOString().slice(0, 10);
      const approval_file = path.join(tmp_dir, 'approvals', `${today}.json`);
      const content = fs.readFileSync(approval_file, 'utf-8');
      const entries = JSON.parse(`[${content.split('\n').filter(Boolean).join(',')}]`);
      expect(entries).toHaveLength(2);
    });

    it('should handle timeout decisions', () => {
      const logger = create_file_logger({ base_dir: tmp_dir });
      const entry: ApprovalAuditEntry = {
        timestamp: '2026-03-21T10:00:00.000Z',
        request_id: 'req-003',
        requester: 'claude',
        action: 'deploy',
        risk_level: 'critical',
        decision: 'timeout',
        reviewer: 'none',
        reason: 'No response within 10 minutes',
        duration_ms: 600000,
      };
      logger.log_approval(entry);

      const today = new Date().toISOString().slice(0, 10);
      const approval_file = path.join(tmp_dir, 'approvals', `${today}.json`);
      const content = fs.readFileSync(approval_file, 'utf-8');
      const entries = JSON.parse(`[${content.split('\n').filter(Boolean).join(',')}]`);
      expect(entries[0].decision).toBe('timeout');
    });
  });

  // === cleanup_old_logs() ===

  describe('cleanup_old_logs()', () => {
    it('should delete log files older than retention days', () => {
      // Create old log files
      const old_agent_dir = path.join(tmp_dir, 'captain');
      fs.mkdirSync(old_agent_dir, { recursive: true });

      const old_date = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000); // 40 days ago
      const old_filename = `${old_date.toISOString().slice(0, 10)}.log`;
      fs.writeFileSync(path.join(old_agent_dir, old_filename), 'old log data');

      const recent_date = new Date();
      const recent_filename = `${recent_date.toISOString().slice(0, 10)}.log`;
      fs.writeFileSync(path.join(old_agent_dir, recent_filename), 'recent log data');

      const removed = cleanup_old_logs(tmp_dir, 30);

      expect(fs.existsSync(path.join(old_agent_dir, old_filename))).toBe(false);
      expect(fs.existsSync(path.join(old_agent_dir, recent_filename))).toBe(true);
      expect(removed).toBeGreaterThanOrEqual(1);
    });

    it('should clean up old approval files too', () => {
      const approval_dir = path.join(tmp_dir, 'approvals');
      fs.mkdirSync(approval_dir, { recursive: true });

      const old_date = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
      const old_filename = `${old_date.toISOString().slice(0, 10)}.json`;
      fs.writeFileSync(path.join(approval_dir, old_filename), '{}');

      const removed = cleanup_old_logs(tmp_dir, 30);
      expect(fs.existsSync(path.join(approval_dir, old_filename))).toBe(false);
      expect(removed).toBeGreaterThanOrEqual(1);
    });

    it('should return 0 when no old files exist', () => {
      const agent_dir = path.join(tmp_dir, 'captain');
      fs.mkdirSync(agent_dir, { recursive: true });

      const today = new Date().toISOString().slice(0, 10);
      fs.writeFileSync(path.join(agent_dir, `${today}.log`), 'fresh data');

      const removed = cleanup_old_logs(tmp_dir, 30);
      expect(removed).toBe(0);
    });

    it('should handle empty base directory gracefully', () => {
      const removed = cleanup_old_logs(tmp_dir, 30);
      expect(removed).toBe(0);
    });

    it('should handle non-existent base directory gracefully', () => {
      const removed = cleanup_old_logs(path.join(tmp_dir, 'nonexistent'), 30);
      expect(removed).toBe(0);
    });
  });
});
