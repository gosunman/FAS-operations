import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import type { Logger } from './logger.js';
import type { HunterConfig } from './config.js';
import {
  create_revenue_scout,
  build_scout_prompt,
  parse_opportunities,
  exec_openclaw,
} from './revenue_scout.js';

// === Mock child_process ===
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';
const mock_spawn = vi.mocked(spawn);

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
  google_profile_dir: './profile',
  deep_research_timeout_ms: 300_000,
  notebooklm_timeout_ms: 180_000,
  chatgpt_timeout_ms: 180_000,
  autonomous_db_path: './data/hunter.db',
  reports_dir: './reports',
  scout_interval_ms: 21_600_000,
  openclaw_command: 'openclaw',
  openclaw_agent: 'main',
  captain_health_check_interval_ms: 30_000,
  captain_failure_threshold: 3,
  ...overrides,
});

// In-memory project database mock
const create_mock_project_db = () => {
  const projects: { id: string; title: string; category: string; expected_revenue: string; resources_needed: string[] }[] = [];
  let id_counter = 0;

  return {
    create: vi.fn((params: { title: string; category: string; expected_revenue: string; resources_needed: string[] }) => {
      id_counter += 1;
      const project = { id: `proj_${id_counter}`, ...params };
      projects.push(project);
      return { id: project.id };
    }),
    get_all: vi.fn(() => projects),
    _projects: projects, // Internal access for assertions
  };
};

// Helper: create a mock ChildProcess that emits events
const create_mock_process = (
  stdout_data: string,
  stderr_data: string,
  exit_code: number,
) => {
  const stdout_listeners: ((chunk: Buffer) => void)[] = [];
  const stderr_listeners: ((chunk: Buffer) => void)[] = [];
  const close_listeners: ((code: number | null) => void)[] = [];
  const error_listeners: ((err: Error) => void)[] = [];

  const mock_proc = {
    stdout: {
      on: vi.fn((event: string, cb: (chunk: Buffer) => void) => {
        if (event === 'data') stdout_listeners.push(cb);
      }),
    },
    stderr: {
      on: vi.fn((event: string, cb: (chunk: Buffer) => void) => {
        if (event === 'data') stderr_listeners.push(cb);
      }),
    },
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'close') close_listeners.push(cb as (code: number | null) => void);
      if (event === 'error') error_listeners.push(cb as (err: Error) => void);
    }),
    // Trigger methods for tests
    _emit_stdout: (data: string) => {
      for (const cb of stdout_listeners) cb(Buffer.from(data));
    },
    _emit_stderr: (data: string) => {
      for (const cb of stderr_listeners) cb(Buffer.from(data));
    },
    _emit_close: (code: number | null) => {
      for (const cb of close_listeners) cb(code);
    },
    _emit_error: (err: Error) => {
      for (const cb of error_listeners) cb(err);
    },
  };

  // Auto-emit stdout, stderr, and close after spawn is called
  mock_spawn.mockImplementation(() => {
    // Schedule event emissions on next tick to allow listeners to be registered
    queueMicrotask(() => {
      if (stdout_data) mock_proc._emit_stdout(stdout_data);
      if (stderr_data) mock_proc._emit_stderr(stderr_data);
      mock_proc._emit_close(exit_code);
    });
    return mock_proc as unknown as ChildProcess;
  });

  return mock_proc;
};

// Helper: create a mock process that emits an error event (e.g., ENOENT)
const create_error_process = (error: Error) => {
  const mock_proc = {
    stdout: {
      on: vi.fn(),
    },
    stderr: {
      on: vi.fn(),
    },
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'error') {
        queueMicrotask(() => (cb as (err: Error) => void)(error));
      }
    }),
  };

  mock_spawn.mockImplementation(() => mock_proc as unknown as ChildProcess);
  return mock_proc;
};

