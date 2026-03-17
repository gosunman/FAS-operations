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
//
// Security (NotebookLM review response):
//   - Hunter API key authentication (Defense in Depth)
//   - Rate limiting on hunter endpoints (Prompt Injection defense)
//   - Schema validation on hunter result submission
//   - PII quarantine strategy (reject & quarantine instead of auto-sanitize)

import express from 'express';
import { create_task_store, type TaskStore } from './task_store.js';
import { sanitize_task, contains_pii, sanitize_text, detect_pii_types } from './sanitizer.js';
import { create_rate_limiter, type RateLimiter } from './rate_limiter.js';
import type { Request, Response, NextFunction } from 'express';
import type { TaskStatus } from '../shared/types.js';

// === Hunter API security constants ===

const HUNTER_API_KEY_HEADER = 'x-hunter-api-key';
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;  // 1 minute
const DEFAULT_RATE_LIMIT_MAX = 30;            // 30 requests per minute
const DEFAULT_MAX_OUTPUT_LENGTH = 50_000;     // 50KB text output limit
const DEFAULT_MAX_FILES_COUNT = 20;           // Max files per result
const MAX_FILE_PATH_LENGTH = 500;             // Max length for each file path
const BODY_SIZE_LIMIT = '100kb';              // Max request body size

// Allowed file extensions for hunter result files (deny by default)
const ALLOWED_FILE_EXTENSIONS = new Set([
  '.md', '.txt', '.json', '.csv', '.html', '.htm', '.xml', '.yaml', '.yml', '.log',
]);

// === App configuration options ===

export type AppOptions = {
  hunter_api_key?: string;          // If set, require for /api/hunter/* (Defense in Depth)
  rate_limit_window_ms?: number;    // Rate limit window (default: 60s)
  rate_limit_max_requests?: number; // Max requests per window (default: 30)
  max_output_length?: number;       // Max hunter output text length (default: 50KB)
  max_files_count?: number;         // Max files per result (default: 20)
};

// === Create Express app ===

