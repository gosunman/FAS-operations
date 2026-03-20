// TDD tests for n8n webhook routes
// Covers: morning/night planning triggers, task result webhook, metrics endpoint
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { create_n8n_routes, type N8nWebhookDeps } from './n8n_webhooks.js';
import { create_task_store, type TaskStore } from './task_store.js';
import { create_mode_manager } from './mode_manager.js';

// === Mock planning loop ===

const create_mock_planning_loop = () => {
  const morning_result = { created: ['Task A', 'Task B'], skipped: ['Task C (not due)'] };
  const night_result = {
    summary: { done: 5, blocked: 1, pending: 3 },
    discovery: { analyzed_tasks: 2, created: ['New opportunity'], skipped: [] },
  };

  return {
    run_morning: vi.fn().mockResolvedValue(morning_result),
    run_night: vi.fn().mockResolvedValue(night_result),
    run_discover: vi.fn().mockResolvedValue({ analyzed_tasks: 0, created: [], skipped: [] }),
    _is_due_today: vi.fn(),
    _load_schedules: vi.fn(),
    _morning_result: morning_result,
    _night_result: night_result,
  };
};

// === Mock notification router ===

const create_mock_router = () => ({
  route: vi.fn().mockResolvedValue({ telegram: true, slack: true, notion: false }),
  get_rules: vi.fn(),
});

// === Test app factory ===

const create_test_app = () => {
  const store = create_task_store({ db_path: ':memory:' });
  const mode_manager = create_mode_manager({
    sleep_start_hour: 23,
    sleep_end_hour: 7,
    sleep_end_minute: 30,
  });
  const planning_loop = create_mock_planning_loop();
  const notification_router = create_mock_router();

  const deps: N8nWebhookDeps = {
    planning_loop,
    router: notification_router,
    store,
    mode_manager,
  };

  const app = express();
  app.use(express.json());
  app.use('/api/n8n', create_n8n_routes(deps));

  return { app, store, mode_manager, planning_loop, notification_router };
};

