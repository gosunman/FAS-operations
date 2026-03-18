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
//   POST   /api/agents/:name/heartbeat — Agent heartbeat (generic)
//   GET    /api/agents/health      — All agent statuses
//   POST   /api/agents/:name/crash — Report agent crash
//
//   GET    /api/mode               — Current SLEEP/AWAKE mode
//   POST   /api/mode               — Switch mode
//
//   POST   /api/approval/request   — Request cross-approval for an action
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
import { create_cross_approval, type CrossApproval } from './cross_approval.js';
import { create_mode_manager, type ModeManager, type ModeManagerConfig } from './mode_manager.js';
import type { Request, Response, NextFunction } from 'express';
import { FASError } from '../shared/types.js';
import type { TaskStatus, FasMode, AgentHealthInfo, CrossApprovalConfig, RiskLevel } from '../shared/types.js';

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
  dev_mode?: boolean;               // If true, skip auth when no key is configured (testing only)
  rate_limit_window_ms?: number;    // Rate limit window (default: 60s)
  rate_limit_max_requests?: number; // Max requests per window (default: 30)
  max_output_length?: number;       // Max hunter output text length (default: 50KB)
  max_files_count?: number;         // Max files per result (default: 20)
  cross_approval_config?: CrossApprovalConfig;  // Gemini CLI cross-approval config
  mode_config?: ModeManagerConfig;              // SLEEP/AWAKE mode config
};

// === Create Express app ===