export const create_app = (store: TaskStore, options: AppOptions = {}) => {
  const app = express();
  app.use(express.json({ limit: BODY_SIZE_LIMIT }));

  // Track hunter heartbeat
  let last_hunter_heartbeat: Date | null = null;
  const start_time = Date.now();

  // Rate limiter for hunter endpoints
  const hunter_rate_limiter = create_rate_limiter({
    window_ms: options.rate_limit_window_ms ?? DEFAULT_RATE_LIMIT_WINDOW_MS,
    max_requests: options.rate_limit_max_requests ?? DEFAULT_RATE_LIMIT_MAX,
  });

  const max_output_length = options.max_output_length ?? DEFAULT_MAX_OUTPUT_LENGTH;
  const max_files_count = options.max_files_count ?? DEFAULT_MAX_FILES_COUNT;

  // === Hunter API key authentication middleware ===
  // Defense in Depth: even with Tailscale network auth, require app-level key
  const hunter_auth = (req: Request, res: Response, next: NextFunction): void => {
    if (!options.hunter_api_key) {
      // No key configured — skip auth (development mode)
      next();
      return;
    }

    const provided_key = req.headers[HUNTER_API_KEY_HEADER] as string | undefined;
    if (provided_key !== options.hunter_api_key) {
      console.warn(`[SECURITY] Hunter auth failed from ${req.ip} — invalid or missing API key`);
      res.status(401).json({ error: 'Invalid or missing API key' });
      return;
    }
    next();
  };

  // === Hunter rate limiting middleware ===
  const hunter_rate_limit = (_req: Request, res: Response, next: NextFunction): void => {
    if (!hunter_rate_limiter.is_allowed()) {
      console.warn('[SECURITY] Hunter rate limit exceeded');
      res.status(429).json({
        error: 'Rate limit exceeded',
        retry_after_ms: options.rate_limit_window_ms ?? DEFAULT_RATE_LIMIT_WINDOW_MS,
      });
      return;
    }
    next();
  };

  // Apply auth + rate limit to all hunter endpoints
  app.use('/api/hunter', hunter_auth, hunter_rate_limit);

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

  // === Hunter API (sanitized, authenticated, rate-limited) ===

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

  // Submit hunter task result (with schema validation + PII quarantine)
  app.post('/api/hunter/tasks/:id/result', (req, res) => {
    const { status: result_status, output, files } = req.body;

    // --- Schema validation ---

    // Validate result_status
    if (result_status !== 'success' && result_status !== 'failure') {
      res.status(400).json({ error: 'status must be "success" or "failure"' });
      return;
    }

    // Validate output type and length
    if (output !== undefined && typeof output !== 'string') {
      res.status(400).json({ error: 'output must be a string' });
      return;
    }
    if (typeof output === 'string' && output.length > max_output_length) {
      res.status(400).json({
        error: `output exceeds max length (${max_output_length} chars)`,
        max_length: max_output_length,
      });
      return;
    }

    // Validate files array
    if (files !== undefined) {
      if (!Array.isArray(files)) {
        res.status(400).json({ error: 'files must be an array of strings' });
        return;
      }
      if (files.length > max_files_count) {
        res.status(400).json({
          error: `files array exceeds max count (${max_files_count})`,
          max_count: max_files_count,
        });
        return;
      }

      // Validate each file entry
      for (const file of files) {
        if (typeof file !== 'string') {
          res.status(400).json({ error: 'each file entry must be a string' });
          return;
        }
        if (file.length > MAX_FILE_PATH_LENGTH) {
          res.status(400).json({ error: `file path exceeds max length (${MAX_FILE_PATH_LENGTH})` });
          return;
        }
        // Block path traversal attempts
        if (file.includes('..') || file.startsWith('/')) {
          res.status(400).json({ error: 'file paths must not contain ".." or start with "/"' });
          return;
        }
        // Check file extension against allowlist
        const ext = file.substring(file.lastIndexOf('.')).toLowerCase();
        if (file.includes('.') && !ALLOWED_FILE_EXTENSIONS.has(ext)) {
          res.status(400).json({
            error: `file extension "${ext}" is not allowed`,
            allowed: [...ALLOWED_FILE_EXTENSIONS],
          });
          return;
        }
      }
    }

    // --- PII quarantine check ---

    const raw_output = output || (result_status === 'success' ? 'Completed' : 'Failed');

    if (contains_pii(raw_output)) {
      // Quarantine: do NOT save raw PII. Store sanitized preview for human review.
      const detected = detect_pii_types(raw_output);
      const sanitized_preview = sanitize_text(raw_output);

      console.warn(
        `[SECURITY] Hunter task ${req.params.id} output contains PII ` +
        `(${detected.join(', ')}) — quarantined for human review`
      );

      store.quarantine_task(req.params.id, sanitized_preview, detected);

      // Return 202 Accepted — result received but quarantined, not approved
      res.status(202).json({
        ok: false,
        quarantined: true,
        reason: 'PII detected in output — quarantined for human review',
        detected_types: detected,
      });
      return;
    }

    // --- Normal processing (no PII detected) ---

    if (result_status === 'success') {
      store.complete_task(req.params.id, {
        summary: raw_output,
        files_created: files ?? [],
      });
    } else {
      store.block_task(req.params.id, raw_output);
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

  // Expose rate limiter for testing
  return Object.assign(app, { _hunter_rate_limiter: hunter_rate_limiter });
};

// === Start server (when run directly) ===

const is_main = import.meta.url === `file://${process.argv[1]}`;

if (is_main) {
  const port = parseInt(process.env.GATEWAY_PORT ?? '3100', 10);
  const host = process.env.GATEWAY_HOST ?? '0.0.0.0';

  const store = create_task_store({
    db_path: './state/tasks.sqlite',
  });

  const app = create_app(store, {
    hunter_api_key: process.env.HUNTER_API_KEY,
  });

  app.listen(port, host, () => {
    console.log(`[Gateway] FAS Gateway + Task API listening on ${host}:${port}`);
    if (process.env.HUNTER_API_KEY) {
      console.log('[Gateway] Hunter API key authentication: ENABLED');
    } else {
      console.warn('[Gateway] Hunter API key authentication: DISABLED (set HUNTER_API_KEY to enable)');
    }
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('[Gateway] Shutting down...');
    store.close();
    process.exit(0);
  });
}
