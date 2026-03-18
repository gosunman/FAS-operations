// TDD tests for activity logger
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { create_activity_logger, type ActivityLogger } from './activity_logger.js';

describe('Activity Logger', () => {
  let logger: ActivityLogger;

  beforeEach(() => {
    logger = create_activity_logger({ db_path: ':memory:' });
  });

  afterEach(() => {
    logger.close();
  });

  // === log_activity ===

  describe('log_activity()', () => {
    it('should create an activity entry with correct fields', () => {
      const id = logger.log_activity({
        agent: 'claude',
        action: 'git commit',
        risk_level: 'mid',
        approval_decision: 'approved',
        approval_reviewer: 'gemini_a',
        details: { files: ['src/main.ts'], branch: 'feature-x' },
      });

      // Verify the id is a valid UUID
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

      // Retrieve and verify the entry
      const entries = logger.get_activities_by_agent('claude');
      expect(entries).toHaveLength(1);

      const entry = entries[0];
      expect(entry.id).toBe(id);
      expect(entry.agent).toBe('claude');
      expect(entry.action).toBe('git commit');
      expect(entry.risk_level).toBe('mid');
      expect(entry.approval_decision).toBe('approved');
      expect(entry.approval_reviewer).toBe('gemini_a');
      expect(entry.details).toEqual({ files: ['src/main.ts'], branch: 'feature-x' });
      expect(entry.timestamp).toBeDefined();
    });

    it('should handle optional fields as undefined', () => {
      const id = logger.log_activity({
        agent: 'gemini_a',
        action: 'web_search',
        risk_level: 'low',
      });

      const entries = logger.get_activities_by_agent('gemini_a');
      expect(entries).toHaveLength(1);

      const entry = entries[0];
      expect(entry.id).toBe(id);
      expect(entry.approval_decision).toBeUndefined();
      expect(entry.approval_reviewer).toBeUndefined();
      expect(entry.details).toEqual({});
    });
  });

  // === log_approval ===

  describe('log_approval()', () => {
    it('should create an approval history entry', () => {
      const id = logger.log_approval({
        requester: 'claude',
        action: 'git push',
        risk_level: 'high',
        decision: 'approved',
        reviewer: 'gemini_a',
        reason: 'Changes reviewed, no PII detected',
        duration_ms: 4500,
      });

      expect(id).toMatch(/^[0-9a-f]{8}-/);

      // Retrieve via date range (wide range to capture)
      const now = new Date();
      const start = new Date(now.getTime() - 60_000).toISOString();
      const end = new Date(now.getTime() + 60_000).toISOString();

      const approvals = logger.get_approvals_by_date(start, end);
      expect(approvals).toHaveLength(1);

      const approval = approvals[0];
      expect(approval.id).toBe(id);
      expect(approval.requester).toBe('claude');
      expect(approval.action).toBe('git push');
      expect(approval.risk_level).toBe('high');
      expect(approval.decision).toBe('approved');
      expect(approval.reviewer).toBe('gemini_a');
      expect(approval.reason).toBe('Changes reviewed, no PII detected');
      expect(approval.duration_ms).toBe(4500);
    });

    it('should record timeout decisions', () => {
      logger.log_approval({
        requester: 'claude',
        action: 'deploy to staging',
        risk_level: 'high',
        decision: 'timeout',
        reviewer: 'gemini_a',
        reason: 'No response within timeout window',
        duration_ms: 600_000,
      });

      const now = new Date();
      const start = new Date(now.getTime() - 60_000).toISOString();
      const end = new Date(now.getTime() + 60_000).toISOString();

      const approvals = logger.get_approvals_by_date(start, end);
      expect(approvals[0].decision).toBe('timeout');
    });
  });

  // === get_activities_by_agent with limit ===

  describe('get_activities_by_agent()', () => {
    it('should respect the limit parameter', () => {
      // Insert 5 activities
      for (let i = 0; i < 5; i++) {
        logger.log_activity({
          agent: 'claude',
          action: `action_${i}`,
          risk_level: 'low',
        });
      }

      const all = logger.get_activities_by_agent('claude');
      expect(all).toHaveLength(5);

      const limited = logger.get_activities_by_agent('claude', 3);
      expect(limited).toHaveLength(3);
    });

    it('should only return activities for the specified agent', () => {
      logger.log_activity({ agent: 'claude', action: 'code_review', risk_level: 'low' });
      logger.log_activity({ agent: 'gemini_a', action: 'web_search', risk_level: 'low' });
      logger.log_activity({ agent: 'claude', action: 'git_commit', risk_level: 'mid' });

      const claude_entries = logger.get_activities_by_agent('claude');
      expect(claude_entries).toHaveLength(2);
      expect(claude_entries.every((e) => e.agent === 'claude')).toBe(true);

      const gemini_entries = logger.get_activities_by_agent('gemini_a');
      expect(gemini_entries).toHaveLength(1);
      expect(gemini_entries[0].agent).toBe('gemini_a');
    });
  });

  // === get_activities_by_date filtering ===

  describe('get_activities_by_date()', () => {
    it('should filter activities within the date range', () => {
      // Insert activities — all will have timestamps close to "now"
      logger.log_activity({ agent: 'claude', action: 'action_a', risk_level: 'low' });
      logger.log_activity({ agent: 'gemini_a', action: 'action_b', risk_level: 'mid' });

      const now = new Date();
      const start = new Date(now.getTime() - 60_000).toISOString();
      const end = new Date(now.getTime() + 60_000).toISOString();

      const entries = logger.get_activities_by_date(start, end);
      expect(entries).toHaveLength(2);
    });

    it('should return empty array when no activities match the date range', () => {
      logger.log_activity({ agent: 'claude', action: 'action_a', risk_level: 'low' });

      // Query a date range in the far past
      const entries = logger.get_activities_by_date('2020-01-01T00:00:00Z', '2020-01-02T00:00:00Z');
      expect(entries).toHaveLength(0);
    });
  });

  // === get_approvals_by_date filtering ===

  describe('get_approvals_by_date()', () => {
    it('should filter approvals within the date range', () => {
      logger.log_approval({
        requester: 'claude',
        action: 'git push',
        risk_level: 'high',
        decision: 'approved',
        reviewer: 'gemini_a',
        reason: 'Looks good',
        duration_ms: 2000,
      });
      logger.log_approval({
        requester: 'claude',
        action: 'deploy',
        risk_level: 'critical',
        decision: 'rejected',
        reviewer: 'gemini_a',
        reason: 'PII detected in payload',
        duration_ms: 1500,
      });

      const now = new Date();
      const start = new Date(now.getTime() - 60_000).toISOString();
      const end = new Date(now.getTime() + 60_000).toISOString();

      const approvals = logger.get_approvals_by_date(start, end);
      expect(approvals).toHaveLength(2);
      expect(approvals[0].decision).toBe('approved');
      expect(approvals[1].decision).toBe('rejected');
    });

    it('should return empty array when no approvals match the date range', () => {
      logger.log_approval({
        requester: 'claude',
        action: 'git push',
        risk_level: 'high',
        decision: 'approved',
        reviewer: 'gemini_a',
        reason: 'OK',
        duration_ms: 1000,
      });

      const approvals = logger.get_approvals_by_date('2020-01-01T00:00:00Z', '2020-01-02T00:00:00Z');
      expect(approvals).toHaveLength(0);
    });
  });
});