export const create_app = (store: TaskStore, options: AppOptions = {}) => {
  const app = express();
  app.use(express.json({ limit: BODY_SIZE_LIMIT }));

  // Track hunter heartbeat (legacy, also tracked in agent_heartbeats)
  let last_hunter_heartbeat: Date | null = null;
  const start_time = Date.now();

  // Agent heartbeat tracker — generic for all agents
  const agent_heartbeats = new Map<string, {
    last_heartbeat: Date;
    crash_count: number;
    started_at: Date;
  }>();

  // Mode manager — SLEEP/AWAKE state
  const mode_manager = create_mode_manager(options.mode_config ?? {
    sleep_start_hour: 23,
    sleep_end_hour: 7,
    sleep_end_minute: 30,
  });

  // Cross-approval — Gemini CLI for MID risk actions
  const cross_approval = options.cross_approval_config
    ? create_cross_approval(options.cross_approval_config)
    : null;

  // Rate limiter for hunter endpoints
  const hunter_rate_limiter = create_rate_limiter({
    window_ms: options.rate_limit_window_ms ?? DEFAULT_RATE_LIMIT_WINDOW_MS,
    max_requests: options.rate_limit_max_requests ?? DEFAULT_RATE_LIMIT_MAX,
  });

  const max_output_length = options.max_output_length ?? DEFAULT_MAX_OUTPUT_LENGTH;
  const max_files_count = options.max_files_count ?? DEFAULT_MAX_FILES_COUNT;

  // === Hunter API key authentication middleware ===
  // Defense in Depth: even with Tailscale network auth, require app-level key
  // No key + no dev_mode = reject all hunter requests (secure by default)
  const hunter_auth = (req: Request, res: Response, next: NextFunction): void => {
    if (!options.hunter_api_key) {
      if (options.dev_mode) {
        // No key configured + dev mode — skip auth (testing only)
        next();
        return;
      }
      // No key configured + production — reject (secure by default)
      console.error('[SECURITY] Hunter API key not configured — rejecting request');
      const err = new FASError('AUTH_ERROR', 'Hunter API key not configured on server', 401);
      res.status(401).json(err.to_json());
      return;
    }

    const provided_key = req.headers[HUNTER_API_KEY_HEADER] as string | undefined;
    if (!provided_key) {
      console.warn(`[SECURITY] Hunter auth failed from ${req.ip} — missing API key`);
      const err = new FASError('AUTH_ERROR', 'API key is required in x-hunter-api-key header', 401);
      res.status(401).json(err.to_json());
      return;
    }
    if (provided_key !== options.hunter_api_key) {
      console.warn(`[SECURITY] Hunter auth failed from ${req.ip} — invalid API key`);
      const err = new FASError('AUTH_ERROR', 'Invalid API key', 401);
      res.status(401).json(err.to_json());
      return;
    }
    next();
  };

  // === Hunter rate limiting middleware ===
  const hunter_rate_limit = (_req: Request, res: Response, next: NextFunction): void => {
    if (!hunter_rate_limiter.is_allowed()) {
      console.warn('[SECURITY] Hunter rate limit exceeded');
      const retry_after_ms = options.rate_limit_window_ms ?? DEFAULT_RATE_LIMIT_WINDOW_MS;
      const err = new FASError('RATE_LIMIT', 'Rate limit exceeded', 429, { retry_after_ms });
      res.status(429).json(err.to_json());
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
        const err = new FASError('VALIDATION_ERROR', 'title and assigned_to are required', 400);
        res.status(400).json(err.to_json());
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
      const err = new FASError('INTERNAL_ERROR', 'Failed to create task', 500);
      res.status(500).json(err.to_json());
    }
  });

  // List tasks (optional ?status=pending filter)
  app.get('/api/tasks', (_req, res) => {
    try {
      const status = _req.query.status as TaskStatus | undefined;
      const tasks = status ? store.get_by_status(status) : store.get_all();
      res.json({ tasks, count: tasks.length });
    } catch (error) {
      const err = new FASError('INTERNAL_ERROR', 'Failed to list tasks', 500);
      res.status(500).json(err.to_json());
    }
  });

  // Get task by ID
  app.get('/api/tasks/:id', (req, res) => {
    const task = store.get_by_id(req.params.id);
    if (!task) {
      res.status(404).json(new FASError('NOT_FOUND', 'Task not found', 404).to_json());
      return;
    }
    res.json(task);
  });

  // Update task status
  app.patch('/api/tasks/:id/status', (req, res) => {
    const { status } = req.body;
    if (!status) {
      res.status(400).json(new FASError('VALIDATION_ERROR', 'status is required', 400).to_json());
      return;
    }
    const ok = store.update_status(req.params.id, status);
    if (!ok) {
      res.status(404).json(new FASError('NOT_FOUND', 'Task not found', 404).to_json());
      return;
    }
    res.json(store.get_by_id(req.params.id));
  });

  // Complete a task
  app.post('/api/tasks/:id/complete', (req, res) => {
    const { summary, files_created } = req.body;
    if (!summary) {
      res.status(400).json(new FASError('VALIDATION_ERROR', 'summary is required', 400).to_json());
      return;
    }
    const ok = store.complete_task(req.params.id, { summary, files_created });
    if (!ok) {
      res.status(404).json(new FASError('NOT_FOUND', 'Task not found', 404).to_json());
      return;
    }
    res.json(store.get_by_id(req.params.id));
  });

  // Block a task
  app.post('/api/tasks/:id/block', (req, res) => {
    const { reason } = req.body;
    if (!reason) {
      res.status(400).json(new FASError('VALIDATION_ERROR', 'reason is required', 400).to_json());
      return;
    }
    const ok = store.block_task(req.params.id, reason);
    if (!ok) {
      res.status(404).json(new FASError('NOT_FOUND', 'Task not found', 404).to_json());
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
      res.status(500).json(new FASError('INTERNAL_ERROR', 'Failed to get hunter tasks', 500).to_json());
    }
  });

  // Submit hunter task result (with schema validation + PII quarantine)
  app.post('/api/hunter/tasks/:id/result', (req, res) => {
    const { status: result_status, output, files } = req.body;

    // --- Schema validation ---

    // Validate result_status
    if (result_status !== 'success' && result_status !== 'failure') {
      res.status(400).json(new FASError('VALIDATION_ERROR', 'status must be "success" or "failure"', 400).to_json());
      return;
    }

    // Validate output type and length
    if (output !== undefined && typeof output !== 'string') {
      res.status(400).json(new FASError('VALIDATION_ERROR', 'output must be a string', 400).to_json());
      return;
    }
    if (typeof output === 'string' && output.length > max_output_length) {
      res.status(400).json(new FASError('VALIDATION_ERROR', `output exceeds max length (${max_output_length} chars)`, 400, { max_length: max_output_length }).to_json());
      return;
    }

    // Validate files array
    if (files !== undefined) {
      if (!Array.isArray(files)) {
        res.status(400).json(new FASError('VALIDATION_ERROR', 'files must be an array of strings', 400).to_json());
        return;
      }
      if (files.length > max_files_count) {
        res.status(400).json(new FASError('VALIDATION_ERROR', `files array exceeds max count (${max_files_count})`, 400, { max_count: max_files_count }).to_json());
        return;
      }

      // Validate each file entry
      for (const file of files) {
        if (typeof file !== 'string') {
          res.status(400).json(new FASError('VALIDATION_ERROR', 'each file entry must be a string', 400).to_json());
          return;
        }
        if (file.length > MAX_FILE_PATH_LENGTH) {
          res.status(400).json(new FASError('VALIDATION_ERROR', `file path exceeds max length (${MAX_FILE_PATH_LENGTH})`, 400).to_json());
          return;
        }
        // Block path traversal attempts
        if (file.includes('..') || file.startsWith('/')) {
          res.status(400).json(new FASError('VALIDATION_ERROR', 'file paths must not contain ".." or start with "/"', 400).to_json());
          return;
        }
        // Check file extension against allowlist
        const ext = file.substring(file.lastIndexOf('.')).toLowerCase();
        if (file.includes('.') && !ALLOWED_FILE_EXTENSIONS.has(ext)) {
          res.status(400).json(new FASError('VALIDATION_ERROR', `file extension "${ext}" is not allowed`, 400, { allowed: [...ALLOWED_FILE_EXTENSIONS] }).to_json());
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

  // Hunter heartbeat (legacy endpoint — also updates agent_heartbeats)
  app.post('/api/hunter/heartbeat', (_req, res) => {
    last_hunter_heartbeat = new Date();
    const existing = agent_heartbeats.get('openclaw');
    agent_heartbeats.set('openclaw', {
      last_heartbeat: new Date(),
      crash_count: existing?.crash_count ?? 0,
      started_at: existing?.started_at ?? new Date(),
    });
    res.json({ ok: true, server_time: new Date().toISOString() });
  });

  // === Agent Healthcheck API ===

  // Generic agent heartbeat
  app.post('/api/agents/:name/heartbeat', (req, res) => {
    const { name } = req.params;
    const existing = agent_heartbeats.get(name);
    agent_heartbeats.set(name, {
      last_heartbeat: new Date(),
      crash_count: existing?.crash_count ?? 0,
      started_at: existing?.started_at ?? new Date(),
    });
    res.json({ ok: true, server_time: new Date().toISOString() });
  });

  // All agent statuses
  app.get('/api/agents/health', (_req, res) => {
    const HEARTBEAT_TIMEOUT_MS = 60_000;
    const agents: AgentHealthInfo[] = [];
    for (const [name, info] of agent_heartbeats) {
      const alive = Date.now() - info.last_heartbeat.getTime() < HEARTBEAT_TIMEOUT_MS;
      agents.push({
        name: name as AgentHealthInfo['name'],
        status: alive ? 'running' : 'crashed',
        last_heartbeat: info.last_heartbeat.toISOString(),
        uptime_seconds: Math.floor((Date.now() - info.started_at.getTime()) / 1000),
        crash_count: info.crash_count,
      });
    }
    res.json({ agents, timestamp: new Date().toISOString() });
  });

  // Report agent crash (watchdog calls this)
  app.post('/api/agents/:name/crash', (req, res) => {
    const { name } = req.params;
    const existing = agent_heartbeats.get(name);
    if (existing) {
      existing.crash_count += 1;
    } else {
      agent_heartbeats.set(name, {
        last_heartbeat: new Date(0),
        crash_count: 1,
        started_at: new Date(),
      });
    }
    res.json({ ok: true, crash_count: agent_heartbeats.get(name)!.crash_count });
  });

  // === Mode Management API (Phase 3) ===

  // Get current mode
  app.get('/api/mode', (_req, res) => {
    res.json(mode_manager.get_state());
  });

  // Switch mode
  app.post('/api/mode', (req, res) => {
    const { target_mode, reason, requested_by } = req.body;
    if (target_mode !== 'sleep' && target_mode !== 'awake') {
      res.status(400).json(new FASError('VALIDATION_ERROR', 'target_mode must be "sleep" or "awake"', 400).to_json());
      return;
    }
    const result = mode_manager.transition({
      target_mode,
      reason: reason ?? '',
      requested_by: requested_by ?? 'api',
    });
    res.json(result);
  });

  // === Cross-Approval API (Phase 2) ===

  // Request cross-approval for an action
  app.post('/api/approval/request', async (req, res) => {
    const { action, context, risk_level } = req.body;

    if (!action || !risk_level) {
      res.status(400).json(new FASError('VALIDATION_ERROR', 'action and risk_level are required', 400).to_json());
      return;
    }

    // Check mode restriction first
    if (!mode_manager.is_action_allowed(action, risk_level as RiskLevel)) {
      res.status(403).json(new FASError('MODE_VIOLATION',
        `Action "${action}" is not allowed in ${mode_manager.get_state().current_mode} mode`, 403).to_json());
      return;
    }

    // LOW risk → auto-approve
    if (risk_level === 'low') {
      res.json({ decision: 'approved', reason: 'Low risk — auto-approved', reviewed_by: 'system' });
      return;
    }

    // HIGH/CRITICAL → needs human approval
    if (risk_level === 'high' || risk_level === 'critical') {
      res.json({ decision: 'needs_human_approval', reason: `${risk_level} risk requires human approval via Telegram` });
      return;
    }

    // MID risk → Gemini cross-approval
    if (!cross_approval) {
      // No Gemini configured — auto-approve with warning
      res.json({ decision: 'approved', reason: 'Mid risk — auto-approved (no cross-approval configured)', reviewed_by: 'system' });
      return;
    }

    try {
      const result = await cross_approval.request_approval(action, context ?? '');
      if (result.decision === 'rejected') {
        res.status(403).json(new FASError('CROSS_APPROVAL_REJECTED', result.reason, 403, {
          reviewed_by: result.reviewed_by,
        }).to_json());
        return;
      }
      res.json(result);
    } catch {
      res.status(500).json(new FASError('INTERNAL_ERROR', 'Cross-approval request failed', 500).to_json());
    }
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
      mode: mode_manager.get_state().current_mode,
      uptime_seconds,
      hunter_alive,
      timestamp: new Date().toISOString(),
    });
  });

  // Task statistics
  app.get('/api/stats', (_req, res) => {
    res.json(store.get_stats());
  });

  // Expose internals for testing
  return Object.assign(app, {
    _hunter_rate_limiter: hunter_rate_limiter,
    _mode_manager: mode_manager,
    _agent_heartbeats: agent_heartbeats,
  });
};

// === Start server (when run directly) ===

const is_main = import.meta.url === `file://${process.argv[1]}`;

if (is_main) {
  const port = parseInt(process.env.GATEWAY_PORT ?? '3100', 10);
  const host = process.env.GATEWAY_HOST ?? '0.0.0.0';

  const store = create_task_store({
    db_path: './state/tasks.sqlite',
  });

  const dev_mode = process.env.NODE_ENV === 'development' || process.env.FAS_DEV_MODE === 'true';

  if (!process.env.HUNTER_API_KEY && !dev_mode) {
    console.error('[Gateway] FATAL: HUNTER_API_KEY is not set and dev mode is off. Refusing to start.');
    console.error('[Gateway] Set HUNTER_API_KEY or FAS_DEV_MODE=true to proceed.');
    process.exit(1);
  }

  const app = create_app(store, {
    hunter_api_key: process.env.HUNTER_API_KEY,
    dev_mode,
  });

  app.listen(port, host, () => {
    console.log(`[Gateway] FAS Gateway + Task API listening on ${host}:${port}`);
    if (process.env.HUNTER_API_KEY) {
      console.log('[Gateway] Hunter API key authentication: ENABLED');
    } else if (dev_mode) {
      console.warn('[Gateway] Hunter API key authentication: DISABLED (dev mode)');
    }
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('[Gateway] Shutting down...');
    store.close();
    process.exit(0);
  });
}
