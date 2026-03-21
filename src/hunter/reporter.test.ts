// Tests for hunter reporter module
// Verifies Telegram notifications, file reports, and graceful degradation

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { create_hunter_reporter } from './reporter.js';
import type { HunterNotify } from './notify.js';
import type { HunterConfig } from './config.js';
import type { Logger } from './logger.js';
import type { Project } from '../shared/types.js';

// --- Test fixtures ---

const make_project = (overrides: Partial<Project> = {}): Project => ({
  id: 'proj-001',
  title: 'Auto Blog SEO',
  category: 'blog_seo_auto_content',
  status: 'discovered',
  expected_revenue: '₩500,000/mo',
  actual_revenue: 0,
  resources_needed: ['OpenClaw', 'WordPress API'],
  owner_action_needed: undefined,
  retrospective: undefined,
  openclaw_sessions: [],
  created_at: '2026-03-22T00:00:00Z',
  updated_at: '2026-03-22T00:00:00Z',
  ...overrides,
});

const make_mock_notify = (): HunterNotify => ({
  send_telegram: vi.fn().mockResolvedValue(true),
  send_slack: vi.fn().mockResolvedValue(true),
  alert: vi.fn().mockResolvedValue(undefined),
  report: vi.fn().mockResolvedValue(undefined),
  is_configured: vi.fn().mockReturnValue(true),
});

const make_mock_logger = (): Logger => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

const make_mock_project_db = (projects: Project[] = []) => ({
  get_all: vi.fn().mockReturnValue(projects),
  get_by_status: vi.fn().mockImplementation((status: string) =>
    projects.filter((p) => p.status === status),
  ),
  get_stats: vi.fn().mockReturnValue({
    total: projects.length,
    by_status: projects.reduce<Record<string, number>>((acc, p) => {
      acc[p.status] = (acc[p.status] ?? 0) + 1;
      return acc;
    }, {}),
    total_revenue: projects.reduce((sum, p) => sum + p.actual_revenue, 0),
  }),
});

// Minimal HunterConfig with only fields reporter needs
const make_config = (reports_dir: string): HunterConfig => ({
  captain_api_url: 'http://localhost:3000',
  poll_interval_ms: 10000,
  log_dir: '/tmp/hunter-test-logs',
  device_name: 'hunter',
  google_profile_dir: './test-profile',
  deep_research_timeout_ms: 300000,
  notebooklm_timeout_ms: 180000,
  chatgpt_timeout_ms: 180000,
  autonomous_db_path: '/tmp/test.db',
  reports_dir,
  scout_interval_ms: 21600000,
  openclaw_command: 'openclaw',
  openclaw_agent: 'main',
  captain_health_check_interval_ms: 30000,
  captain_failure_threshold: 3,
});

