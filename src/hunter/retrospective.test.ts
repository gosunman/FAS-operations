// Tests for Hunter retrospective engine
// Mocks OpenClaw spawn and project DB to verify report generation

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { create_retrospective_engine, type RetrospectiveEngine } from './retrospective.js';
import type { Logger } from './logger.js';
import type { HunterConfig } from './config.js';
import type { Project } from '../shared/types.js';

// === Mock child_process.spawn ===
// We mock at the module level so exec_openclaw uses our fake process

type MockProc = {
  stdout: { on: ReturnType<typeof vi.fn> };
  stderr: { on: ReturnType<typeof vi.fn> };
  on: ReturnType<typeof vi.fn>;
};

let mock_spawn: ReturnType<typeof vi.fn>;
let captured_proc: MockProc;

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mock_spawn(...args),
}));

// Helper: create a mock process that resolves with given output
const create_mock_proc = (
  exit_code: number,
  stdout_data: string,
  stderr_data: string = '',
): MockProc => {
  const proc: MockProc = {
    stdout: {
      on: vi.fn((event: string, cb: (chunk: Buffer) => void) => {
        if (event === 'data') {
          // Emit stdout data asynchronously
          setTimeout(() => cb(Buffer.from(stdout_data)), 0);
        }
      }),
    },
    stderr: {
      on: vi.fn((event: string, cb: (chunk: Buffer) => void) => {
        if (event === 'data' && stderr_data) {
          setTimeout(() => cb(Buffer.from(stderr_data)), 0);
        }
      }),
    },
    on: vi.fn((event: string, cb: (code: number | null) => void) => {
      if (event === 'close') {
        // Emit close after stdout/stderr data
        setTimeout(() => cb(exit_code), 10);
      }
    }),
  };
  return proc;
};

// Helper: create a mock process that emits an error
const create_error_proc = (error_message: string): MockProc => {
  const proc: MockProc = {
    stdout: {
      on: vi.fn(),
    },
    stderr: {
      on: vi.fn(),
    },
    on: vi.fn((event: string, cb: (arg: unknown) => void) => {
      if (event === 'error') {
        setTimeout(() => cb(new Error(error_message)), 0);
      }
    }),
  };
  return proc;
};

// === Test fixtures ===

const mock_logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const make_project = (overrides: Partial<Project> = {}): Project => ({
  id: 'proj_001',
  title: 'YouTube Shorts Bot',
  category: 'youtube_shorts_automation',
  status: 'building',
  expected_revenue: '$500/month',
  actual_revenue: 0,
  resources_needed: ['OpenAI API key', 'YouTube API key'],
  openclaw_sessions: ['session_1'],
  created_at: '2026-03-20T00:00:00Z',
  updated_at: '2026-03-22T00:00:00Z',
  ...overrides,
});

const make_failed_project = (overrides: Partial<Project> = {}): Project =>
  make_project({
    id: 'proj_fail_001',
    title: 'Failed Blog Generator',
    category: 'blog_seo_auto_content',
    status: 'failed',
    retrospective: 'API rate limit exceeded repeatedly',
    ...overrides,
  });

let temp_dir: string;
let config: HunterConfig;
let mock_project_db: {
  get_all: ReturnType<typeof vi.fn>;
  get_by_status: ReturnType<typeof vi.fn>;
};
let engine: RetrospectiveEngine;

// === Setup and teardown ===

beforeEach(() => {
  vi.clearAllMocks();

  // Create a fresh temp directory for each test
  temp_dir = mkdtempSync(join(tmpdir(), 'hunter-retro-'));

  config = {
    captain_api_url: 'http://localhost:3000',
    poll_interval_ms: 10000,
    log_dir: './logs',
    device_name: 'hunter',
    google_profile_dir: './fas-google-profile-hunter',
    deep_research_timeout_ms: 300000,
    notebooklm_timeout_ms: 180000,
    chatgpt_timeout_ms: 180000,
    autonomous_db_path: ':memory:',
    reports_dir: temp_dir,
    scout_interval_ms: 21600000,
    openclaw_command: 'openclaw',
    openclaw_agent: 'main',
    captain_health_check_interval_ms: 30000,
    captain_failure_threshold: 3,
  };

  mock_project_db = {
    get_all: vi.fn().mockReturnValue([make_project()]),
    get_by_status: vi.fn().mockReturnValue([make_failed_project()]),
  };

  // Default: OpenClaw returns success
  captured_proc = create_mock_proc(0, 'OpenClaw daily analysis complete. Insights saved.');
  mock_spawn = vi.fn().mockReturnValue(captured_proc);

  engine = create_retrospective_engine({
    config,
    logger: mock_logger,
    project_db: mock_project_db,
  });
});

