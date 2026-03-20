// TDD tests for Gateway + Task API server
// Covers: CRUD, Hunter API, authentication, rate limiting, quarantine, schema validation
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { create_app } from './server.js';
import { create_task_store, type TaskStore } from './task_store.js';

// === Test helpers ===

const TEST_API_KEY = 'test-hunter-secret-key-abc123';

const create_test_app = (opts: { with_auth?: boolean; dev_mode?: boolean } = {}) => {
  const store = create_task_store({ db_path: ':memory:' });
  const app = create_app(store, {
    hunter_api_key: opts.with_auth ? TEST_API_KEY : undefined,
    dev_mode: opts.dev_mode ?? true,  // Default to dev mode for tests
    rate_limit_window_ms: 60_000,
    rate_limit_max_requests: 30,
    max_output_length: 1_000,  // Small limit for testing
    max_files_count: 3,
  });
  return { store, app };
};

// Helper to send authenticated hunter requests
const hunter_get = (app: ReturnType<typeof create_app>, path: string) =>
  request(app).get(path).set('x-hunter-api-key', TEST_API_KEY);

const hunter_post = (app: ReturnType<typeof create_app>, path: string) =>
  request(app).post(path).set('x-hunter-api-key', TEST_API_KEY);

describe('Gateway Server', () => {
  let store: TaskStore;
  let app: ReturnType<typeof create_app>;

  beforeEach(() => {
    ({ store, app } = create_test_app());
  });

  afterEach(() => {
    store.close();
  });

  // === Health check ===

  describe('GET /api/health', () => {
    it('should return health status', async () => {
      const res = await request(app).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.uptime_seconds).toBeGreaterThanOrEqual(0);
      expect(res.body.hunter_alive).toBe(false);
      expect(res.body.timestamp).toBeDefined();
    });
  });

  // === Task CRUD ===

  describe('POST /api/tasks', () => {
    it('should create a task', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Crawl K-Startup', assigned_to: 'gemini_a' });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.title).toBe('Crawl K-Startup');
      expect(res.body.status).toBe('pending');
    });

    it('should reject task without title', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .send({ assigned_to: 'claude' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
      expect(res.body.message).toContain('title');
    });

    it('should reject task without assigned_to', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Test' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/tasks', () => {
    it('should list all tasks', async () => {
      await request(app).post('/api/tasks').send({ title: 'A', assigned_to: 'claude' });
      await request(app).post('/api/tasks').send({ title: 'B', assigned_to: 'claude' });

      const res = await request(app).get('/api/tasks');

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(2);
      expect(res.body.tasks.length).toBe(2);
    });

    it('should filter by status', async () => {
      const create_res = await request(app)
        .post('/api/tasks')
        .send({ title: 'A', assigned_to: 'claude' });

      await request(app)
        .post(`/api/tasks/${create_res.body.id}/complete`)
        .send({ summary: 'Done' });

      await request(app).post('/api/tasks').send({ title: 'B', assigned_to: 'claude' });

      const pending_res = await request(app).get('/api/tasks?status=pending');
      expect(pending_res.body.count).toBe(1);
      expect(pending_res.body.tasks[0].title).toBe('B');

      const done_res = await request(app).get('/api/tasks?status=done');
      expect(done_res.body.count).toBe(1);
    });
  });

  describe('GET /api/tasks/:id', () => {
    it('should return task by id', async () => {
      const create_res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Test', assigned_to: 'claude' });

      const res = await request(app).get(`/api/tasks/${create_res.body.id}`);

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Test');
    });

    it('should return 404 for non-existent task', async () => {
      const res = await request(app).get('/api/tasks/non-existent');
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/tasks/:id/status', () => {
    it('should update task status', async () => {
      const create_res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Test', assigned_to: 'claude' });

      const res = await request(app)
        .patch(`/api/tasks/${create_res.body.id}/status`)
        .send({ status: 'in_progress' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('in_progress');
    });
  });

  describe('POST /api/tasks/:id/complete', () => {
    it('should complete task with output', async () => {
      const create_res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Research', assigned_to: 'gemini_a' });

      const res = await request(app)
        .post(`/api/tasks/${create_res.body.id}/complete`)
        .send({
          summary: 'Found 5 results',
          files_created: ['report.md'],
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('done');
      expect(res.body.output.summary).toBe('Found 5 results');
    });
  });

  describe('POST /api/tasks/:id/block', () => {
    it('should block task with reason', async () => {
      const create_res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Deploy', assigned_to: 'claude' });

      const res = await request(app)
        .post(`/api/tasks/${create_res.body.id}/block`)
        .send({ reason: 'API key missing' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('blocked');
    });
  });

  // === Hunter API (no auth mode) ===

  describe('GET /api/hunter/tasks/pending', () => {
    it('should return sanitized pending tasks for hunter', async () => {
      await request(app).post('/api/tasks').send({
        title: '이름: 홍길동 학생 정보 조회',
        assigned_to: 'hunter',
      });
      await request(app).post('/api/tasks').send({
        title: 'Claude task',
        assigned_to: 'claude',
      });

      const res = await request(app).get('/api/hunter/tasks/pending');

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
      expect(res.body.tasks[0].title).toContain('[이름 제거됨]');
      expect(res.body.tasks[0].title).not.toContain('홍길동');
    });

    it('should only include whitelisted fields (no assigned_to, depends_on, etc.)', async () => {
      await request(app).post('/api/tasks').send({
        title: 'Safe crawl task',
        assigned_to: 'hunter',
        requires_personal_info: false,
      });

      const res = await request(app).get('/api/hunter/tasks/pending');

      expect(res.body.count).toBe(1);
      const task = res.body.tasks[0];
      expect(task.id).toBeDefined();
      expect(task.title).toBeDefined();
      expect(task.priority).toBeDefined();
      expect(task).not.toHaveProperty('assigned_to');
      expect(task).not.toHaveProperty('requires_personal_info');
      expect(task).not.toHaveProperty('depends_on');
      expect(task).not.toHaveProperty('output');
      expect(task).not.toHaveProperty('created_at');
    });

    it('should filter out tasks requiring personal info', async () => {
      await request(app).post('/api/tasks').send({
        title: 'Safe task',
        assigned_to: 'hunter',
        requires_personal_info: false,
      });
      await request(app).post('/api/tasks').send({
        title: 'PII task',
        assigned_to: 'hunter',
        requires_personal_info: true,
      });

      const res = await request(app).get('/api/hunter/tasks/pending');

      expect(res.body.count).toBe(1);
      expect(res.body.tasks[0].title).toBe('Safe task');
    });
  });

  describe('POST /api/hunter/tasks/:id/result', () => {
    it('should mark task as done on success', async () => {
      const create_res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Research', assigned_to: 'openclaw' });

      const res = await request(app)
        .post(`/api/hunter/tasks/${create_res.body.id}/result`)
        .send({ status: 'success', output: 'Found 3 items' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      const task_res = await request(app).get(`/api/tasks/${create_res.body.id}`);
      expect(task_res.body.status).toBe('done');
    });

    it('should quarantine result with PII instead of auto-sanitizing', async () => {
      const create_res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Crawl task', assigned_to: 'openclaw' });

      const res = await request(app)
        .post(`/api/hunter/tasks/${create_res.body.id}/result`)
        .send({ status: 'success', output: '결과: 이름: 홍길동, 전화 010-1234-5678' });

      // Should return 202 (quarantined), not 200
      expect(res.status).toBe(202);
      expect(res.body.quarantined).toBe(true);
      expect(res.body.detected_types).toContain('labeled_korean_name');
      expect(res.body.detected_types).toContain('phone_number');

      // Task should be quarantined, not done
      const task_res = await request(app).get(`/api/tasks/${create_res.body.id}`);
      expect(task_res.body.status).toBe('quarantined');
      // Stored output should contain sanitized preview (no raw PII)
      expect(task_res.body.output.summary).toContain('[QUARANTINED]');
      expect(task_res.body.output.summary).not.toContain('홍길동');
      expect(task_res.body.output.summary).not.toContain('010-1234-5678');
    });

    it('should mark task as blocked on failure', async () => {
      const create_res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Failing task', assigned_to: 'openclaw' });

      await request(app)
        .post(`/api/hunter/tasks/${create_res.body.id}/result`)
        .send({ status: 'failure', output: 'Timeout' });

      const task_res = await request(app).get(`/api/tasks/${create_res.body.id}`);
      expect(task_res.body.status).toBe('blocked');
    });
  });

  describe('POST /api/hunter/heartbeat', () => {
    it('should acknowledge heartbeat', async () => {
      const res = await request(app).post('/api/hunter/heartbeat');

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.server_time).toBeDefined();
    });

    it('should update hunter_alive in health check', async () => {
      await request(app).post('/api/hunter/heartbeat');

      const health = await request(app).get('/api/health');
      expect(health.body.hunter_alive).toBe(true);
    });
  });

  // === Stats ===

  describe('GET /api/stats', () => {
    it('should return task statistics', async () => {
      await request(app).post('/api/tasks').send({ title: 'A', assigned_to: 'claude' });
      const b = await request(app).post('/api/tasks').send({ title: 'B', assigned_to: 'claude' });
      await request(app).post(`/api/tasks/${b.body.id}/complete`).send({ summary: 'Done' });

      const res = await request(app).get('/api/stats');

      expect(res.status).toBe(200);
      expect(res.body.pending).toBe(1);
      expect(res.body.done).toBe(1);
    });

    it('should include quarantined count', async () => {
      const res = await request(app).get('/api/stats');
      expect(res.body.quarantined).toBe(0);
    });
  });

  // === Hunter API Authentication ===

  describe('Hunter API key authentication', () => {
    let auth_store: TaskStore;
    let auth_app: ReturnType<typeof create_app>;

    beforeEach(() => {
      ({ store: auth_store, app: auth_app } = create_test_app({ with_auth: true }));
    });

    afterEach(() => {
      auth_store.close();
    });

    it('should reject hunter requests without API key', async () => {
      const res = await request(auth_app).get('/api/hunter/tasks/pending');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('AUTH_ERROR');
    });

    it('should reject hunter requests with wrong API key', async () => {
      const res = await request(auth_app)
        .get('/api/hunter/tasks/pending')
        .set('x-hunter-api-key', 'wrong-key');
      expect(res.status).toBe(401);
    });

    it('should allow hunter requests with correct API key', async () => {
      const res = await hunter_get(auth_app, '/api/hunter/tasks/pending');
      expect(res.status).toBe(200);
    });

    it('should require auth for heartbeat', async () => {
      const res = await request(auth_app).post('/api/hunter/heartbeat');
      expect(res.status).toBe(401);

      const auth_res = await hunter_post(auth_app, '/api/hunter/heartbeat');
      expect(auth_res.status).toBe(200);
    });

    it('should require auth for result submission', async () => {
      // Create a task first (captain API — no auth needed)
      const create_res = await request(auth_app)
        .post('/api/tasks')
        .send({ title: 'Test', assigned_to: 'openclaw' });

      // Submit without auth — should fail
      const res = await request(auth_app)
        .post(`/api/hunter/tasks/${create_res.body.id}/result`)
        .send({ status: 'success', output: 'Done' });
      expect(res.status).toBe(401);

      // Submit with auth — should succeed
      const auth_res = await hunter_post(auth_app, `/api/hunter/tasks/${create_res.body.id}/result`)
        .send({ status: 'success', output: 'Done' });
      expect(auth_res.status).toBe(200);
    });

    it('should reject hunter requests when no API key and no dev mode', async () => {
      const { store: strict_store, app: strict_app } = create_test_app({ dev_mode: false });

      const res = await request(strict_app).get('/api/hunter/tasks/pending');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('AUTH_ERROR');
      expect(res.body.message).toContain('not configured');

      strict_store.close();
    });

    it('should NOT require auth for captain endpoints', async () => {
      // Captain endpoints should work without API key even when auth is enabled
      const res = await request(auth_app)
        .post('/api/tasks')
        .send({ title: 'Test', assigned_to: 'claude' });
      expect(res.status).toBe(201);

      const health = await request(auth_app).get('/api/health');
      expect(health.status).toBe(200);
    });
  });

  // === Schema Validation ===

  describe('Hunter result schema validation', () => {
    it('should reject invalid result status', async () => {
      const create_res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Test', assigned_to: 'openclaw' });

      const res = await request(app)
        .post(`/api/hunter/tasks/${create_res.body.id}/result`)
        .send({ status: 'invalid_status', output: 'Test' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
      expect(res.body.message).toContain('status');
    });

    it('should reject non-string output', async () => {
      const create_res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Test', assigned_to: 'openclaw' });

      const res = await request(app)
        .post(`/api/hunter/tasks/${create_res.body.id}/result`)
        .send({ status: 'success', output: { nested: 'object' } });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
      expect(res.body.message).toContain('output must be a string');
    });

    it('should reject output exceeding max length', async () => {
      const create_res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Test', assigned_to: 'openclaw' });

      // Our test app has max_output_length = 1000
      const long_output = 'x'.repeat(1_001);
      const res = await request(app)
        .post(`/api/hunter/tasks/${create_res.body.id}/result`)
        .send({ status: 'success', output: long_output });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
      expect(res.body.message).toContain('max length');
    });

    it('should reject files exceeding max count', async () => {
      const create_res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Test', assigned_to: 'openclaw' });

      // Our test app has max_files_count = 3
      const res = await request(app)
        .post(`/api/hunter/tasks/${create_res.body.id}/result`)
        .send({
          status: 'success',
          output: 'Done',
          files: ['a.md', 'b.md', 'c.md', 'd.md'],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
      expect(res.body.message).toContain('max count');
    });

    it('should reject files with path traversal', async () => {
      const create_res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Test', assigned_to: 'openclaw' });

      const res = await request(app)
        .post(`/api/hunter/tasks/${create_res.body.id}/result`)
        .send({
          status: 'success',
          output: 'Done',
          files: ['../../etc/passwd'],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
      expect(res.body.message).toContain('..');
    });

    it('should reject files with absolute paths', async () => {
      const create_res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Test', assigned_to: 'openclaw' });

      const res = await request(app)
        .post(`/api/hunter/tasks/${create_res.body.id}/result`)
        .send({
          status: 'success',
          output: 'Done',
          files: ['/etc/shadow'],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
      expect(res.body.message).toContain('"/"');
    });

    it('should reject files with disallowed extensions', async () => {
      const create_res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Test', assigned_to: 'openclaw' });

      const res = await request(app)
        .post(`/api/hunter/tasks/${create_res.body.id}/result`)
        .send({
          status: 'success',
          output: 'Done',
          files: ['malware.exe'],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
      expect(res.body.message).toContain('.exe');
      expect(res.body.details.allowed).toBeDefined();
    });

    it('should allow files with permitted extensions', async () => {
      const create_res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Test', assigned_to: 'openclaw' });

      const res = await request(app)
        .post(`/api/hunter/tasks/${create_res.body.id}/result`)
        .send({
          status: 'success',
          output: 'Done',
          files: ['report.md', 'data.json', 'results.csv'],
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('should reject non-array files', async () => {
      const create_res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Test', assigned_to: 'openclaw' });

      const res = await request(app)
        .post(`/api/hunter/tasks/${create_res.body.id}/result`)
        .send({
          status: 'success',
          output: 'Done',
          files: 'not-an-array',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
      expect(res.body.message).toContain('array');
    });
  });

  // === Rate Limiting ===

  describe('Hunter rate limiting', () => {
    it('should enforce rate limits on hunter endpoints', async () => {
      // Create app with very low rate limit for testing
      const rl_store = create_task_store({ db_path: ':memory:' });
      const rl_app = create_app(rl_store, {
        dev_mode: true,
        rate_limit_window_ms: 60_000,
        rate_limit_max_requests: 2,  // Only 2 requests per minute
      });

      // 1st and 2nd requests — allowed
      const res1 = await request(rl_app).get('/api/hunter/tasks/pending');
      expect(res1.status).toBe(200);

      const res2 = await request(rl_app).post('/api/hunter/heartbeat');
      expect(res2.status).toBe(200);

      // 3rd request — rate limited
      const res3 = await request(rl_app).get('/api/hunter/tasks/pending');
      expect(res3.status).toBe(429);
      expect(res3.body.error).toBe('RATE_LIMIT');

      rl_store.close();
    });

    it('should not rate limit captain endpoints', async () => {
      const rl_store = create_task_store({ db_path: ':memory:' });
      const rl_app = create_app(rl_store, {
        dev_mode: true,
        rate_limit_window_ms: 60_000,
        rate_limit_max_requests: 1,  // Very strict — 1 request per minute
      });

      // Use up the rate limit on hunter endpoint
      await request(rl_app).get('/api/hunter/tasks/pending');

      // Captain endpoints should still work
      const health = await request(rl_app).get('/api/health');
      expect(health.status).toBe(200);

      const tasks = await request(rl_app).get('/api/tasks');
      expect(tasks.status).toBe(200);

      rl_store.close();
    });
  });

  // === Agent Healthcheck API ===

  describe('Agent Healthcheck API', () => {
    it('should register agent heartbeat', async () => {
      const res = await request(app).post('/api/agents/claude/heartbeat');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('should return all agent statuses', async () => {
      await request(app).post('/api/agents/claude/heartbeat');
      await request(app).post('/api/agents/gemini_a/heartbeat');

      const res = await request(app).get('/api/agents/health');
      expect(res.status).toBe(200);
      expect(res.body.agents.length).toBe(2);
      expect(res.body.agents[0].status).toBe('running');
    });

    it('should report and track agent crash', async () => {
      await request(app).post('/api/agents/claude/heartbeat');
      const crash_res = await request(app).post('/api/agents/claude/crash');
      expect(crash_res.body.crash_count).toBe(1);

      await request(app).post('/api/agents/claude/crash');
      const crash_res2 = await request(app).post('/api/agents/claude/crash');
      expect(crash_res2.body.crash_count).toBe(3);
    });

    it('should track crash for unknown agent', async () => {
      const res = await request(app).post('/api/agents/unknown_agent/crash');
      expect(res.status).toBe(200);
      expect(res.body.crash_count).toBe(1);
    });

    it('should sync hunter heartbeat to agent_heartbeats', async () => {
      await request(app).post('/api/hunter/heartbeat');
      const health = await request(app).get('/api/agents/health');
      const openclaw = health.body.agents.find((a: { name: string }) => a.name === 'openclaw');
      expect(openclaw).toBeDefined();
      expect(openclaw.status).toBe('running');
    });
  });

  // === Mode Management API ===

  describe('Mode Management API', () => {
    it('should return current mode', async () => {
      const res = await request(app).get('/api/mode');
      expect(res.status).toBe(200);
      expect(res.body.current_mode).toBe('awake');
      expect(res.body.switched_at).toBeDefined();
    });

    it('should switch to sleep mode', async () => {
      const res = await request(app).post('/api/mode').send({
        target_mode: 'sleep',
        reason: 'bedtime',
        requested_by: 'cron',
      });
      expect(res.status).toBe(200);
      expect(res.body.previous_mode).toBe('awake');
      expect(res.body.current_mode).toBe('sleep');

      const mode_res = await request(app).get('/api/mode');
      expect(mode_res.body.current_mode).toBe('sleep');
    });

    it('should reject invalid target_mode', async () => {
      const res = await request(app).post('/api/mode').send({ target_mode: 'invalid' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('should reflect mode in health check', async () => {
      await request(app).post('/api/mode').send({ target_mode: 'sleep' });
      const health = await request(app).get('/api/health');
      expect(health.body.mode).toBe('sleep');
    });
  });

  // === Cross-Approval API ===

  describe('Cross-Approval API', () => {
    it('should auto-approve low risk actions', async () => {
      const res = await request(app).post('/api/approval/request').send({
        action: 'file_read',
        risk_level: 'low',
      });
      expect(res.status).toBe(200);
      expect(res.body.decision).toBe('approved');
    });

    it('should require human approval for high risk', async () => {
      const res = await request(app).post('/api/approval/request').send({
        action: 'git_push',
        risk_level: 'high',
      });
      expect(res.status).toBe(200);
      expect(res.body.decision).toBe('needs_human_approval');
    });

    it('should auto-approve mid risk when no cross-approval configured', async () => {
      const res = await request(app).post('/api/approval/request').send({
        action: 'file_write',
        risk_level: 'mid',
        context: 'writing config file',
      });
      expect(res.status).toBe(200);
      expect(res.body.decision).toBe('approved');
      expect(res.body.reason).toContain('no cross-approval');
    });

    it('should reject when mode violation (sleep + high risk)', async () => {
      await request(app).post('/api/mode').send({ target_mode: 'sleep' });

      const res = await request(app).post('/api/approval/request').send({
        action: 'git_push',
        risk_level: 'high',
      });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('MODE_VIOLATION');
    });

    it('should reject missing required fields', async () => {
      const res = await request(app).post('/api/approval/request').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });
  });

  // === n8n Webhook Routes ===

  describe('n8n webhook routes at /api/n8n', () => {
    it('should mount n8n routes when planning_loop and notification_router are provided', async () => {
      const n8n_store = create_task_store({ db_path: ':memory:' });
      const mock_planning_loop = {
        run_morning: async () => ({ created: [], skipped: [] }),
        run_night: async () => ({ summary: 'test', discovery: [] }),
      };
      const mock_notification_router = {
        route: async () => {},
      };
      const n8n_app = create_app(n8n_store, {
        dev_mode: true,
        planning_loop: mock_planning_loop as any,
        notification_router: mock_notification_router as any,
      });

      // GET /api/n8n/metrics should be accessible
      const res = await request(n8n_app).get('/api/n8n/metrics');
      expect(res.status).toBe(200);
      expect(res.body.tasks).toBeDefined();
      expect(res.body.mode).toBeDefined();
      expect(res.body.timestamp).toBeDefined();

      n8n_store.close();
    });

    it('should NOT mount n8n routes when planning_loop is missing', async () => {
      // Default app has no planning_loop — /api/n8n should 404
      const res = await request(app).get('/api/n8n/metrics');
      expect(res.status).toBe(404);
    });

    it('should trigger morning planning via POST /api/n8n/planning/morning', async () => {
      const n8n_store = create_task_store({ db_path: ':memory:' });
      const mock_planning_loop = {
        run_morning: async () => ({ created: ['task-1'], skipped: ['task-2'] }),
        run_night: async () => ({ summary: 'test', discovery: [] }),
      };
      const mock_notification_router = {
        route: async () => {},
      };
      const n8n_app = create_app(n8n_store, {
        dev_mode: true,
        planning_loop: mock_planning_loop as any,
        notification_router: mock_notification_router as any,
      });

      const res = await request(n8n_app).post('/api/n8n/planning/morning');
      expect(res.status).toBe(200);
      expect(res.body.created_count).toBe(1);
      expect(res.body.skipped_count).toBe(1);

      n8n_store.close();
    });
  });
});
