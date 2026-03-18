// Integration test: Captain ↔ Hunter task flow
// Tests the full cycle: Gateway server → hunter poll → task submit → PII handling
//
// Covers:
//   - Gateway startup on random port
//   - Hunter API authentication
//   - Task polling (sanitized output)
//   - PII sanitization on outgoing tasks
//   - PII quarantine on incoming results
//   - Heartbeat tracking
//   - Rate limiting

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { create_app, type AppOptions } from '../../src/gateway/server.js';
import { create_task_store, type TaskStore } from '../../src/gateway/task_store.js';

// === Test constants ===

const TEST_API_KEY = 'integration-test-key-xyz789';

// PII test data — Korean phone number format
const PII_PHONE = '010-1234-5678';
const PII_EMAIL = 'owner@example.com';
const CLEAN_TEXT = 'Successfully crawled https://example.com — found 42 results';

// === Helpers ===

const create_integration_app = (overrides: Partial<AppOptions> = {}) => {
  const store = create_task_store({ db_path: ':memory:' });
  const app = create_app(store, {
    hunter_api_key: TEST_API_KEY,
    dev_mode: false,
    rate_limit_window_ms: 60_000,
    rate_limit_max_requests: 100,  // Higher limit for integration tests
    max_output_length: 10_000,
    max_files_count: 10,
    ...overrides,
  });
  return { store, app };
};

// Authenticated request helpers
const auth_get = (app: ReturnType<typeof create_app>, path: string) =>
  request(app).get(path).set('x-hunter-api-key', TEST_API_KEY);

const auth_post = (app: ReturnType<typeof create_app>, path: string) =>
  request(app).post(path).set('x-hunter-api-key', TEST_API_KEY);

// Create a task assigned to openclaw (hunter)
const create_hunter_task = async (
  app: ReturnType<typeof create_app>,
  overrides: Record<string, unknown> = {},
) => {
  const res = await request(app)
    .post('/api/tasks')
    .send({
      title: 'Test web crawl task',
      description: 'Crawl https://example.com for data',
      assigned_to: 'openclaw',
      priority: 'medium',
      risk_level: 'low',
      mode: 'awake',
      requires_personal_info: false,
      ...overrides,
    });
  return res.body;
};

// === Tests ===