describe('n8n Webhook Routes', () => {
  let store: TaskStore;
  let app: express.Express;
  let planning_loop: ReturnType<typeof create_mock_planning_loop>;
  let notification_router: ReturnType<typeof create_mock_router>;
  let mode_manager: ReturnType<typeof create_mode_manager>;

  beforeEach(() => {
    ({ app, store, planning_loop, notification_router, mode_manager } = create_test_app());
  });

  afterEach(() => {
    store.close();
  });

  // === POST /api/n8n/planning/morning ===

  describe('POST /api/n8n/planning/morning', () => {
    it('should trigger morning planning and return created/skipped', async () => {
      const res = await request(app).post('/api/n8n/planning/morning');

      expect(res.status).toBe(200);
      expect(res.body.created).toEqual(['Task A', 'Task B']);
      expect(res.body.skipped).toEqual(['Task C (not due)']);
      expect(planning_loop.run_morning).toHaveBeenCalledOnce();
    });

    it('should return 500 if planning loop throws', async () => {
      planning_loop.run_morning.mockRejectedValueOnce(new Error('schedules.yml not found'));

      const res = await request(app).post('/api/n8n/planning/morning');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('PLANNING_ERROR');
      expect(res.body.message).toContain('Morning planning failed');
    });
  });

  // === POST /api/n8n/planning/night ===

  describe('POST /api/n8n/planning/night', () => {
    it('should trigger night planning and return summary + discovery', async () => {
      const res = await request(app).post('/api/n8n/planning/night');

      expect(res.status).toBe(200);
      expect(res.body.summary).toEqual({ done: 5, blocked: 1, pending: 3 });
      expect(res.body.discovery).toBeDefined();
      expect(res.body.discovery.created).toEqual(['New opportunity']);
      expect(planning_loop.run_night).toHaveBeenCalledOnce();
    });

    it('should return 500 if night planning throws', async () => {
      planning_loop.run_night.mockRejectedValueOnce(new Error('DB connection error'));

      const res = await request(app).post('/api/n8n/planning/night');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('PLANNING_ERROR');
      expect(res.body.message).toContain('Night planning failed');
    });
  });

  // === POST /api/n8n/task-result-webhook ===

  describe('POST /api/n8n/task-result-webhook', () => {
    it('should route crawl result to notification router', async () => {
      const res = await request(app)
        .post('/api/n8n/task-result-webhook')
        .send({
          task_id: 'task-123',
          result_type: 'crawl',
          title: 'K-Startup crawl',
          summary: 'Found 3 new programs',
        });

      expect(res.status).toBe(200);
      expect(res.body.routed).toBe(true);
      expect(res.body.channel).toBe('crawl_result');
      expect(notification_router.route).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'crawl_result',
          message: expect.stringContaining('K-Startup crawl'),
        }),
      );
    });

    it('should route error result to alert channel', async () => {
      const res = await request(app)
        .post('/api/n8n/task-result-webhook')
        .send({
          task_id: 'task-456',
          result_type: 'error',
          title: 'Failed crawl',
          summary: 'Connection timeout',
        });

      expect(res.status).toBe(200);
      expect(res.body.channel).toBe('alert');
      expect(notification_router.route).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'alert',
          message: expect.stringContaining('Failed crawl'),
        }),
      );
    });

    it('should route discovery result to telegram', async () => {
      const res = await request(app)
        .post('/api/n8n/task-result-webhook')
        .send({
          task_id: 'task-789',
          result_type: 'discovery',
          title: 'New mentor program found',
          summary: 'SOMA 2026 round 2 open',
        });

      expect(res.status).toBe(200);
      expect(res.body.channel).toBe('discovery');
      expect(notification_router.route).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'discovery',
          message: expect.stringContaining('SOMA 2026'),
        }),
      );
    });

    it('should reject missing required fields', async () => {
      const res = await request(app)
        .post('/api/n8n/task-result-webhook')
        .send({ task_id: 'task-123' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('should reject unknown result_type', async () => {
      const res = await request(app)
        .post('/api/n8n/task-result-webhook')
        .send({
          task_id: 'task-123',
          result_type: 'unknown_type',
          title: 'Test',
          summary: 'Test',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
      expect(res.body.message).toContain('result_type');
    });
  });

  // === GET /api/n8n/metrics ===

  describe('GET /api/n8n/metrics', () => {
    it('should return system metrics', async () => {
      // Seed some tasks
      store.create({ title: 'Done task', assigned_to: 'claude' });
      const task = store.create({ title: 'Pending task', assigned_to: 'hunter' });
      store.complete_task(task.id, { summary: 'Completed' });

      const res = await request(app).get('/api/n8n/metrics');

      expect(res.status).toBe(200);
      expect(res.body.tasks).toBeDefined();
      expect(res.body.tasks.pending).toBe(1);
      expect(res.body.tasks.done).toBe(1);
      expect(res.body.mode).toBeDefined();
      expect(res.body.mode.current_mode).toBe('awake');
      expect(res.body.timestamp).toBeDefined();
    });

    it('should reflect mode changes in metrics', async () => {
      mode_manager.transition({
        target_mode: 'sleep',
        reason: 'test',
        requested_by: 'api',
      });

      const res = await request(app).get('/api/n8n/metrics');

      expect(res.body.mode.current_mode).toBe('sleep');
    });

    it('should include task breakdown by status', async () => {
      store.create({ title: 'A', assigned_to: 'claude' });
      store.create({ title: 'B', assigned_to: 'hunter' });
      const c = store.create({ title: 'C', assigned_to: 'gemini_a' });
      store.block_task(c.id, 'timeout');

      const res = await request(app).get('/api/n8n/metrics');

      expect(res.body.tasks.pending).toBe(2);
      expect(res.body.tasks.blocked).toBe(1);
      expect(res.body.tasks.done).toBe(0);
    });
  });
});
