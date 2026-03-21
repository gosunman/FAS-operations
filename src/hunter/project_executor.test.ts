// Tests for project executor — Hunter autonomous mode stage advancement
// Uses Given-When-Then pattern with vi.fn() mocks

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Project, ProjectStatus } from '../shared/types.js';
import type { Logger } from './logger.js';
import type { HunterConfig } from './config.js';
import {
  create_project_executor,
  build_prompt,
  STAGE_MAP,
  HUNTER_BRAIN_INSTRUCTION,
} from './project_executor.js';
import type { ProjectDBLike, ExecOpenClawFn, OpenClawResult } from './project_executor.js';

// Mock crypto.randomUUID for deterministic session IDs
vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'test-uuid-1234'),
}));

// === Test helpers ===

const mock_logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const make_config = (overrides: Partial<HunterConfig> = {}): HunterConfig => ({
  captain_api_url: 'http://localhost:3000',
  poll_interval_ms: 10_000,
  log_dir: './logs',
  device_name: 'hunter',
  google_profile_dir: './fas-google-profile-hunter',
  deep_research_timeout_ms: 300_000,
  notebooklm_timeout_ms: 180_000,
  chatgpt_timeout_ms: 180_000,
  autonomous_db_path: './data/hunter_projects.db',
  reports_dir: './reports',
  scout_interval_ms: 21_600_000,
  openclaw_command: 'openclaw',
  openclaw_agent: 'main',
  captain_health_check_interval_ms: 30_000,
  captain_failure_threshold: 3,
  ...overrides,
});

const make_project = (overrides: Partial<Project> = {}): Project => ({
  id: 'proj_001',
  title: 'YouTube Shorts Automation',
  category: 'youtube_shorts_automation',
  status: 'discovered',
  expected_revenue: '$500/mo',
  actual_revenue: 0,
  resources_needed: ['OpenClaw', 'YouTube API'],
  openclaw_sessions: [],
  created_at: '2026-03-20T00:00:00Z',
  updated_at: '2026-03-20T00:00:00Z',
  ...overrides,
});

const make_mock_db = (project?: Project): ProjectDBLike => ({
  get_most_promising: vi.fn(() => project),
  update_status: vi.fn(() => true),
  set_retrospective: vi.fn(() => true),
  add_openclaw_session: vi.fn(() => true),
});

// Helper: create a mock exec_openclaw that resolves with success
const make_success_openclaw = (output = '{"result": "success"}'): ExecOpenClawFn =>
  vi.fn(async () => ({ success: true, output, error: undefined }));

// Helper: create a mock exec_openclaw that resolves with failure
const make_failure_openclaw = (error: string, output = ''): ExecOpenClawFn =>
  vi.fn(async () => ({ success: false, output, error }));

// === Tests ===