describe('Captain ↔ Hunter Integration', () => {
  let store: TaskStore;
  let app: ReturnType<typeof create_app>;

  beforeEach(() => {
    ({ store, app } = create_integration_app());
  });

  afterEach(() => {
    store.close();
  });

  // === Full task lifecycle ===

  describe('Full task lifecycle: create → poll → submit', () => {
    it('should complete a full task cycle', async () => {
      // Step 1: Captain creates a task for hunter
      const task = await create_hunter_task(app);
      expect(task.id).toBeDefined();
      expect(task.status).toBe('pending');

      // Step 2: Hunter sends heartbeat
      const hb_res = await auth_post(app, '/api/hunter/heartbeat')
        .send({ agent: 'openclaw', timestamp: new Date().toISOString() });
      expect(hb_res.status).toBe(200);
      expect(hb_res.body.ok).toBe(true);

      // Step 3: Hunter polls for pending tasks
      const poll_res = await auth_get(app, '/api/hunter/tasks/pending');
      expect(poll_res.status).toBe(200);
      expect(poll_res.body.tasks.length).toBeGreaterThanOrEqual(1);

      const found_task = poll_res.body.tasks.find(
        (t: { id: string }) => t.id === task.id,
      );
      expect(found_task).toBeDefined();

      // Step 4: Hunter submits result
      const result_res = await auth_post(app, `/api/hunter/tasks/${task.id}/result`)
        .send({
          status: 'success',
          output: CLEAN_TEXT,
        });
      expect(result_res.status).toBe(200);
      expect(result_res.body.ok).toBe(true);

      // Step 5: Verify task is completed
      const task_res = await request(app).get(`/api/tasks/${task.id}`);
      expect(task_res.body.status).toBe('done');
      expect(task_res.body.output.summary).toBe(CLEAN_TEXT);
    });
  });

  // === PII sanitization on outgoing tasks ===

  describe('PII sanitization (outgoing to hunter)', () => {
    it('should never expose PII-required tasks to hunter', async () => {
      // Create a task that requires personal info — must NOT appear in hunter queue
      await create_hunter_task(app, {
        title: 'Send SMS to student',
        requires_personal_info: true,
      });

      const poll_res = await auth_get(app, '/api/hunter/tasks/pending');
      const pii_tasks = poll_res.body.tasks.filter(
        (t: { title: string }) => t.title === 'Send SMS to student',
      );
      expect(pii_tasks.length).toBe(0);
    });
  });

  // === PII quarantine on incoming results ===

  describe('PII quarantine (incoming from hunter)', () => {
    it('should quarantine results containing PII', async () => {
      const task = await create_hunter_task(app);

      // Hunter submits result containing a Korean phone number (PII)
      const result_res = await auth_post(app, `/api/hunter/tasks/${task.id}/result`)
        .send({
          status: 'success',
          output: `Found contact info: ${PII_PHONE}`,
        });

      // Should be accepted but quarantined (HTTP 202)
      expect(result_res.status).toBe(202);
      expect(result_res.body.quarantined).toBe(true);
      expect(result_res.body.detected_types).toBeDefined();

      // Verify task is in quarantined state
      const task_res = await request(app).get(`/api/tasks/${task.id}`);
      expect(task_res.body.status).toBe('quarantined');
    });

    it('should accept clean results without quarantine', async () => {
      const task = await create_hunter_task(app);

      const result_res = await auth_post(app, `/api/hunter/tasks/${task.id}/result`)
        .send({
          status: 'success',
          output: CLEAN_TEXT,
        });

      expect(result_res.status).toBe(200);
      expect(result_res.body.ok).toBe(true);
    });
  });

  // === Heartbeat tracking ===

  describe('Heartbeat tracking', () => {
    it('should track hunter heartbeat in health check', async () => {
      // Before heartbeat — hunter not alive
      const before = await request(app).get('/api/health');
      expect(before.body.hunter_alive).toBe(false);

      // Send heartbeat
      await auth_post(app, '/api/hunter/heartbeat')
        .send({ agent: 'openclaw' });

      // After heartbeat — hunter alive
      const after = await request(app).get('/api/health');
      expect(after.body.hunter_alive).toBe(true);
    });

    it('should track hunter in agent health registry', async () => {
      await auth_post(app, '/api/hunter/heartbeat')
        .send({ agent: 'openclaw' });

      const health = await request(app).get('/api/agents/health');
      const hunter = health.body.agents.find(
        (a: { name: string }) => a.name === 'openclaw',
      );

      expect(hunter).toBeDefined();
      expect(hunter.status).toBe('running');
      expect(hunter.last_heartbeat).toBeDefined();
    });
  });

  // === Authentication ===

  describe('Hunter API authentication', () => {
    it('should reject requests without API key', async () => {
      const res = await request(app).get('/api/hunter/tasks/pending');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('AUTH_ERROR');
    });

    it('should reject requests with wrong API key', async () => {
      const res = await request(app)
        .get('/api/hunter/tasks/pending')
        .set('x-hunter-api-key', 'wrong-key');
      expect(res.status).toBe(401);
    });

    it('should accept requests with correct API key', async () => {
      const res = await auth_get(app, '/api/hunter/tasks/pending');
      expect(res.status).toBe(200);
    });
  });

  // === Rate limiting ===

  describe('Rate limiting', () => {
    it('should enforce rate limits on hunter endpoints', async () => {
      // Create app with very low rate limit
      const { store: limited_store, app: limited_app } = create_integration_app({
        rate_limit_window_ms: 60_000,
        rate_limit_max_requests: 3,
      });

      try {
        // Make requests up to the limit
        for (let i = 0; i < 3; i++) {
          const res = await request(limited_app)
            .get('/api/hunter/tasks/pending')
            .set('x-hunter-api-key', TEST_API_KEY);
          expect(res.status).toBe(200);
        }

        // Next request should be rate-limited
        const blocked_res = await request(limited_app)
          .get('/api/hunter/tasks/pending')
          .set('x-hunter-api-key', TEST_API_KEY);
        expect(blocked_res.status).toBe(429);
        expect(blocked_res.body.error).toBe('RATE_LIMIT');
      } finally {
        limited_store.close();
      }
    });
  });

  // === Schema validation ===

  describe('Hunter result schema validation', () => {
    it('should reject invalid result status', async () => {
      const task = await create_hunter_task(app);

      const res = await auth_post(app, `/api/hunter/tasks/${task.id}/result`)
        .send({ status: 'invalid', output: 'test' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('should reject oversized output', async () => {
      // Create app with small output limit
      const { store: small_store, app: small_app } = create_integration_app({
        max_output_length: 100,
      });

      try {
        const task_res = await request(small_app)
          .post('/api/tasks')
          .send({
            title: 'Test',
            assigned_to: 'openclaw',
            requires_personal_info: false,
          });

        const res = await request(small_app)
          .post(`/api/hunter/tasks/${task_res.body.id}/result`)
          .set('x-hunter-api-key', TEST_API_KEY)
          .send({ status: 'success', output: 'x'.repeat(200) });

        expect(res.status).toBe(400);
        expect(res.body.message).toContain('max length');
      } finally {
        small_store.close();
      }
    });

    it('should reject file paths with traversal attempts', async () => {
      const task = await create_hunter_task(app);

      const res = await auth_post(app, `/api/hunter/tasks/${task.id}/result`)
        .send({
          status: 'success',
          output: 'done',
          files: ['../../etc/passwd'],
        });
      expect(res.status).toBe(400);
    });

    it('should reject disallowed file extensions', async () => {
      const task = await create_hunter_task(app);

      const res = await auth_post(app, `/api/hunter/tasks/${task.id}/result`)
        .send({
          status: 'success',
          output: 'done',
          files: ['payload.exe'],
        });
      expect(res.status).toBe(400);
    });
  });

  // === Failure handling ===

  describe('Task failure handling', () => {
    it('should handle hunter reporting task failure', async () => {
      const task = await create_hunter_task(app);

      const res = await auth_post(app, `/api/hunter/tasks/${task.id}/result`)
        .send({
          status: 'failure',
          output: 'Browser timeout after 30s',
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      // Task should be blocked
      const task_res = await request(app).get(`/api/tasks/${task.id}`);
      expect(task_res.body.status).toBe('blocked');
    });
  });
});