// Sample valid opportunities JSON
const SAMPLE_OPPORTUNITIES = [
  {
    title: 'AI Resume Optimizer SaaS',
    category: 'micro_saas',
    expected_revenue: '월 200만원',
    resources_needed: ['OpenAI API', 'Vercel', 'Stripe'],
    reasoning: 'Korean job market is competitive, AI-optimized resumes have high demand',
  },
  {
    title: 'GitHub Trending Newsletter',
    category: 'github_trending_service',
    expected_revenue: '월 50만원',
    resources_needed: ['GitHub API', 'Resend'],
    reasoning: 'Curated trending repos with analysis, monetize via premium tier',
  },
  {
    title: 'AI Short Video Generator',
    category: 'youtube_shorts_automation',
    expected_revenue: '월 300만원',
    resources_needed: ['FFmpeg', 'ElevenLabs', 'YouTube API'],
    reasoning: 'Short-form video content is exploding, automation reduces production time 10x',
  },
];

// ===== build_scout_prompt tests =====
describe('build_scout_prompt', () => {
  it('should include existing titles in the prompt for deduplication', () => {
    // Given
    const existing = ['Project Alpha', 'Project Beta'];

    // When
    const prompt = build_scout_prompt(existing);

    // Then
    expect(prompt).toContain('Project Alpha');
    expect(prompt).toContain('Project Beta');
    expect(prompt).toContain('Skip these existing projects');
  });

  it('should show "(none)" when no existing projects', () => {
    // Given
    const existing: string[] = [];

    // When
    const prompt = build_scout_prompt(existing);

    // Then
    expect(prompt).toContain('(none)');
  });

  it('should instruct to return JSON array', () => {
    // Given / When
    const prompt = build_scout_prompt([]);

    // Then
    expect(prompt).toContain('JSON array');
    expect(prompt).toContain('3-5');
  });

  it('should mention all four research sources', () => {
    // Given / When
    const prompt = build_scout_prompt([]);

    // Then
    expect(prompt).toContain('GitHub Trending');
    expect(prompt).toContain('ProductHunt');
    expect(prompt).toContain('IndieHackers');
    expect(prompt).toContain('AI tool trends');
  });

  it('should ask for Korean market evaluation', () => {
    // Given / When
    const prompt = build_scout_prompt([]);

    // Then
    expect(prompt).toContain('Korean market demand');
  });
});

// ===== parse_opportunities tests =====
describe('parse_opportunities', () => {
  it('should parse raw JSON array directly', () => {
    // Given
    const raw = JSON.stringify(SAMPLE_OPPORTUNITIES);

    // When
    const result = parse_opportunities(raw);

    // Then
    expect(result).toHaveLength(3);
    expect(result![0].title).toBe('AI Resume Optimizer SaaS');
  });

  it('should extract JSON from markdown code blocks with json tag', () => {
    // Given
    const raw = `Here are the opportunities I found:\n\n\`\`\`json\n${JSON.stringify(SAMPLE_OPPORTUNITIES, null, 2)}\n\`\`\`\n\nHope this helps!`;

    // When
    const result = parse_opportunities(raw);

    // Then
    expect(result).toHaveLength(3);
    expect(result![0].title).toBe('AI Resume Optimizer SaaS');
  });

  it('should extract JSON from markdown code blocks without json tag', () => {
    // Given
    const raw = `Results:\n\n\`\`\`\n${JSON.stringify(SAMPLE_OPPORTUNITIES)}\n\`\`\``;

    // When
    const result = parse_opportunities(raw);

    // Then
    expect(result).toHaveLength(3);
  });

  it('should extract JSON array from mixed text', () => {
    // Given — JSON embedded in prose without code fences
    const raw = `I found these opportunities: [{"title":"Test","category":"other","expected_revenue":"월 100만원","resources_needed":["API"],"reasoning":"good"}] and that is all.`;

    // When
    const result = parse_opportunities(raw);

    // Then
    expect(result).toHaveLength(1);
    expect(result![0].title).toBe('Test');
  });

  it('should return null for completely malformed input', () => {
    // Given
    const raw = 'This is not JSON at all, just random text without any brackets.';

    // When
    const result = parse_opportunities(raw);

    // Then
    expect(result).toBeNull();
  });

  it('should return null for invalid JSON inside brackets', () => {
    // Given
    const raw = '[{invalid json content here}]';

    // When
    const result = parse_opportunities(raw);

    // Then
    expect(result).toBeNull();
  });

  it('should return null for a JSON object (not array)', () => {
    // Given
    const raw = '{"title": "Single item", "not": "an array"}';

    // When
    const result = parse_opportunities(raw);

    // Then
    expect(result).toBeNull();
  });
});

