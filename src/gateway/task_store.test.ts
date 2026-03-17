// TDD tests for SQLite task store
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { create_task_store, type TaskStore } from './task_store.js';

describe('TaskStore', () => {
  let store: TaskStore;

  beforeEach(() => {
    // Use in-memory database for each test
    store = create_task_store({ db_path: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  // === create() ===

  describe('create()', () => {
    it('should create a task with generated id and pending status', () => {
      const task = store.create({
        title: 'Crawl K-Startup',
        assigned_to: 'gemini_a',
      });

      expect(task.id).toBeDefined();
      expect(task.id.length).toBe(36); // UUID v4
      expect(task.title).toBe('Crawl K-Startup');
      expect(task.assigned_to).toBe('gemini_a');
      expect(task.status).toBe('pending');
      expect(task.priority).toBe('medium');
      expect(task.risk_level).toBe('low');
      expect(task.requires_personal_info).toBe(false);
      expect(task.depends_on).toEqual([]);
      expect(task.created_at).toBeDefined();
    });

    it('should create a task with all optional fields', () => {
      const task = store.create({
        title: 'Generate test paper',
        description: 'Physics unit 3 for advanced class',
        priority: 'high',
        assigned_to: 'claude',
        mode: 'awake',
        risk_level: 'mid',
        requires_personal_info: true,
        deadline: '2026-03-20',
        depends_on: ['task_001'],
      });

      expect(task.description).toBe('Physics unit 3 for advanced class');
      expect(task.priority).toBe('high');
      expect(task.mode).toBe('awake');
      expect(task.risk_level).toBe('mid');
      expect(task.requires_personal_info).toBe(true);
      expect(task.deadline).toBe('2026-03-20');
      expect(task.depends_on).toEqual(['task_001']);
    });
  });

  // === get_by_id() ===

  describe('get_by_id()', () => {
    it('should return task by id', () => {
      const created = store.create({ title: 'Test', assigned_to: 'claude' });
      const found = store.get_by_id(created.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.title).toBe('Test');
    });

    it('should return null for non-existent id', () => {
      const found = store.get_by_id('non-existent');
      expect(found).toBeNull();
    });
  });

  // === get_by_status() ===

  describe('get_by_status()', () => {
    it('should return tasks filtered by status', () => {
      store.create({ title: 'Task A', assigned_to: 'claude' });
      store.create({ title: 'Task B', assigned_to: 'gemini_a' });
      const task_c = store.create({ title: 'Task C', assigned_to: 'claude' });
      store.update_status(task_c.id, 'in_progress');

      const pending = store.get_by_status('pending');
      const in_progress = store.get_by_status('in_progress');

      expect(pending.length).toBe(2);
      expect(in_progress.length).toBe(1);
      expect(in_progress[0].title).toBe('Task C');
    });
  });

  // === get_pending_for_agent() ===

  describe('get_pending_for_agent()', () => {
    it('should return only pending tasks for specified agent', () => {
      store.create({ title: 'Claude task', assigned_to: 'claude' });
      store.create({ title: 'Gemini task', assigned_to: 'gemini_a' });
      const done_task = store.create({ title: 'Done Claude task', assigned_to: 'claude' });
      store.complete_task(done_task.id, { summary: 'Done' });

      const claude_pending = store.get_pending_for_agent('claude');

      expect(claude_pending.length).toBe(1);
      expect(claude_pending[0].title).toBe('Claude task');
    });
  });

  // === update_status() ===

  describe('update_status()', () => {
    it('should update task status', () => {
      const task = store.create({ title: 'Test', assigned_to: 'claude' });

      const result = store.update_status(task.id, 'in_progress');
      expect(result).toBe(true);

      const updated = store.get_by_id(task.id);
      expect(updated!.status).toBe('in_progress');
    });

    it('should return false for non-existent task', () => {
      const result = store.update_status('non-existent', 'done');
      expect(result).toBe(false);
    });
  });

  // === complete_task() ===

  describe('complete_task()', () => {
    it('should mark task as done with output', () => {
      const task = store.create({ title: 'Research', assigned_to: 'gemini_a' });

      const result = store.complete_task(task.id, {
        summary: 'Found 5 startup programs',
        files_created: ['reports/startup_2026-03-17.md'],
      });

      expect(result).toBe(true);

      const completed = store.get_by_id(task.id);
      expect(completed!.status).toBe('done');
      expect(completed!.output).toBeDefined();
      expect(completed!.output!.summary).toBe('Found 5 startup programs');
      expect(completed!.output!.files_created).toEqual(['reports/startup_2026-03-17.md']);
      expect(completed!.completed_at).toBeDefined();
    });
  });

  // === block_task() ===

  describe('block_task()', () => {
    it('should mark task as blocked with reason', () => {
      const task = store.create({ title: 'Deploy', assigned_to: 'claude' });

      store.block_task(task.id, 'API key missing');

      const blocked = store.get_by_id(task.id);
      expect(blocked!.status).toBe('blocked');
      expect(blocked!.output!.summary).toBe('API key missing');
    });
  });

  // === get_stats() ===

  describe('get_stats()', () => {
    it('should return task counts by status', () => {
      store.create({ title: 'A', assigned_to: 'claude' });
      store.create({ title: 'B', assigned_to: 'claude' });
      const c = store.create({ title: 'C', assigned_to: 'claude' });
      store.complete_task(c.id, { summary: 'Done' });
      const d = store.create({ title: 'D', assigned_to: 'claude' });
      store.block_task(d.id, 'Blocked');

      const stats = store.get_stats();

      expect(stats.pending).toBe(2);
      expect(stats.done).toBe(1);
      expect(stats.blocked).toBe(1);
    });
  });

  // === get_all() ===

  describe('get_all()', () => {
    it('should return all tasks', () => {
      store.create({ title: 'First', assigned_to: 'claude' });
      store.create({ title: 'Second', assigned_to: 'claude' });

      const all = store.get_all();

      expect(all.length).toBe(2);
      const titles = all.map((t) => t.title);
      expect(titles).toContain('First');
      expect(titles).toContain('Second');
    });
  });
});
