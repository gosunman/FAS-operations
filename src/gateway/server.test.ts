// TDD tests for Gateway + Task API server
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { create_app } from './server.js';
import { create_task_store, type TaskStore } from './task_store.js';

describe('Gateway Server', () => {
  let store: TaskStore;
  let app: ReturnType<typeof create_app>;

  beforeEach(() => {
    store = create_task_store({ db_path: ':memory:' });
    app = create_app(store);
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
      expect(res.body.error).toContain('title');
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

  // === Hunter API ===

  describe('GET /api/hunter/tasks/pending', () => {
    it('should return sanitized pending tasks for openclaw', async () => {
      // Create tasks for different agents
      await request(app).post('/api/tasks').send({
        title: '이름: 홍길동 학생 정보 조회',
        assigned_to: 'openclaw',
      });
      await request(app).post('/api/tasks').send({
        title: 'Claude task',
        assigned_to: 'claude',
      });

      const res = await request(app).get('/api/hunter/tasks/pending');

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
      // PII should be sanitized
      expect(res.body.tasks[0].title).toContain('[이름 제거됨]');
      expect(res.body.tasks[0].title).not.toContain('홍길동');
    });

    it('should filter out tasks requiring personal info', async () => {
      await request(app).post('/api/tasks').send({
        title: 'Safe task',
        assigned_to: 'openclaw',
        requires_personal_info: false,
      });
      await request(app).post('/api/tasks').send({
        title: 'PII task',
        assigned_to: 'openclaw',
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

      // Verify task was completed
      const task_res = await request(app).get(`/api/tasks/${create_res.body.id}`);
      expect(task_res.body.status).toBe('done');
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
  });
});