// ===== exec_openclaw tests =====
describe('exec_openclaw', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return success when OpenClaw exits with code 0', async () => {
    // Given
    create_mock_process('{"result": "ok"}', '', 0);

    // When
    const result = await exec_openclaw('openclaw', 'main', 'test prompt', 60_000);

    // Then
    expect(result.success).toBe(true);
    expect(result.output).toBe('{"result": "ok"}');
    expect(result.error).toBeUndefined();
  });

  it('should return failure when OpenClaw exits with non-zero code', async () => {
    // Given
    create_mock_process('', 'something went wrong', 1);

    // When
    const result = await exec_openclaw('openclaw', 'main', 'test prompt', 60_000);

    // Then
    expect(result.success).toBe(false);
    expect(result.error).toContain('exited with code 1');
    expect(result.error).toContain('something went wrong');
  });

  it('should return ENOENT-specific message when command not found', async () => {
    // Given
    const err = new Error('spawn openclaw ENOENT');
    create_error_process(err);

    // When
    const result = await exec_openclaw('openclaw', 'main', 'test prompt', 60_000);

    // Then
    expect(result.success).toBe(false);
    expect(result.error).toContain('OpenClaw not installed');
  });

  it('should return generic error message for non-ENOENT errors', async () => {
    // Given
    const err = new Error('Permission denied');
    create_error_process(err);

    // When
    const result = await exec_openclaw('openclaw', 'main', 'test prompt', 60_000);

    // Then
    expect(result.success).toBe(false);
    expect(result.error).toBe('Permission denied');
  });

  it('should pass correct arguments to spawn', async () => {
    // Given
    create_mock_process('', '', 0);

    // When
    await exec_openclaw('my-openclaw', 'scout-agent', 'find opportunities', 120_000);

    // Then
    expect(mock_spawn).toHaveBeenCalledWith(
      'my-openclaw',
      ['agent', '--agent', 'scout-agent', '-m', 'find opportunities', '--json'],
      expect.objectContaining({
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 120_000,
        env: expect.objectContaining({ NO_COLOR: '1' }),
      }),
    );
  });
});

