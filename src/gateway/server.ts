// FAS Gateway + Task API Server
// Port 3100 — Tailscale internal only
//
// Routes:
//   POST   /api/tasks              — Create a new task
//   GET    /api/tasks              — List all tasks (with optional status filter)
//   GET    /api/tasks/:id          — Get task by ID
//   PATCH  /api/tasks/:id/status   — Update task status
//   POST   /api/tasks/:id/complete — Mark task as done with output
//   POST   /api/tasks/:id/block    — Mark task as blocked
//
//   GET    /api/hunter/tasks/pending — Get pending tasks for hunter (sanitized)
//   POST   /api/hunter/tasks/:id/result — Submit hunter task result
//   POST   /api/hunter/heartbeat   — Hunter heartbeat
//
//   GET    /api/health             — Health check
//   GET    /api/stats              — Task statistics

import express from 'express';
import { create_task_store, type TaskStore } from './task_store.js';
import { sanitize_task, contains_pii, sanitize_text } from './sanitizer.js';
import type { TaskStatus } from '../shared/types.js';

// === Create Express app ===

export const create_app = (store: TaskStore) => {
  const app = express();
  app.use(express.json());

  // Track hunter heartbeat
  let last_hunter_heartbeat: Date | null = null;
  const start_time = Date.now();

  // === Task CRUD ===

  // Create a new task
  app.post('/api/tasks', (req, res) => {
    try {
      const { title, description, priority, assigned_to, mode, risk_level, requires_personal_info, deadline, depends_on } = req.body;

      if (!title || !assigned_to) {
        res.status(400).json({ error: 'title and assigned_to are required' });
        return;
      }

      const task = store.create({
        title,
        description,
        priority,
        assigned_to,
        mode,
        risk_level,
        requires_personal_info,
        deadline,
        depends_on,
      });

      res.status(201).json(task);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create task' });
    }
  });

  // List tasks (optional ?status=pending filter)
  app.get('/api/tasks', (_req, res) => {
    try {
      const status = _req.query.status as TaskStatus | undefined;
      const tasks = status ? store.get_by_status(status) : store.get_all();
      res.json({ tasks, count: tasks.length });
    } catch (error) {
      res.status(500).json({ error: 'Failed to list tasks' });
    }
  });

  // Get task by ID
  app.get('/api/tasks/:id', (req, res) => {
    const task = store.get_by_id(req.params.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json(task);
  });

  // Update task status
  app.patch('/api/tasks/:id/status', (req, res) => {
    const { status } = req.body;
    if (!status) {
      res.status(400).json({ error: 'status is required' });
      return;
    }
    const ok = store.update_status(req.params.id, status);
    if (!ok) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json(store.get_by_id(req.params.id));
  });

  // Complete a task
  app.post('/api/tasks/:id/complete', (req, res) => {
    const { summary, files_created } = req.body;
    if (!summary) {
      res.status(400).json({ error: 'summary is required' });
      return;
    }
    const ok = store.complete_task(req.params.id, { summary, files_created });
    if (!ok) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json(store.get_by_id(req.params.id));
  });

  // Block a task
  app.post('/api/tasks/:id/block', (req, res) => {
    const { reason } = req.body;
    if (!reason) {
      res.status(400).json({ error: 'reason is required' });
      return;
    }
    const ok = store.block_task(req.params.id, reason);
    if (!ok) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json(store.get_by_id(req.params.id));
  });

  // === Hunter API (sanitized) ===

  // Get pending tasks for hunter (PII removed)
  app.get('/api/hunter/tasks/pending', (_req, res) => {
    try {
      const tasks = store.get_pending_for_agent('openclaw');
      const sanitized = tasks
        .filter((t) => !t.requires_personal_info) // never send PII tasks to hunter
        .map(sanitize_task);
      res.json({ tasks: sanitized, count: sanitized.length });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get hunter tasks' });
    }
  });

  // Submit hunter task result (with reverse PII check)
  app.post('/api/hunter/tasks/:id/result', (req, res) => {
    const { status: result_status, output, files } = req.body;

    // Reverse PII check: sanitize any personal info in hunter's output
    let safe_output = output || (result_status === 'success' ? 'Completed' : 'Failed');
    if (contains_pii(safe_output)) {
      console.warn(`[SECURITY] Hunter task ${req.params.id} output contains PII — sanitizing`);
      safe_output = sanitize_text(safe_output);
    }

    if (result_status === 'success') {
      store.complete_task(req.params.id, {
        summary: safe_output,
        files_created: files ?? [],
      });
    } else {
      store.block_task(req.params.id, safe_output);
    }

    res.json({ ok: true });
  });

  // Hunter heartbeat
  app.post('/api/hunter/heartbeat', (_req, res) => {
    last_hunter_heartbeat = new Date();
    res.json({ ok: true, server_time: new Date().toISOString() });
  });

  // === System ===

  // Health check
  app.get('/api/health', (_req, res) => {
    const uptime_seconds = Math.floor((Date.now() - start_time) / 1000);
    const hunter_alive = last_hunter_heartbeat
      ? Date.now() - last_hunter_heartbeat.getTime() < 60_000
      : false;

    res.json({
      status: 'ok',
      mode: process.env.FAS_MODE ?? 'awake',
      uptime_seconds,
      hunter_alive,
      timestamp: new Date().toISOString(),
    });
  });

  // Task statistics
  app.get('/api/stats', (_req, res) => {
    res.json(store.get_stats());
  });

  return app;
};

// === Start server (when run directly) ===

const is_main = import.meta.url === `file://${process.argv[1]}`;

if (is_main) {
  const port = parseInt(process.env.GATEWAY_PORT ?? '3100', 10);
  const host = process.env.GATEWAY_HOST ?? '0.0.0.0';

  const store = create_task_store({
    db_path: './state/tasks.sqlite',
  });

  const app = create_app(store);

  app.listen(port, host, () => {
    console.log(`[Gateway] FAS Gateway + Task API listening on ${host}:${port}`);
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('[Gateway] Shutting down...');
    store.close();
    process.exit(0);
  });
}
