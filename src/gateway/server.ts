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
//   POST   /api/n8n/planning/morning       — Trigger morning planning loop (n8n Cron)
//   POST   /api/n8n/planning/night         — Trigger night planning loop (n8n Cron)
//   POST   /api/n8n/task-result-webhook    — Route task result notification
//   GET    /api/n8n/metrics                — System metrics for n8n dashboard
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
import { sanitize_task, contains_pii, contains_critical_pii, sanitize_text, detect_pii_types, detect_pii_with_severity } from './sanitizer.js';
import { create_local_queue, type LocalQueue } from '../watchdog/local_queue.js';
import { create_rate_limiter, type RateLimiter } from './rate_limiter.js';
import { create_cross_approval, type CrossApproval } from './cross_approval.js';
import { create_security_validator } from './security_validator.js';
import { create_mode_manager, type ModeManager, type ModeManagerConfig } from './mode_manager.js';
import type { Request, Response, NextFunction } from 'express';
import { FASError } from '../shared/types.js';
import type { TaskStatus, FasMode, AgentHealthInfo, CrossApprovalConfig, RiskLevel, NotificationEvent } from '../shared/types.js';
import type { NotificationRouter } from '../notification/router.js';
import { create_logger } from './logger.js';
import type { ActivityLogger } from '../watchdog/activity_logger.js';
import { create_activity_hooks, type ActivityHooks } from '../watchdog/activity_integration.js';
import { create_n8n_routes, type N8nWebhookDeps } from './n8n_webhooks.js';
import type { PlanningLoop } from '../captain/planning_loop.js';
import type { ResultRouter } from '../pipeline/result_router.js';

// Shared logger instance for the gateway module
const log = create_logger({ prefix: 'Gateway' });

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
  notion_backup?: NotionBackupConfig | null;    // Notion backup for task results (fire-and-forget)
  notification_router?: NotificationRouter | null; // Notification router for crawl_result events
  activity_logger?: ActivityLogger | null;         // Activity logger for audit trail
  planning_loop?: PlanningLoop | null;             // Planning loop for n8n webhook integration
  result_router?: ResultRouter | null;             // Specialized result routing (grant, housing, blind, etc.)
};

// Notion backup configuration — saves completed task results to Notion as a durable backup
export type NotionBackupConfig = {
  api_key: string;
  database_id: string;    // Notion database for task results
};

// === Create Express app ===

