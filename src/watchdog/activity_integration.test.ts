// TDD tests for activity integration — wiring ActivityLogger into FAS services
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { create_activity_logger, type ActivityLogger } from './activity_logger.js';
import { create_activity_hooks, type ActivityHooks } from './activity_integration.js';
import { create_app } from '../gateway/server.js';
import { create_task_store, type TaskStore } from '../gateway/task_store.js';

// === Test helpers ===

const get_all_activities = (logger: ActivityLogger) => {
  const now = new Date();
  const start = new Date(now.getTime() - 60_000).toISOString();
  const end = new Date(now.getTime() + 60_000).toISOString();
  return logger.get_activities_by_date(start, end);
};

describe('Activity Integration', () => {
  let logger: ActivityLogger;
  let hooks: ActivityHooks;

  beforeEach(() => {
    logger = create_activity_logger({ db_path: ':memory:' });
    hooks = create_activity_hooks(logger);
  });

  afterEach(() => {
    logger.close();
  });

  // === ActivityHooks unit tests ===

  describe('create_activity_hooks()', () => {
    it('should log task creation', () => {
      hooks.log_task_created('task-123', 'Test task', 'hunter', 'low');
      const entries = get_all_activities(logger);
      expect(entries).toHaveLength(1);
      expect(entries[0].action).toBe('task_created');
      expect(entries[0].agent).toBe('gateway');
      expect(entries[0].risk_level).toBe('low');
      expect(entries[0].details).toEqual({
        task_id: 'task-123',
        title: 'Test task',
        assigned_to: 'hunter',
      });
    });

    it('should log task completion', () => {
      hooks.log_task_completed('task-456', 'Done task');
      const entries = get_all_activities(logger);
      expect(entries).toHaveLength(1);
      expect(entries[0].action).toBe('task_completed');
      expect(entries[0].details).toEqual({
        task_id: 'task-456',
        title: 'Done task',
      });
    });

    it('should log task failure (block)', () => {
      hooks.log_task_failed('task-789', 'Timed out');
      const entries = get_all_activities(logger);
      expect(entries).toHaveLength(1);
      expect(entries[0].action).toBe('task_failed');
      expect(entries[0].risk_level).toBe('mid');
      expect(entries[0].details).toEqual({
        task_id: 'task-789',
        reason: 'Timed out',
      });
    });

    it('should log hunter heartbeat', () => {
      hooks.log_hunter_heartbeat();
      const entries = get_all_activities(logger);
      expect(entries).toHaveLength(1);
      expect(entries[0].action).toBe('hunter_heartbeat');
      expect(entries[0].agent).toBe('hunter');
      expect(entries[0].risk_level).toBe('low');
    });

    it('should log notification sent', () => {
      hooks.log_notification_sent('telegram', 'alert', true);
      const entries = get_all_activities(logger);
      expect(entries).toHaveLength(1);
      expect(entries[0].action).toBe('notification_sent');
      expect(entries[0].agent).toBe('gateway');
      expect(entries[0].details).toEqual({
        channel: 'telegram',
        event_type: 'alert',
        success: true,
      });
    });

    it('should log notification failure', () => {
      hooks.log_notification_sent('slack', 'briefing', false, 'Connection refused');
      const entries = get_all_activities(logger);
      expect(entries).toHaveLength(1);
      expect(entries[0].action).toBe('notification_sent');
      expect(entries[0].risk_level).toBe('mid');
      expect(entries[0].details).toEqual({
        channel: 'slack',
        event_type: 'briefing',
        success: false,
        error: 'Connection refused',
      });
    });

    it('should log telegram command', () => {
      hooks.log_telegram_command('/hunter', 'Search for something');
      const entries = get_all_activities(logger);
      expect(entries).toHaveLength(1);
      expect(entries[0].action).toBe('telegram_command');
      expect(entries[0].agent).toBe('captain');
      expect(entries[0].details).toEqual({
        command: '/hunter',
        args: 'Search for something',
      });
    });

    it('should log error', () => {
      hooks.log_error('gateway', 'Database connection failed', { endpoint: '/api/tasks' });
      const entries = get_all_activities(logger);
      expect(entries).toHaveLength(1);
      expect(entries[0].action).toBe('error');
      expect(entries[0].risk_level).toBe('high');
      expect(entries[0].details).toEqual({
        message: 'Database connection failed',
        endpoint: '/api/tasks',
      });
    });
  });

  // === Gateway integration tests ===

  describe('Gateway server with activity_logger', () => {
    let store: TaskStore;
    let app: ReturnType<typeof create_app>;

    beforeEach(() => {
      store = create_task_store({ db_path: ':memory:' });
      app = create_app(store, {
        dev_mode: true,
        activity_logger: logger,
      });
    });

    afterEach(() => {
      store.close();
    });

    it('should log task creation via POST /api/tasks', async () => {
      await request(app).post('/api/tasks').send({
        title: 'Test activity logging',
        assigned_to: 'captain',
        risk_level: 'low',
      });

      const entries = get_all_activities(logger);
      const creation_entry = entries.find((e) => e.action === 'task_created');
      expect(creation_entry).toBeDefined();
      expect(creation_entry!.details.title).toBe('Test activity logging');
      expect(creation_entry!.details.assigned_to).toBe('captain');
    });

    it('should log task completion via POST /api/tasks/:id/complete', async () => {
      // Create a task first
      const create_res = await request(app).post('/api/tasks').send({
        title: 'Task to complete',
        assigned_to: 'captain',
      });
      const task_id = create_res.body.id;

      await request(app).post(`/api/tasks/${task_id}/complete`).send({
        summary: 'All done',
      });

      const entries = get_all_activities(logger);
      const complete_entry = entries.find((e) => e.action === 'task_completed');
      expect(complete_entry).toBeDefined();
      expect(complete_entry!.details.task_id).toBe(task_id);
    });

    it('should log task block via POST /api/tasks/:id/block', async () => {
      const create_res = await request(app).post('/api/tasks').send({
        title: 'Task to block',
        assigned_to: 'captain',
      });
      const task_id = create_res.body.id;

      await request(app).post(`/api/tasks/${task_id}/block`).send({
        reason: 'Dependency missing',
      });

      const entries = get_all_activities(logger);
      const block_entry = entries.find((e) => e.action === 'task_failed');
      expect(block_entry).toBeDefined();
      expect(block_entry!.details.reason).toBe('Dependency missing');
    });

    it('should log hunter heartbeat via POST /api/hunter/heartbeat', async () => {
      await request(app).post('/api/hunter/heartbeat');

      const entries = get_all_activities(logger);
      const hb_entry = entries.find((e) => e.action === 'hunter_heartbeat');
      expect(hb_entry).toBeDefined();
      expect(hb_entry!.agent).toBe('hunter');
    });

    it('should log errors on invalid requests', async () => {
      // Missing required fields
      await request(app).post('/api/tasks').send({});

      const entries = get_all_activities(logger);
      const error_entry = entries.find((e) => e.action === 'error');
      expect(error_entry).toBeDefined();
      expect(error_entry!.details.endpoint).toBe('/api/tasks');
    });

    it('should not break when no activity_logger is provided', async () => {
      // Create app without logger
      const plain_app = create_app(store, { dev_mode: true });
      const res = await request(plain_app).post('/api/tasks').send({
        title: 'No logger test',
        assigned_to: 'captain',
      });
      expect(res.status).toBe(201);
    });
  });
});