// ===== create_revenue_scout tests =====
describe('create_revenue_scout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create projects from successful OpenClaw response', async () => {
    // Given — OpenClaw returns valid JSON with 3 opportunities
    create_mock_process(JSON.stringify(SAMPLE_OPPORTUNITIES), '', 0);
    const project_db = create_mock_project_db();
    const scout = create_revenue_scout({
      config: make_config(),
      logger: mock_logger,
      project_db,
    });

    // When
    const result = await scout.run_scout_cycle();

    // Then
    expect(result.opportunities_found).toBe(3);
    expect(result.projects_created).toHaveLength(3);
    expect(result.errors).toHaveLength(0);
    expect(project_db.create).toHaveBeenCalledTimes(3);
    expect(project_db.create).toHaveBeenCalledWith(expect.objectContaining({
      title: 'AI Resume Optimizer SaaS',
      category: 'micro_saas',
    }));
  });

  it('should handle OpenClaw response wrapped in markdown code blocks', async () => {
    // Given — OpenClaw wraps JSON in ```json ... ```
    const wrapped = `Here are the results:\n\n\`\`\`json\n${JSON.stringify(SAMPLE_OPPORTUNITIES)}\n\`\`\``;
    create_mock_process(wrapped, '', 0);
    const project_db = create_mock_project_db();
    const scout = create_revenue_scout({
      config: make_config(),
      logger: mock_logger,
      project_db,
    });

    // When
    const result = await scout.run_scout_cycle();

    // Then
    expect(result.opportunities_found).toBe(3);
    expect(result.projects_created).toHaveLength(3);
    expect(result.errors).toHaveLength(0);
  });

  it('should handle OpenClaw failure gracefully', async () => {
    // Given — OpenClaw exits with non-zero code
    create_mock_process('', 'network error', 1);
    const project_db = create_mock_project_db();
    const scout = create_revenue_scout({
      config: make_config(),
      logger: mock_logger,
      project_db,
    });

    // When
    const result = await scout.run_scout_cycle();

    // Then
    expect(result.opportunities_found).toBe(0);
    expect(result.projects_created).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('OpenClaw failed');
    expect(project_db.create).not.toHaveBeenCalled();
  });

  it('should skip duplicate project titles (case-insensitive)', async () => {
    // Given — DB already has "AI Resume Optimizer SaaS"
    const project_db = create_mock_project_db();
    project_db._projects.push({
      id: 'existing_1',
      title: 'ai resume optimizer saas', // lowercase version already exists
      category: 'micro_saas',
      expected_revenue: '월 200만원',
      resources_needed: [],
    });

    create_mock_process(JSON.stringify(SAMPLE_OPPORTUNITIES), '', 0);
    const scout = create_revenue_scout({
      config: make_config(),
      logger: mock_logger,
      project_db,
    });

    // When
    const result = await scout.run_scout_cycle();

    // Then — 3 found but only 2 created (1 duplicate skipped)
    expect(result.opportunities_found).toBe(3);
    expect(result.projects_created).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
    // The duplicate "AI Resume Optimizer SaaS" should not be created
    expect(project_db.create).toHaveBeenCalledTimes(2);
  });

  it('should handle malformed JSON response gracefully', async () => {
    // Given — OpenClaw returns unparseable text
    create_mock_process('Sorry, I could not find any opportunities right now.', '', 0);
    const project_db = create_mock_project_db();
    const scout = create_revenue_scout({
      config: make_config(),
      logger: mock_logger,
      project_db,
    });

    // When
    const result = await scout.run_scout_cycle();

    // Then
    expect(result.opportunities_found).toBe(0);
    expect(result.projects_created).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Failed to parse');
    expect(project_db.create).not.toHaveBeenCalled();
  });

  it('should skip opportunities with missing required fields', async () => {
    // Given — one valid opportunity, one missing title, one missing category
    const mixed = [
      SAMPLE_OPPORTUNITIES[0], // valid
      { category: 'other', expected_revenue: '월 100만원', resources_needed: [] }, // missing title
      { title: '', category: 'other', expected_revenue: '월 100만원', resources_needed: [] }, // empty title
    ];
    create_mock_process(JSON.stringify(mixed), '', 0);
    const project_db = create_mock_project_db();
    const scout = create_revenue_scout({
      config: make_config(),
      logger: mock_logger,
      project_db,
    });

    // When
    const result = await scout.run_scout_cycle();

    // Then — 3 found but only 1 valid + created
    expect(result.opportunities_found).toBe(3);
    expect(result.projects_created).toHaveLength(1);
    expect(result.errors).toHaveLength(2); // 2 invalid entries
  });

  it('should handle project_db.create failure gracefully', async () => {
    // Given — project_db.create throws on one item
    const project_db = create_mock_project_db();
    let call_count = 0;
    project_db.create.mockImplementation((params) => {
      call_count += 1;
      if (call_count === 2) {
        throw new Error('DB write error');
      }
      return { id: `proj_${call_count}` };
    });

    create_mock_process(JSON.stringify(SAMPLE_OPPORTUNITIES), '', 0);
    const scout = create_revenue_scout({
      config: make_config(),
      logger: mock_logger,
      project_db,
    });

    // When
    const result = await scout.run_scout_cycle();

    // Then — 3 found, 2 created (1 DB error), 1 error recorded
    expect(result.opportunities_found).toBe(3);
    expect(result.projects_created).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('DB write error');
  });

  it('should prevent duplicate titles within the same batch', async () => {
    // Given — OpenClaw returns duplicate titles in the same response
    const duplicated = [
      { ...SAMPLE_OPPORTUNITIES[0] },
      { ...SAMPLE_OPPORTUNITIES[0], reasoning: 'Different reasoning but same title' },
    ];
    create_mock_process(JSON.stringify(duplicated), '', 0);
    const project_db = create_mock_project_db();
    const scout = create_revenue_scout({
      config: make_config(),
      logger: mock_logger,
      project_db,
    });

    // When
    const result = await scout.run_scout_cycle();

    // Then — 2 found but only 1 created (second is a within-batch duplicate)
    expect(result.opportunities_found).toBe(2);
    expect(result.projects_created).toHaveLength(1);
    expect(project_db.create).toHaveBeenCalledTimes(1);
  });

  it('should use config values for openclaw command and agent', async () => {
    // Given — custom openclaw command and agent in config
    create_mock_process(JSON.stringify([]), '', 0);
    const project_db = create_mock_project_db();
    const custom_config = make_config({
      openclaw_command: '/usr/local/bin/my-openclaw',
      openclaw_agent: 'revenue-hunter',
    });
    const scout = create_revenue_scout({
      config: custom_config,
      logger: mock_logger,
      project_db,
    });

    // When
    await scout.run_scout_cycle();

    // Then
    expect(mock_spawn).toHaveBeenCalledWith(
      '/usr/local/bin/my-openclaw',
      expect.arrayContaining(['--agent', 'revenue-hunter']),
      expect.any(Object),
    );
  });

  it('should pass existing titles to the prompt for deduplication', async () => {
    // Given — DB has existing projects
    const project_db = create_mock_project_db();
    project_db._projects.push(
      { id: 'p1', title: 'Existing Project A', category: 'other', expected_revenue: '', resources_needed: [] },
      { id: 'p2', title: 'Existing Project B', category: 'other', expected_revenue: '', resources_needed: [] },
    );

    create_mock_process(JSON.stringify([]), '', 0);
    const scout = create_revenue_scout({
      config: make_config(),
      logger: mock_logger,
      project_db,
    });

    // When
    await scout.run_scout_cycle();

    // Then — the prompt sent to OpenClaw should contain the existing titles
    const spawn_call = mock_spawn.mock.calls[0];
    const prompt_arg = spawn_call[1][4]; // '-m' is at index 3, prompt is at index 4
    expect(prompt_arg).toContain('existing project a');
    expect(prompt_arg).toContain('existing project b');
  });

  it('should handle empty opportunities array from OpenClaw', async () => {
    // Given — OpenClaw returns an empty array (no opportunities found)
    create_mock_process('[]', '', 0);
    const project_db = create_mock_project_db();
    const scout = create_revenue_scout({
      config: make_config(),
      logger: mock_logger,
      project_db,
    });

    // When
    const result = await scout.run_scout_cycle();

    // Then
    expect(result.opportunities_found).toBe(0);
    expect(result.projects_created).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(project_db.create).not.toHaveBeenCalled();
  });

  it('should handle OpenClaw ENOENT (not installed) gracefully', async () => {
    // Given — OpenClaw binary not found
    create_error_process(new Error('spawn openclaw ENOENT'));
    const project_db = create_mock_project_db();
    const scout = create_revenue_scout({
      config: make_config(),
      logger: mock_logger,
      project_db,
    });

    // When
    const result = await scout.run_scout_cycle();

    // Then
    expect(result.opportunities_found).toBe(0);
    expect(result.projects_created).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('OpenClaw not installed');
  });
});