// Fire-and-forget Notion backup for completed task results
// PII is sanitized before leaving the machine; requests are queued locally
// so network outages never lose backup data.
const create_notion_backup = (config: NotionBackupConfig) => {
  // Local queue — buffers Notion API calls and retries on failure
  const queue = create_local_queue({
    db_path: './state/notion_backup_queue.db',
    on_flush: async (request) => {
      try {
        const res = await fetch(request.endpoint, {
          method: request.method,
          headers: {
            'Authorization': `Bearer ${config.api_key}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(request.body),
        });
        if (!res.ok) {
          const err = await res.text();
          log.warn(`[Notion Backup] API ${res.status}: ${err}`);
          return false;
        }
        log.info(`[Notion Backup] Flushed queued request ${request.id}`);
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`[Notion Backup] Flush failed: ${msg}`);
        return false;
      }
    },
  });

  // Periodically flush the queue (every 30 seconds)
  const flush_interval = setInterval(() => {
    queue.flush().catch(() => {});
  }, 30_000);
  // Allow the process to exit without waiting for the interval
  if (flush_interval.unref) flush_interval.unref();

  const backup_task_result = async (task_id: string, title: string, output: string) => {
    // PII masking — never send plaintext PII to external service
    const safe_output = sanitize_text(output);

    const body = {
      parent: { database_id: config.database_id },
      properties: {
        Name: { title: [{ text: { content: `📋 [Task Result] ${title}`.slice(0, 100) } }] },
      },
      children: [
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: `Task ID: ${task_id}\nCompleted: ${new Date().toISOString()}` } }],
          },
        },
        // Split output into 2000-char chunks (Notion block limit)
        ...chunk_text(safe_output, 2000).map((chunk: string) => ({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: chunk } }],
          },
        })),
      ],
    };

    // Enqueue instead of direct fetch — survives network outages
    queue.enqueue('https://api.notion.com/v1/pages', 'POST', body);
    log.info(`[Notion Backup] Task ${task_id} enqueued for backup`);

    // Attempt immediate flush (best-effort, non-blocking)
    queue.flush().catch(() => {});
  };

  return { backup_task_result, _queue: queue };
};

// Helper: split text into chunks for Notion block limit
const chunk_text = (text: string, max: number): string[] => {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    const cut = remaining.length <= max ? remaining.length : (remaining.lastIndexOf('\n', max) > 0 ? remaining.lastIndexOf('\n', max) + 1 : max);
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }
  return chunks;
};

export const create_app = (store: TaskStore, options: AppOptions = {}) => {
  const app = express();
  app.use(express.json({ limit: BODY_SIZE_LIMIT }));

  // Notion backup (optional, fire-and-forget)
  const notion_backup = options.notion_backup
    ? create_notion_backup(options.notion_backup)
    : null;

  // Activity logging hooks (optional — audit trail for all actions)
  const activity_hooks: ActivityHooks | null = options.activity_logger
    ? create_activity_hooks(options.activity_logger)
    : null;

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

  // === Mount n8n webhook routes at /api/n8n ===
  // Requires planning_loop + notification_router; skip mount if planning_loop is unavailable
  if (options.planning_loop && options.notification_router) {
    const n8n_deps: N8nWebhookDeps = {
      planning_loop: options.planning_loop,
      router: options.notification_router,
      store,
      mode_manager,
    };
    const n8n_routes = create_n8n_routes(n8n_deps);
    app.use('/api/n8n', n8n_routes);
  }

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

  // Security validator — 5-step inspection protocol (Steps 1,2,4,5)
  const security_validator = create_security_validator();

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
      log.error('[SECURITY] Hunter API key not configured — rejecting request');
      const err = new FASError('AUTH_ERROR', 'Hunter API key not configured on server', 401);
      res.status(401).json(err.to_json());
      return;
    }

    const provided_key = req.headers[HUNTER_API_KEY_HEADER] as string | undefined;
    if (!provided_key) {
      log.warn(`[SECURITY] Hunter auth failed from ${req.ip} — missing API key`);
      const err = new FASError('AUTH_ERROR', 'API key is required in x-hunter-api-key header', 401);
      res.status(401).json(err.to_json());
      return;
    }
    if (provided_key !== options.hunter_api_key) {
      log.warn(`[SECURITY] Hunter auth failed from ${req.ip} — invalid API key`);
      const err = new FASError('AUTH_ERROR', 'Invalid API key', 401);
      res.status(401).json(err.to_json());
      return;
    }
    next();
  };

  // === Hunter rate limiting middleware ===
  const hunter_rate_limit = (_req: Request, res: Response, next: NextFunction): void => {
    if (!hunter_rate_limiter.is_allowed()) {
      log.warn('[SECURITY] Hunter rate limit exceeded');
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
        activity_hooks?.log_error('gateway', 'Validation failed: title and assigned_to are required', { endpoint: '/api/tasks' });
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

      // Activity log: task created
      activity_hooks?.log_task_created(task.id, task.title, task.assigned_to, task.risk_level);

      res.status(201).json(task);
    } catch (error) {
      activity_hooks?.log_error('gateway', 'Failed to create task', { endpoint: '/api/tasks' });
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
      activity_hooks?.log_error('gateway', 'Failed to list tasks', { endpoint: '/api/tasks' });
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

    // Activity log: task completed
    const task = store.get_by_id(req.params.id);
    if (task) {
      activity_hooks?.log_task_completed(task.id, task.title);
    }

    // Fire-and-forget Notion backup
    if (notion_backup && task) {
      notion_backup.backup_task_result(task.id, task.title, summary).catch(() => {});
    }

    res.json(task);
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

    // Activity log: task blocked/failed
    activity_hooks?.log_task_failed(req.params.id, reason);

    res.json(store.get_by_id(req.params.id));
  });

  // === Hunter API (sanitized, authenticated, rate-limited) ===

  // Get pending tasks for hunter (PII removed)
  app.get('/api/hunter/tasks/pending', (_req, res) => {
    try {
      const tasks = store.get_pending_for_agent('hunter');
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

    // --- Security validation (5-step protocol: Steps 1,2,4,5) ---
    // Must run BEFORE PII check — quarantine malicious payloads regardless of PII content
    const combined_text = [output, ...(files ?? [])].filter(Boolean).join(' ');
    const security_result = security_validator.validate_hunter_output(combined_text);

    if (!security_result.is_safe) {
      const violation_summary = security_result.violations
        .map(v => `${v.type}:${v.pattern_name}`)
        .join(', ');

      log.error(
        `[SECURITY] Hunter task ${req.params.id} output contains security violations: ${violation_summary}`
      );

      store.quarantine_task(req.params.id, `Security violations: ${violation_summary}`,
        security_result.violations.map(v => v.pattern_name));

      // Telegram alert
      if (options.notification_router) {
        const alert_event: NotificationEvent = {
          type: 'alert',
          message: `🚨 *[SECURITY QUARANTINE]* 헌터 결과물에서 악의적 패턴 감지\n*유형:* ${violation_summary}\n*Task ID:* ${req.params.id}`,
          device: 'captain',
          severity: 'critical',
        };
        options.notification_router.route(alert_event).catch(() => {});
      }

      // Return 202 — hunter sees success, but captain quarantines
      res.status(202).json({
        ok: false,
        quarantined: true,
        reason: 'Security violations detected — quarantined for human review',
        detected_types: security_result.violations.map(v => v.type),
      });
      return;
    }

    // --- PII quarantine check (Step 3) ---
    // Two-tier severity: critical PII → quarantine, warning PII → auto-sanitize and pass through

    let safe_output = output || (result_status === 'success' ? 'Completed' : 'Failed');

    if (contains_pii(safe_output)) {
      const detections = detect_pii_with_severity(safe_output);
      const detected_names = detections.map((d) => d.name);
      const has_critical = detections.some((d) => d.severity === 'critical');

      if (has_critical) {
        // Critical PII: quarantine for human review (identity-revealing data)
        const sanitized_preview = sanitize_text(safe_output);

        log.warn(
          `[SECURITY] Hunter task ${req.params.id} output contains critical PII ` +
          `(${detected_names.join(', ')}) — quarantined for human review`
        );

        store.quarantine_task(req.params.id, sanitized_preview, detected_names);

        // Return 202 Accepted — result received but quarantined, not approved
        res.status(202).json({
          ok: false,
          quarantined: true,
          reason: 'Critical PII detected in output — quarantined for human review',
          detected_types: detected_names,
        });
        return;
      }

      // Warning-only PII: auto-sanitize and allow through with a log warning
      const warning_types = detections.filter((d) => d.severity === 'warning').map((d) => d.name);
      log.warn(
        `[SECURITY] Hunter task ${req.params.id} output contains warning-level PII ` +
        `(${warning_types.join(', ')}) — auto-sanitized and passed through`
      );
      // Replace with sanitized version for downstream processing
      safe_output = sanitize_text(safe_output);
    }

    // --- Normal processing (no PII detected) ---

    if (result_status === 'success') {
      store.complete_task(req.params.id, {
        summary: safe_output,
        files_created: files ?? [],
      });

      // Activity log: hunter task completed
      const completed_task = store.get_by_id(req.params.id);
      if (completed_task) {
        activity_hooks?.log_task_completed(completed_task.id, completed_task.title);
      }

      // Fire-and-forget Notion backup for hunter results
      if (notion_backup && completed_task) {
        notion_backup.backup_task_result(completed_task.id, completed_task.title, safe_output).catch(() => {});
      }

      // Fire-and-forget notification: route to specialized handler or generic fallback
      if (completed_task) {
        // Extract text payload from OpenClaw JSON result
        let notify_text = safe_output;
        try {
          const parsed = JSON.parse(safe_output);
          const payloads = parsed?.result?.payloads ?? parsed?.payloads ?? [];
          if (payloads.length > 0) {
            notify_text = payloads.map((p: { text: string }) => p.text).join('\n\n');
          }
        } catch { /* not JSON, use safe_output as-is */ }

        if (options.result_router) {
          // Use specialized result router for handler dispatch
          options.result_router.route(
            { id: completed_task.id, title: completed_task.title, description: completed_task.description, action: completed_task.action },
            notify_text,
          ).then((route_result) => {
            log.info(`Result routed: task=${completed_task.id} handler=${route_result.handler} handled=${route_result.handled}`);
          }).catch((err) => {
            log.warn(`Result routing failed for task ${req.params.id}:`, err);
          });
        } else if (options.notification_router) {
          // Fallback: generic crawl_result notification
          const event: NotificationEvent = {
            type: 'crawl_result',
            message: `[${completed_task.title}]\n\n${notify_text}`,
            device: 'hunter',
            severity: 'low',
          };
          options.notification_router.route(event).catch((err) => {
            log.warn(`Notification failed for task ${req.params.id}:`, err);
          });
        }
      }
    } else {
      store.block_task(req.params.id, safe_output);
      // Activity log: hunter task failed
      activity_hooks?.log_task_failed(req.params.id, safe_output);
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

    // Activity log: hunter heartbeat received
    activity_hooks?.log_hunter_heartbeat();

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

  // Dev mode: only allowed when explicitly set AND not in production
  const is_production = process.env.NODE_ENV === 'production';
  const dev_mode_requested = process.env.NODE_ENV === 'development' || process.env.FAS_DEV_MODE === 'true';
  const dev_mode = dev_mode_requested && !is_production;

  // Guard: reject dev_mode in production environment
  if (dev_mode_requested && is_production) {
    log.error('FATAL: FAS_DEV_MODE=true is forbidden when NODE_ENV=production. Refusing to start.');
    process.exit(1);
  }

  if (!process.env.HUNTER_API_KEY && !dev_mode) {
    log.error('FATAL: HUNTER_API_KEY is not set and dev mode is off. Refusing to start.');
    log.error('Set HUNTER_API_KEY or FAS_DEV_MODE=true to proceed.');
    process.exit(1);
  }

  // Warn loudly when dev mode is active — should never reach production
  if (dev_mode) {
    log.warn('DEV MODE ACTIVE — Hunter auth is DISABLED. Do NOT use in production.');
  }

  // Notion backup (optional — set NOTION_API_KEY and NOTION_TASK_RESULTS_DB to enable)
  const notion_backup = process.env.NOTION_API_KEY && process.env.NOTION_TASK_RESULTS_DB
    ? { api_key: process.env.NOTION_API_KEY, database_id: process.env.NOTION_TASK_RESULTS_DB }
    : null;

  const app = create_app(store, {
    hunter_api_key: process.env.HUNTER_API_KEY,
    dev_mode,
    notion_backup,
  });

  app.listen(port, host, () => {
    log.info(`FAS Gateway + Task API listening on ${host}:${port}`);
    if (process.env.HUNTER_API_KEY) {
      log.info('Hunter API key authentication: ENABLED');
    } else if (dev_mode) {
      log.warn('Hunter API key authentication: DISABLED (dev mode)');
    }
    if (notion_backup) {
      log.info('Notion task backup: ENABLED');
    }
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    log.info('Shutting down...');
    store.close();
    process.exit(0);
  });
}