describe('create_hunter_reporter', () => {
  let tmp_dir: string;
  let mock_notify: HunterNotify;
  let mock_logger: Logger;

  beforeEach(() => {
    tmp_dir = mkdtempSync(join(tmpdir(), 'hunter-reporter-test-'));
    mock_notify = make_mock_notify();
    mock_logger = make_mock_logger();
  });

  afterEach(() => {
    rmSync(tmp_dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // --- report_project_discovered ---

  describe('report_project_discovered', () => {
    it('should send Telegram message with discovery format', async () => {
      // Given
      const project = make_project();
      const db = make_mock_project_db([project]);
      const reporter = create_hunter_reporter({
        config: make_config(tmp_dir),
        logger: mock_logger,
        notify: mock_notify,
        project_db: db,
      });

      // When
      await reporter.report_project_discovered(project);

      // Then
      expect(mock_notify.send_telegram).toHaveBeenCalledOnce();
      const message = (mock_notify.send_telegram as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(message).toContain('[DISCOVERY]');
      expect(message).toContain('Auto Blog SEO');
      expect(message).toContain('Category: blog_seo_auto_content');
      expect(message).toContain('Expected: ₩500,000/mo');
      expect(message).toContain('Resources: OpenClaw, WordPress API');
      expect(message).toContain('Status: Queued for research');
    });

    it('should log project discovery', async () => {
      // Given
      const project = make_project({ title: 'Micro SaaS Tool' });
      const db = make_mock_project_db([project]);
      const reporter = create_hunter_reporter({
        config: make_config(tmp_dir),
        logger: mock_logger,
        notify: mock_notify,
        project_db: db,
      });

      // When
      await reporter.report_project_discovered(project);

      // Then
      expect(mock_logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Micro SaaS Tool'),
      );
    });
  });

  // --- report_owner_help_needed ---

  describe('report_owner_help_needed', () => {
    it('should send Telegram message with approval needed format', async () => {
      // Given
      const project = make_project({
        title: 'YouTube Shorts Bot',
        status: 'needs_owner',
        owner_action_needed: 'Need Google API key for YouTube Data API v3',
        expected_revenue: '₩1,000,000/mo',
      });
      const db = make_mock_project_db([project]);
      const reporter = create_hunter_reporter({
        config: make_config(tmp_dir),
        logger: mock_logger,
        notify: mock_notify,
        project_db: db,
      });

      // When
      await reporter.report_owner_help_needed(project);

      // Then
      expect(mock_notify.send_telegram).toHaveBeenCalledOnce();
      const message = (mock_notify.send_telegram as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(message).toContain('[APPROVAL_NEEDED]');
      expect(message).toContain('YouTube Shorts Bot');
      expect(message).toContain('Action needed: Need Google API key for YouTube Data API v3');
      expect(message).toContain('Expected: ₩1,000,000/mo');
    });

    it('should handle missing owner_action_needed gracefully', async () => {
      // Given
      const project = make_project({ owner_action_needed: undefined });
      const db = make_mock_project_db([project]);
      const reporter = create_hunter_reporter({
        config: make_config(tmp_dir),
        logger: mock_logger,
        notify: mock_notify,
        project_db: db,
      });

      // When
      await reporter.report_owner_help_needed(project);

      // Then
      const message = (mock_notify.send_telegram as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(message).toContain('Action needed: Unknown');
    });
  });

  // --- report_project_success ---

  describe('report_project_success', () => {
    it('should send Telegram message with revenue info', async () => {
      // Given
      const project = make_project({
        title: 'Print-on-Demand Store',
        status: 'succeeded',
        category: 'print_on_demand',
        actual_revenue: 1500000,
      });
      const db = make_mock_project_db([project]);
      const reporter = create_hunter_reporter({
        config: make_config(tmp_dir),
        logger: mock_logger,
        notify: mock_notify,
        project_db: db,
      });

      // When
      await reporter.report_project_success(project);

      // Then
      expect(mock_notify.send_telegram).toHaveBeenCalledOnce();
      const message = (mock_notify.send_telegram as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(message).toContain('[SUCCESS]');
      expect(message).toContain('Print-on-Demand Store');
      expect(message).toContain('₩1,500,000');
      expect(message).toContain('Category: print_on_demand');
    });
  });

  // --- report_valuable_info ---

  describe('report_valuable_info', () => {
    it('should send Telegram message with info tag', async () => {
      // Given
      const db = make_mock_project_db([]);
      const reporter = create_hunter_reporter({
        config: make_config(tmp_dir),
        logger: mock_logger,
        notify: mock_notify,
        project_db: db,
      });

      // When
      await reporter.report_valuable_info('New trending GitHub repo: ai-money-printer with 5k stars');

      // Then
      expect(mock_notify.send_telegram).toHaveBeenCalledOnce();
      const message = (mock_notify.send_telegram as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(message).toContain('[INFO]');
      expect(message).toContain('New trending GitHub repo: ai-money-printer with 5k stars');
    });
  });

  // --- generate_daily_summary ---

  describe('generate_daily_summary', () => {
    it('should include all project stats in markdown', () => {
      // Given
      const projects = [
        make_project({ id: 'p1', title: 'Blog Bot', status: 'building', actual_revenue: 0 }),
        make_project({ id: 'p2', title: 'POD Store', status: 'succeeded', actual_revenue: 500000 }),
        make_project({ id: 'p3', title: 'SaaS Tool', status: 'discovered', actual_revenue: 0 }),
      ];
      const db = make_mock_project_db(projects);
      const reporter = create_hunter_reporter({
        config: make_config(tmp_dir),
        logger: mock_logger,
        notify: mock_notify,
        project_db: db,
      });

      // When
      const summary = reporter.generate_daily_summary();

      // Then
      expect(summary).toContain('# Hunter Daily Summary');
      expect(summary).toContain('## Project Pipeline');
      expect(summary).toContain('| Status | Count |');
      expect(summary).toContain('building');
      expect(summary).toContain('succeeded');
      expect(summary).toContain('discovered');
      expect(summary).toContain('## Active Projects');
      expect(summary).toContain('Blog Bot');
      expect(summary).toContain('SaaS Tool');
      expect(summary).toContain('## Revenue');
      expect(summary).toContain('₩500,000');
      expect(summary).toContain('## Generated at');
    });

    it('should show (none) when no active projects exist', () => {
      // Given — only terminal-status projects
      const projects = [
        make_project({ id: 'p1', status: 'succeeded', actual_revenue: 100000 }),
        make_project({ id: 'p2', status: 'failed' }),
      ];
      const db = make_mock_project_db(projects);
      const reporter = create_hunter_reporter({
        config: make_config(tmp_dir),
        logger: mock_logger,
        notify: mock_notify,
        project_db: db,
      });

      // When
      const summary = reporter.generate_daily_summary();

      // Then
      expect(summary).toContain('(none)');
    });

    it('should work with empty project list', () => {
      // Given
      const db = make_mock_project_db([]);
      const reporter = create_hunter_reporter({
        config: make_config(tmp_dir),
        logger: mock_logger,
        notify: mock_notify,
        project_db: db,
      });

      // When
      const summary = reporter.generate_daily_summary();

      // Then
      expect(summary).toContain('# Hunter Daily Summary');
      expect(summary).toContain('₩0');
      expect(summary).toContain('(none)');
    });
  });

  // --- save_daily_summary ---

  describe('save_daily_summary', () => {
    it('should create file in daily subdirectory and return path', () => {
      // Given
      const projects = [
        make_project({ id: 'p1', title: 'Test Project', status: 'building' }),
      ];
      const db = make_mock_project_db(projects);
      const reporter = create_hunter_reporter({
        config: make_config(tmp_dir),
        logger: mock_logger,
        notify: mock_notify,
        project_db: db,
      });

      // When
      const saved_path = reporter.save_daily_summary();

      // Then
      expect(saved_path).toContain('daily');
      expect(saved_path).toContain('summary_');
      expect(saved_path).toMatch(/summary_\d{4}-\d{2}-\d{2}\.md$/);
      expect(existsSync(saved_path)).toBe(true);

      const content = readFileSync(saved_path, 'utf-8');
      expect(content).toContain('# Hunter Daily Summary');
      expect(content).toContain('Test Project');
    });

    it('should create nested directories if they do not exist', () => {
      // Given
      const nested_dir = join(tmp_dir, 'deep', 'nested', 'reports');
      const db = make_mock_project_db([]);
      const reporter = create_hunter_reporter({
        config: make_config(nested_dir),
        logger: mock_logger,
        notify: mock_notify,
        project_db: db,
      });

      // When
      const saved_path = reporter.save_daily_summary();

      // Then
      expect(existsSync(saved_path)).toBe(true);
      expect(saved_path).toContain(join('deep', 'nested', 'reports', 'daily'));
    });

    it('should log the saved path', () => {
      // Given
      const db = make_mock_project_db([]);
      const reporter = create_hunter_reporter({
        config: make_config(tmp_dir),
        logger: mock_logger,
        notify: mock_notify,
        project_db: db,
      });

      // When
      reporter.save_daily_summary();

      // Then
      expect(mock_logger.info).toHaveBeenCalledWith(
        expect.stringContaining('daily summary saved'),
      );
    });
  });

  // --- send_daily_telegram_summary ---

  describe('send_daily_telegram_summary', () => {
    it('should send summary via Telegram with all stats', async () => {
      // Given
      const projects = [
        make_project({ id: 'p1', title: 'Active Project', status: 'building', actual_revenue: 0 }),
        make_project({ id: 'p2', title: 'Done Project', status: 'succeeded', actual_revenue: 250000 }),
      ];
      const db = make_mock_project_db(projects);
      const reporter = create_hunter_reporter({
        config: make_config(tmp_dir),
        logger: mock_logger,
        notify: mock_notify,
        project_db: db,
      });

      // When
      await reporter.send_daily_telegram_summary();

      // Then
      expect(mock_notify.send_telegram).toHaveBeenCalledOnce();
      const message = (mock_notify.send_telegram as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(message).toContain('[DAILY SUMMARY]');
      expect(message).toContain('Projects:');
      expect(message).toContain('Total Revenue:');
      expect(message).toContain('Active:');
      expect(message).toContain('Active Project');
    });

    it('should query each active status from project_db', async () => {
      // Given
      const db = make_mock_project_db([]);
      const reporter = create_hunter_reporter({
        config: make_config(tmp_dir),
        logger: mock_logger,
        notify: mock_notify,
        project_db: db,
      });

      // When
      await reporter.send_daily_telegram_summary();

      // Then — should query all 7 active statuses
      const expected_statuses = [
        'discovered', 'researching', 'planned', 'building', 'testing', 'deployed', 'monitoring',
      ];
      for (const status of expected_statuses) {
        expect(db.get_by_status).toHaveBeenCalledWith(status);
      }
    });
  });

  // --- Graceful degradation without notify ---

  describe('handles missing notify gracefully', () => {
    it('should not crash when notify is undefined for report_project_discovered', async () => {
      // Given
      const project = make_project();
      const db = make_mock_project_db([project]);
      const reporter = create_hunter_reporter({
        config: make_config(tmp_dir),
        logger: mock_logger,
        notify: undefined,
        project_db: db,
      });

      // When / Then — should not throw
      await expect(reporter.report_project_discovered(project)).resolves.toBeUndefined();
      expect(mock_logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('notify not configured'),
      );
    });

    it('should not crash when notify is undefined for report_owner_help_needed', async () => {
      // Given
      const project = make_project({ owner_action_needed: 'Need API key' });
      const db = make_mock_project_db([project]);
      const reporter = create_hunter_reporter({
        config: make_config(tmp_dir),
        logger: mock_logger,
        notify: undefined,
        project_db: db,
      });

      // When / Then
      await expect(reporter.report_owner_help_needed(project)).resolves.toBeUndefined();
    });

    it('should not crash when notify is undefined for report_project_success', async () => {
      // Given
      const project = make_project({ status: 'succeeded', actual_revenue: 100000 });
      const db = make_mock_project_db([project]);
      const reporter = create_hunter_reporter({
        config: make_config(tmp_dir),
        logger: mock_logger,
        notify: undefined,
        project_db: db,
      });

      // When / Then
      await expect(reporter.report_project_success(project)).resolves.toBeUndefined();
    });

    it('should not crash when notify is undefined for report_valuable_info', async () => {
      // Given
      const db = make_mock_project_db([]);
      const reporter = create_hunter_reporter({
        config: make_config(tmp_dir),
        logger: mock_logger,
        notify: undefined,
        project_db: db,
      });

      // When / Then
      await expect(reporter.report_valuable_info('Some info')).resolves.toBeUndefined();
    });

    it('should not crash when notify is undefined for send_daily_telegram_summary', async () => {
      // Given
      const db = make_mock_project_db([]);
      const reporter = create_hunter_reporter({
        config: make_config(tmp_dir),
        logger: mock_logger,
        notify: undefined,
        project_db: db,
      });

      // When / Then
      await expect(reporter.send_daily_telegram_summary()).resolves.toBeUndefined();
    });

    it('should still generate file reports without notify', () => {
      // Given
      const projects = [make_project({ title: 'Offline Project', status: 'building' })];
      const db = make_mock_project_db(projects);
      const reporter = create_hunter_reporter({
        config: make_config(tmp_dir),
        logger: mock_logger,
        notify: undefined,
        project_db: db,
      });

      // When
      const summary = reporter.generate_daily_summary();
      const path = reporter.save_daily_summary();

      // Then — file operations work independently of Telegram
      expect(summary).toContain('Offline Project');
      expect(existsSync(path)).toBe(true);
    });
  });

  // --- Error resilience ---

  describe('error resilience', () => {
    it('should not throw when send_telegram rejects', async () => {
      // Given
      const failing_notify = make_mock_notify();
      (failing_notify.send_telegram as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Telegram API down'),
      );
      const project = make_project();
      const db = make_mock_project_db([project]);
      const reporter = create_hunter_reporter({
        config: make_config(tmp_dir),
        logger: mock_logger,
        notify: failing_notify,
        project_db: db,
      });

      // When / Then — fire-and-forget, never crashes
      await expect(reporter.report_project_discovered(project)).resolves.toBeUndefined();
      expect(mock_logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Telegram send failed'),
      );
    });
  });
});