afterEach(() => {
  // Clean up temp directories
  try {
    rmSync(temp_dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors on CI
  }
});

// === Tests ===

describe('run_daily', () => {
  it('should create daily report file in correct path', async () => {
    // Given — engine with mocked OpenClaw returning success
    // (default setup)

    // When
    const result = await engine.run_daily();

    // Then
    expect(result.type).toBe('daily');
    expect(result.success).toBe(true);
    expect(result.report_path).toMatch(/daily\/daily_\d{4}-\d{2}-\d{2}\.md$/);
    expect(existsSync(result.report_path)).toBe(true);
  });

  it('should include project data in report content', async () => {
    // Given
    const active_project = make_project({ title: 'My Active Project' });
    mock_project_db.get_all.mockReturnValue([active_project]);

    // When
    const result = await engine.run_daily();

    // Then
    const content = readFileSync(result.report_path, 'utf-8');
    expect(content).toContain('# Daily Report');
    expect(content).toContain('## Project Summary');
    expect(content).toContain('My Active Project');
    expect(content).toContain('youtube_shorts_automation');
  });

  it('should pass correct prompt to OpenClaw with active and failed projects', async () => {
    // Given
    const active = make_project({ title: 'Active Bot' });
    const failed = make_failed_project({ title: 'Dead Project' });
    mock_project_db.get_all.mockReturnValue([active, failed]);
    mock_project_db.get_by_status.mockReturnValue([failed]);

    // When
    await engine.run_daily();

    // Then — verify spawn was called with prompt containing project data
    expect(mock_spawn).toHaveBeenCalledOnce();
    const call_args = mock_spawn.mock.calls[0] as unknown[];
    const cli_args = call_args[1] as string[];
    // The prompt is passed via '-m' flag
    const prompt_index = cli_args.indexOf('-m');
    const prompt = cli_args[prompt_index + 1];
    expect(prompt).toContain('Active Bot');
    expect(prompt).toContain('Dead Project');
    expect(prompt).toContain('What did you try today?');
    expect(prompt).toContain('top 3 priorities for tomorrow');
  });

  it('should create subdirectories automatically', async () => {
    // Given — reports_dir/daily does not exist yet
    const nested_dir = join(temp_dir, 'nested', 'deep');
    config.reports_dir = nested_dir;
    engine = create_retrospective_engine({
      config,
      logger: mock_logger,
      project_db: mock_project_db,
    });

    // When
    const result = await engine.run_daily();

    // Then
    expect(result.success).toBe(true);
    expect(existsSync(result.report_path)).toBe(true);
    // The directory should have been created
    expect(existsSync(join(nested_dir, 'daily'))).toBe(true);
  });

  it('should handle OpenClaw failure gracefully', async () => {
    // Given — OpenClaw exits with non-zero code
    captured_proc = create_mock_proc(1, 'partial output', 'Connection refused');
    mock_spawn.mockReturnValue(captured_proc);

    // When
    const result = await engine.run_daily();

    // Then
    expect(result.success).toBe(false);
    expect(result.openclaw_output).toContain('OpenClaw failed');
    // Should still save a failure report
    expect(existsSync(result.report_path)).toBe(true);
    const content = readFileSync(result.report_path, 'utf-8');
    expect(content).toContain('OpenClaw failed');
  });

  it('should handle OpenClaw ENOENT error (not installed)', async () => {
    // Given — OpenClaw binary not found
    captured_proc = create_error_proc('spawn openclaw ENOENT');
    mock_spawn.mockReturnValue(captured_proc);

    // When
    const result = await engine.run_daily();

    // Then
    expect(result.success).toBe(false);
    expect(result.openclaw_output).toContain('OpenClaw not installed');
  });

  it('should use config openclaw_command and openclaw_agent', async () => {
    // Given
    config.openclaw_command = '/usr/local/bin/custom-openclaw';
    config.openclaw_agent = 'hunter-agent';
    engine = create_retrospective_engine({
      config,
      logger: mock_logger,
      project_db: mock_project_db,
    });

    // When
    await engine.run_daily();

    // Then
    expect(mock_spawn).toHaveBeenCalledWith(
      '/usr/local/bin/custom-openclaw',
      expect.arrayContaining(['--agent', 'hunter-agent']),
      expect.any(Object),
    );
  });

  it('should include openclaw output in the report file', async () => {
    // Given
    const openclaw_response = 'Today I worked on the YouTube Shorts bot. Key insight: shorts under 30s perform best.';
    captured_proc = create_mock_proc(0, openclaw_response);
    mock_spawn.mockReturnValue(captured_proc);

    // When
    const result = await engine.run_daily();

    // Then
    expect(result.openclaw_output).toBe(openclaw_response);
    const content = readFileSync(result.report_path, 'utf-8');
    expect(content).toContain(openclaw_response);
  });
});

describe('run_weekly', () => {
  it('should create weekly report file in correct path', async () => {
    // Given — default mocks

    // When
    const result = await engine.run_weekly();

    // Then
    expect(result.type).toBe('weekly');
    expect(result.success).toBe(true);
    expect(result.report_path).toMatch(/weekly\/weekly_\d{4}-\d{2}-\d{2}\.md$/);
    expect(existsSync(result.report_path)).toBe(true);
  });

  it('should include all projects in weekly prompt', async () => {
    // Given
    const projects = [
      make_project({ id: 'p1', title: 'Bot A', status: 'building' }),
      make_project({ id: 'p2', title: 'SaaS B', status: 'succeeded' }),
      make_failed_project({ id: 'p3', title: 'Failed C' }),
    ];
    mock_project_db.get_all.mockReturnValue(projects);

    // When
    await engine.run_weekly();

    // Then
    const call_args = mock_spawn.mock.calls[0] as unknown[];
    const cli_args = call_args[1] as string[];
    const prompt_index = cli_args.indexOf('-m');
    const prompt = cli_args[prompt_index + 1];
    expect(prompt).toContain('Bot A');
    expect(prompt).toContain('SaaS B');
    expect(prompt).toContain('Failed C');
    expect(prompt).toContain('Success rate');
    expect(prompt).toContain('strategic pivots');
  });

  it('should create weekly report with project summary table', async () => {
    // Given
    const projects = [
      make_project({ title: 'Alpha Project', category: 'micro_saas', expected_revenue: '$1000' }),
    ];
    mock_project_db.get_all.mockReturnValue(projects);

    // When
    const result = await engine.run_weekly();

    // Then
    const content = readFileSync(result.report_path, 'utf-8');
    expect(content).toContain('# Weekly Report');
    expect(content).toContain('## Project Summary');
    expect(content).toContain('Alpha Project');
    expect(content).toContain('micro_saas');
    expect(content).toContain('$1000');
  });

  it('should handle OpenClaw failure gracefully for weekly', async () => {
    // Given
    captured_proc = create_mock_proc(1, '', 'timeout');
    mock_spawn.mockReturnValue(captured_proc);

    // When
    const result = await engine.run_weekly();

    // Then
    expect(result.success).toBe(false);
    expect(result.type).toBe('weekly');
    expect(existsSync(result.report_path)).toBe(true);
  });
});

describe('run_failure_analysis', () => {
  it('should create failure report file with project id in name', async () => {
    // Given
    const failed = make_failed_project({ id: 'proj-abc-123' });

    // When
    const result = await engine.run_failure_analysis(failed);

    // Then
    expect(result.type).toBe('failure');
    expect(result.success).toBe(true);
    expect(result.report_path).toMatch(/failures\/failure_proj-abc-123_\d{4}-\d{2}-\d{2}\.md$/);
    expect(existsSync(result.report_path)).toBe(true);
  });

  it('should include project details in failure prompt', async () => {
    // Given
    const failed = make_failed_project({
      title: 'Blog Auto Generator',
      category: 'blog_seo_auto_content',
      expected_revenue: '$200/month',
      resources_needed: ['WordPress API', 'GPT-4 API'],
      retrospective: 'Rate limit hit after 50 posts',
    });

    // When
    await engine.run_failure_analysis(failed);

    // Then
    const call_args = mock_spawn.mock.calls[0] as unknown[];
    const cli_args = call_args[1] as string[];
    const prompt_index = cli_args.indexOf('-m');
    const prompt = cli_args[prompt_index + 1];
    expect(prompt).toContain('Blog Auto Generator');
    expect(prompt).toContain('blog_seo_auto_content');
    expect(prompt).toContain('$200/month');
    expect(prompt).toContain('WordPress API');
    expect(prompt).toContain('Rate limit hit after 50 posts');
    expect(prompt).toContain('root cause of failure');
    expect(prompt).toContain('lessons should be carried forward');
  });

  it('should include only the failed project in summary table', async () => {
    // Given
    const failed = make_failed_project({ title: 'Dead Project X' });

    // When
    const result = await engine.run_failure_analysis(failed);

    // Then
    const content = readFileSync(result.report_path, 'utf-8');
    expect(content).toContain('# Failure Report');
    expect(content).toContain('Dead Project X');
    expect(content).toContain('failed');
  });

  it('should handle project with no retrospective notes', async () => {
    // Given
    const failed = make_failed_project({ retrospective: undefined });

    // When
    await engine.run_failure_analysis(failed);

    // Then
    const call_args = mock_spawn.mock.calls[0] as unknown[];
    const cli_args = call_args[1] as string[];
    const prompt_index = cli_args.indexOf('-m');
    const prompt = cli_args[prompt_index + 1];
    // Should show 'None' when retrospective is undefined
    expect(prompt).toContain('Retrospective notes: None');
  });

  it('should handle OpenClaw failure gracefully for failure analysis', async () => {
    // Given
    captured_proc = create_mock_proc(1, 'partial', 'crash');
    mock_spawn.mockReturnValue(captured_proc);
    const failed = make_failed_project();

    // When
    const result = await engine.run_failure_analysis(failed);

    // Then
    expect(result.success).toBe(false);
    expect(result.type).toBe('failure');
    // Should still write a report file
    expect(existsSync(result.report_path)).toBe(true);
  });
});

describe('report content format', () => {
  it('should format report with header, openclaw output, and project summary', async () => {
    // Given
    const openclaw_text = 'Detailed analysis of project performance...';
    captured_proc = create_mock_proc(0, openclaw_text);
    mock_spawn.mockReturnValue(captured_proc);
    mock_project_db.get_all.mockReturnValue([
      make_project({ title: 'Bot Alpha' }),
    ]);

    // When
    const result = await engine.run_daily();

    // Then
    const content = readFileSync(result.report_path, 'utf-8');
    // Header
    expect(content).toMatch(/^# Daily Report - \d{4}-\d{2}-\d{2}\n/);
    // OpenClaw output
    expect(content).toContain(openclaw_text);
    // Project summary section
    expect(content).toContain('## Project Summary');
    // Table headers
    expect(content).toContain('| Title | Category | Status | Expected Revenue |');
    expect(content).toContain('| Bot Alpha |');
  });

  it('should handle empty project list gracefully', async () => {
    // Given
    mock_project_db.get_all.mockReturnValue([]);
    mock_project_db.get_by_status.mockReturnValue([]);

    // When
    const result = await engine.run_daily();

    // Then
    const content = readFileSync(result.report_path, 'utf-8');
    expect(content).toContain('_No projects to summarize._');
  });
});

describe('logging', () => {
  it('should log start and completion for daily', async () => {
    // Given — default setup

    // When
    await engine.run_daily();

    // Then
    expect(mock_logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Starting daily retrospective'),
    );
    expect(mock_logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Daily report saved'),
    );
  });

  it('should log errors when OpenClaw fails', async () => {
    // Given
    captured_proc = create_mock_proc(1, '', 'segfault');
    mock_spawn.mockReturnValue(captured_proc);

    // When
    await engine.run_daily();

    // Then
    expect(mock_logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Daily OpenClaw failed'),
    );
  });
});