describe('project_executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // === Stage advancement tests ===

  describe('stage advancement', () => {
    it('should advance a discovered project to researching on success', async () => {
      // Given — a discovered project is the most promising
      const project = make_project({ status: 'discovered' });
      const db = make_mock_db(project);
      const executor = create_project_executor({
        config: make_config(),
        logger: mock_logger,
        project_db: db,
        exec_openclaw_fn: make_success_openclaw(),
      });

      // When
      const result = await executor.execute_next();

      // Then — project advanced to researching
      expect(result).not.toBeNull();
      expect(result!.project_id).toBe('proj_001');
      expect(result!.previous_status).toBe('discovered');
      expect(result!.new_status).toBe('researching');
      expect(result!.success).toBe(true);
      expect(db.update_status).toHaveBeenCalledWith('proj_001', 'researching');
    });

    it('should advance a researching project to planned on success', async () => {
      // Given
      const project = make_project({ status: 'researching' });
      const db = make_mock_db(project);
      const executor = create_project_executor({
        config: make_config(),
        logger: mock_logger,
        project_db: db,
        exec_openclaw_fn: make_success_openclaw(),
      });

      // When
      const result = await executor.execute_next();

      // Then
      expect(result).not.toBeNull();
      expect(result!.previous_status).toBe('researching');
      expect(result!.new_status).toBe('planned');
      expect(result!.success).toBe(true);
      expect(db.update_status).toHaveBeenCalledWith('proj_001', 'planned');
    });

    it('should advance a planned project to building on success', async () => {
      // Given
      const project = make_project({ status: 'planned' });
      const db = make_mock_db(project);
      const executor = create_project_executor({
        config: make_config(),
        logger: mock_logger,
        project_db: db,
        exec_openclaw_fn: make_success_openclaw(),
      });

      // When
      const result = await executor.execute_next();

      // Then
      expect(result).not.toBeNull();
      expect(result!.previous_status).toBe('planned');
      expect(result!.new_status).toBe('building');
      expect(result!.success).toBe(true);
      expect(db.update_status).toHaveBeenCalledWith('proj_001', 'building');
    });

    it('should advance a building project to testing on success', async () => {
      // Given
      const project = make_project({ status: 'building' });
      const db = make_mock_db(project);
      const executor = create_project_executor({
        config: make_config(),
        logger: mock_logger,
        project_db: db,
        exec_openclaw_fn: make_success_openclaw(),
      });

      // When
      const result = await executor.execute_next();

      // Then
      expect(result).not.toBeNull();
      expect(result!.previous_status).toBe('building');
      expect(result!.new_status).toBe('testing');
      expect(result!.success).toBe(true);
      expect(db.update_status).toHaveBeenCalledWith('proj_001', 'testing');
    });

    it('should advance a testing project to deployed on success', async () => {
      // Given
      const project = make_project({ status: 'testing' });
      const db = make_mock_db(project);
      const executor = create_project_executor({
        config: make_config(),
        logger: mock_logger,
        project_db: db,
        exec_openclaw_fn: make_success_openclaw(),
      });

      // When
      const result = await executor.execute_next();

      // Then
      expect(result).not.toBeNull();
      expect(result!.previous_status).toBe('testing');
      expect(result!.new_status).toBe('deployed');
      expect(result!.success).toBe(true);
      expect(db.update_status).toHaveBeenCalledWith('proj_001', 'deployed');
    });
  });

  // === No project / terminal state tests ===

  describe('no actionable projects', () => {
    it('should return null when no projects are available', async () => {
      // Given — DB returns no projects
      const db = make_mock_db(undefined);
      const executor = create_project_executor({
        config: make_config(),
        logger: mock_logger,
        project_db: db,
        exec_openclaw_fn: make_success_openclaw(),
      });

      // When
      const result = await executor.execute_next();

      // Then
      expect(result).toBeNull();
      expect(db.update_status).not.toHaveBeenCalled();
    });

    it('should return null for projects in terminal state "succeeded"', async () => {
      // Given — project already succeeded (not in STAGE_MAP)
      const project = make_project({ status: 'succeeded' });
      const db = make_mock_db(project);
      const openclaw_fn = make_success_openclaw();
      const executor = create_project_executor({
        config: make_config(),
        logger: mock_logger,
        project_db: db,
        exec_openclaw_fn: openclaw_fn,
      });

      // When
      const result = await executor.execute_next();

      // Then — no action taken, OpenClaw never called
      expect(result).toBeNull();
      expect(db.update_status).not.toHaveBeenCalled();
      expect(openclaw_fn).not.toHaveBeenCalled();
    });

    it('should return null for projects in terminal state "failed"', async () => {
      // Given — project already failed
      const project = make_project({ status: 'failed' });
      const db = make_mock_db(project);
      const openclaw_fn = make_success_openclaw();
      const executor = create_project_executor({
        config: make_config(),
        logger: mock_logger,
        project_db: db,
        exec_openclaw_fn: openclaw_fn,
      });

      // When
      const result = await executor.execute_next();

      // Then
      expect(result).toBeNull();
      expect(db.update_status).not.toHaveBeenCalled();
      expect(openclaw_fn).not.toHaveBeenCalled();
    });

    it('should return null for projects in terminal state "needs_owner"', async () => {
      // Given — project needs owner intervention
      const project = make_project({ status: 'needs_owner' });
      const db = make_mock_db(project);
      const openclaw_fn = make_success_openclaw();
      const executor = create_project_executor({
        config: make_config(),
        logger: mock_logger,
        project_db: db,
        exec_openclaw_fn: openclaw_fn,
      });

      // When
      const result = await executor.execute_next();

      // Then
      expect(result).toBeNull();
      expect(db.update_status).not.toHaveBeenCalled();
      expect(openclaw_fn).not.toHaveBeenCalled();
    });

    it('should return null for projects in "deployed" state', async () => {
      // Given — deployed projects are not in the stage map
      const project = make_project({ status: 'deployed' });
      const db = make_mock_db(project);
      const executor = create_project_executor({
        config: make_config(),
        logger: mock_logger,
        project_db: db,
        exec_openclaw_fn: make_success_openclaw(),
      });

      // When
      const result = await executor.execute_next();

      // Then
      expect(result).toBeNull();
    });

    it('should return null for projects in "monitoring" state', async () => {
      // Given
      const project = make_project({ status: 'monitoring' });
      const db = make_mock_db(project);
      const executor = create_project_executor({
        config: make_config(),
        logger: mock_logger,
        project_db: db,
        exec_openclaw_fn: make_success_openclaw(),
      });

      // When
      const result = await executor.execute_next();

      // Then
      expect(result).toBeNull();
    });
  });

  // === Failure handling tests ===

  describe('failure handling', () => {
    it('should mark project as failed with retrospective on OpenClaw failure', async () => {
      // Given — OpenClaw exits with error
      const project = make_project({ status: 'planned' });
      const db = make_mock_db(project);
      const executor = create_project_executor({
        config: make_config(),
        logger: mock_logger,
        project_db: db,
        exec_openclaw_fn: make_failure_openclaw('OpenClaw runtime error: model overloaded'),
      });

      // When
      const result = await executor.execute_next();

      // Then — project marked as failed with retrospective
      expect(result).not.toBeNull();
      expect(result!.success).toBe(false);
      expect(result!.new_status).toBe('failed');
      expect(result!.previous_status).toBe('planned');
      expect(db.update_status).toHaveBeenCalledWith('proj_001', 'failed');
      expect(db.set_retrospective).toHaveBeenCalledWith(
        'proj_001',
        expect.stringContaining('Failed during stage'),
      );
      expect(db.set_retrospective).toHaveBeenCalledWith(
        'proj_001',
        expect.stringContaining('OpenClaw runtime error'),
      );
    });

    it('should include error details in retrospective on process error', async () => {
      // Given — OpenClaw binary not found (ENOENT-like error)
      const project = make_project({ status: 'discovered' });
      const db = make_mock_db(project);
      const executor = create_project_executor({
        config: make_config(),
        logger: mock_logger,
        project_db: db,
        exec_openclaw_fn: make_failure_openclaw('spawn openclaw ENOENT'),
      });

      // When
      const result = await executor.execute_next();

      // Then
      expect(result).not.toBeNull();
      expect(result!.success).toBe(false);
      expect(result!.new_status).toBe('failed');
      expect(db.update_status).toHaveBeenCalledWith('proj_001', 'failed');
      expect(db.set_retrospective).toHaveBeenCalledWith(
        'proj_001',
        expect.stringContaining('ENOENT'),
      );
    });

    it('should NOT add openclaw session on failure', async () => {
      // Given — OpenClaw fails
      const project = make_project({ status: 'building' });
      const db = make_mock_db(project);
      const executor = create_project_executor({
        config: make_config(),
        logger: mock_logger,
        project_db: db,
        exec_openclaw_fn: make_failure_openclaw('timeout'),
      });

      // When
      await executor.execute_next();

      // Then — no session added
      expect(db.add_openclaw_session).not.toHaveBeenCalled();
    });

    it('should log error on failure', async () => {
      // Given
      const project = make_project({ status: 'discovered' });
      const db = make_mock_db(project);
      const executor = create_project_executor({
        config: make_config(),
        logger: mock_logger,
        project_db: db,
        exec_openclaw_fn: make_failure_openclaw('model overloaded'),
      });

      // When
      await executor.execute_next();

      // Then
      expect(mock_logger.error).toHaveBeenCalledWith(
        expect.stringContaining('model overloaded'),
      );
    });
  });

  // === Session tracking tests ===

  describe('openclaw session tracking', () => {
    it('should add openclaw session ID on success', async () => {
      // Given — successful execution
      const project = make_project({ status: 'discovered' });
      const db = make_mock_db(project);
      const executor = create_project_executor({
        config: make_config(),
        logger: mock_logger,
        project_db: db,
        exec_openclaw_fn: make_success_openclaw('research output'),
      });

      // When
      await executor.execute_next();

      // Then — session ID added via mocked randomUUID
      expect(db.add_openclaw_session).toHaveBeenCalledWith('proj_001', 'test-uuid-1234');
    });
  });

  // === Output and prompt tests ===

  describe('openclaw output and prompt', () => {
    it('should include openclaw output in the result', async () => {
      // Given
      const project = make_project({ status: 'discovered' });
      const db = make_mock_db(project);
      const executor = create_project_executor({
        config: make_config(),
        logger: mock_logger,
        project_db: db,
        exec_openclaw_fn: make_success_openclaw('detailed research findings'),
      });

      // When
      const result = await executor.execute_next();

      // Then
      expect(result).not.toBeNull();
      expect(result!.openclaw_output).toBe('detailed research findings');
    });

    it('should pass correct openclaw command, agent, and timeout from config', async () => {
      // Given — custom openclaw config
      const openclaw_fn = make_success_openclaw('ok');
      const project = make_project({ status: 'discovered' });
      const db = make_mock_db(project);
      const executor = create_project_executor({
        config: make_config({
          openclaw_command: '/usr/local/bin/openclaw',
          openclaw_agent: 'researcher',
        }),
        logger: mock_logger,
        project_db: db,
        exec_openclaw_fn: openclaw_fn,
      });

      // When
      await executor.execute_next();

      // Then — called with correct command, agent, and timeout (30 min for discovered)
      expect(openclaw_fn).toHaveBeenCalledWith(
        '/usr/local/bin/openclaw',
        'researcher',
        expect.any(String),
        1_800_000, // discovered stage timeout = 30 min
      );
    });

    it('should use the correct timeout for planned → building stage (60 min)', async () => {
      // Given — a planned project (building stage has 60 min timeout)
      const openclaw_fn = make_success_openclaw('built');
      const project = make_project({ status: 'planned' });
      const db = make_mock_db(project);
      const executor = create_project_executor({
        config: make_config(),
        logger: mock_logger,
        project_db: db,
        exec_openclaw_fn: openclaw_fn,
      });

      // When
      await executor.execute_next();

      // Then — timeout should be 60 min (3_600_000 ms)
      expect(openclaw_fn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        3_600_000,
      );
    });

    it('should include project details and brain instruction in prompt', async () => {
      // Given
      const openclaw_fn = make_success_openclaw('ok');
      const project = make_project({
        status: 'discovered',
        title: 'Blog SEO Tool',
        category: 'micro_saas',
        expected_revenue: '$1000/mo',
        resources_needed: ['GPT-4', 'Vercel'],
      });
      const db = make_mock_db(project);
      const executor = create_project_executor({
        config: make_config(),
        logger: mock_logger,
        project_db: db,
        exec_openclaw_fn: openclaw_fn,
      });

      // When
      await executor.execute_next();

      // Then — prompt should contain project details and brain instruction
      const prompt_arg = (openclaw_fn as ReturnType<typeof vi.fn>).mock.calls[0][2];
      expect(prompt_arg).toContain('Blog SEO Tool');
      expect(prompt_arg).toContain('micro_saas');
      expect(prompt_arg).toContain('$1000/mo');
      expect(prompt_arg).toContain('GPT-4, Vercel');
      expect(prompt_arg).toContain('Hunter');
      expect(prompt_arg).toContain('자율 에이전트');
    });
  });

  // === build_prompt unit tests ===

  describe('build_prompt', () => {
    it('should include stage prompt prefix', () => {
      // Given
      const project = make_project({ status: 'discovered' });
      const stage = STAGE_MAP['discovered'];

      // When
      const prompt = build_prompt(project, stage);

      // Then
      expect(prompt).toContain(stage.prompt_prefix);
    });

    it('should include project title, category, revenue, and resources', () => {
      // Given
      const project = make_project({
        title: 'AI Newsletter',
        category: 'info_brokerage',
        expected_revenue: '$200/mo',
        resources_needed: ['OpenAI API', 'Mailgun'],
      });
      const stage = STAGE_MAP['discovered'];

      // When
      const prompt = build_prompt(project, stage);

      // Then
      expect(prompt).toContain('AI Newsletter');
      expect(prompt).toContain('info_brokerage');
      expect(prompt).toContain('$200/mo');
      expect(prompt).toContain('OpenAI API, Mailgun');
    });

    it('should include the Hunter brain instruction', () => {
      // Given
      const project = make_project();
      const stage = STAGE_MAP['discovered'];

      // When
      const prompt = build_prompt(project, stage);

      // Then
      expect(prompt).toContain(HUNTER_BRAIN_INSTRUCTION);
    });

    it('should show "none" when resources_needed is empty', () => {
      // Given
      const project = make_project({ resources_needed: [] });
      const stage = STAGE_MAP['planned'];

      // When
      const prompt = build_prompt(project, stage);

      // Then
      expect(prompt).toContain('Resources Needed: none');
    });
  });
});
