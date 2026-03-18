# FAS Operations — 소스 코드 — NotebookLM 교차 검증 소스

> 이 파일은 FAS Operations 레포의 소스 코드(테스트 제외)를 포함합니다.
> 생성일: 2026-03-18

---

## 파일: [OPS] src/gateway/server.ts

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
import { FASError } from '../shared/types.js';
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

---

## 파일: [OPS] src/gateway/task_store.ts

// SQLite-based task store for FAS
// Manages task lifecycle: create -> pending -> in_progress -> done/blocked

import Database from 'better-sqlite3';
import { v4 as uuid_v4 } from 'uuid';
import type { Task, TaskStatus, RiskLevel } from '../shared/types.js';

// === Task store using SQLite ===

export type TaskStoreConfig = {
  db_path: string; // ':memory:' for testing
};

export const create_task_store = (config: TaskStoreConfig) => {
  const db = new Database(config.db_path);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // === Initialize schema ===
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT NOT NULL DEFAULT 'medium',
      assigned_to TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'awake',
      risk_level TEXT NOT NULL DEFAULT 'low',
      requires_personal_info INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      deadline TEXT,
      depends_on TEXT NOT NULL DEFAULT '[]',
      output_summary TEXT,
      output_files TEXT,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to);
  `);

  // === Prepared statements ===
  const stmts = {
    insert: db.prepare(`
      INSERT INTO tasks (id, title, description, priority, assigned_to, mode, risk_level, requires_personal_info, status, created_at, deadline, depends_on)
      VALUES (@id, @title, @description, @priority, @assigned_to, @mode, @risk_level, @requires_personal_info, @status, @created_at, @deadline, @depends_on)
    `),
    get_by_id: db.prepare('SELECT * FROM tasks WHERE id = ?'),
    get_by_status: db.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY created_at ASC'),
    get_by_assigned: db.prepare('SELECT * FROM tasks WHERE assigned_to = ? AND status = ? ORDER BY created_at ASC'),
    update_status: db.prepare('UPDATE tasks SET status = ? WHERE id = ?'),
    update_result: db.prepare(`
      UPDATE tasks SET status = ?, output_summary = ?, output_files = ?, completed_at = ? WHERE id = ?
    `),
    count_by_status: db.prepare('SELECT status, COUNT(*) as count FROM tasks GROUP BY status'),
    all_tasks: db.prepare('SELECT * FROM tasks ORDER BY created_at DESC'),
  };

  // === Row to Task converter ===
  const row_to_task = (row: Record<string, unknown>): Task => ({
    id: row.id as string,
    title: row.title as string,
    description: row.description as string | undefined,
    priority: row.priority as Task['priority'],
    assigned_to: row.assigned_to as string,
    mode: row.mode as Task['mode'],
    risk_level: row.risk_level as RiskLevel,
    requires_personal_info: Boolean(row.requires_personal_info),
    status: row.status as TaskStatus,
    created_at: row.created_at as string,
    deadline: row.deadline as string | null,
    depends_on: JSON.parse(row.depends_on as string) as string[],
    output: row.output_summary ? {
      summary: row.output_summary as string,
      files_created: JSON.parse((row.output_files as string) || '[]') as string[],
    } : undefined,
    completed_at: row.completed_at as string | undefined,
  });

  // === CRUD operations ===

  const create = (params: {
    title: string;
    description?: string;
    priority?: Task['priority'];
    assigned_to: string;
    mode?: Task['mode'];
    risk_level?: RiskLevel;
    requires_personal_info?: boolean;
    deadline?: string | null;
    depends_on?: string[];
  }): Task => {
    const id = uuid_v4();
    const now = new Date().toISOString();

    stmts.insert.run({
      id,
      title: params.title,
      description: params.description ?? null,
      priority: params.priority ?? 'medium',
      assigned_to: params.assigned_to,
      mode: params.mode ?? 'awake',
      risk_level: params.risk_level ?? 'low',
      requires_personal_info: params.requires_personal_info ? 1 : 0,
      status: 'pending',
      created_at: now,
      deadline: params.deadline ?? null,
      depends_on: JSON.stringify(params.depends_on ?? []),
    });

    return get_by_id(id)!;
  };

  const get_by_id = (id: string): Task | null => {
    const row = stmts.get_by_id.get(id) as Record<string, unknown> | undefined;
    return row ? row_to_task(row) : null;
  };

  const get_by_status = (status: TaskStatus): Task[] => {
    const rows = stmts.get_by_status.all(status) as Record<string, unknown>[];
    return rows.map(row_to_task);
  };

  const get_pending_for_agent = (agent_id: string): Task[] => {
    const rows = stmts.get_by_assigned.all(agent_id, 'pending') as Record<string, unknown>[];
    return rows.map(row_to_task);
  };

  const update_status = (id: string, status: TaskStatus): boolean => {
    const result = stmts.update_status.run(status, id);
    return result.changes > 0;
  };

  const complete_task = (id: string, output: { summary: string; files_created?: string[] }): boolean => {
    const result = stmts.update_result.run(
      'done',
      output.summary,
      JSON.stringify(output.files_created ?? []),
      new Date().toISOString(),
      id,
    );
    return result.changes > 0;
  };

  const block_task = (id: string, reason: string): boolean => {
    const result = stmts.update_result.run(
      'blocked',
      reason,
      '[]',
      new Date().toISOString(),
      id,
    );
    return result.changes > 0;
  };

  // Quarantine a task — PII detected in hunter output, needs human review
  const quarantine_task = (id: string, sanitized_preview: string, pii_types: string[]): boolean => {
    const summary = `[QUARANTINED] PII detected: ${pii_types.join(', ')}\n---\n${sanitized_preview}`;
    const result = stmts.update_result.run(
      'quarantined',
      summary,
      '[]',
      new Date().toISOString(),
      id,
    );
    return result.changes > 0;
  };

  const get_stats = (): Record<string, number> => {
    const rows = stmts.count_by_status.all() as { status: string; count: number }[];
    const stats: Record<string, number> = { pending: 0, in_progress: 0, done: 0, blocked: 0, quarantined: 0 };
    for (const row of rows) {
      stats[row.status] = row.count;
    }
    return stats;
  };

  const get_all = (): Task[] => {
    const rows = stmts.all_tasks.all() as Record<string, unknown>[];
    return rows.map(row_to_task);
  };

  const close = () => {
    db.close();
  };

  return {
    create,
    get_by_id,
    get_by_status,
    get_pending_for_agent,
    update_status,
    complete_task,
    block_task,
    quarantine_task,
    get_stats,
    get_all,
    close,
    _db: db, // for testing
  };
};

export type TaskStore = ReturnType<typeof create_task_store>;

---

## 파일: [OPS] src/gateway/sanitizer.ts

// Personal information sanitizer for FAS
// Removes PII before sending tasks to Hunter (isolated device)
// Stage 1: Regex-based pattern matching (fast, deterministic)
// Stage 2: LLM-based contextual filtering (TODO: future)

import type { Task } from '../shared/types.js';

// === PII patterns (Korean-focused) ===

type SanitizePattern = {
  name: string;
  regex: RegExp;
  replacement: string;
};

const PII_PATTERNS: SanitizePattern[] = [
  // Korean names with label (e.g., "이름: 홍길동")
  {
    name: 'labeled_korean_name',
    regex: /(이름|성명|본명)[:：]\s*[가-힣]{2,4}/gi,
    replacement: '$1: [이름 제거됨]',
  },
  // Korean resident registration numbers (주민번호) — must be before phone numbers
  // to avoid partial match (13 digits without hyphen)
  {
    name: 'resident_id',
    regex: /\d{6}-?[1-4]\d{6}/g,
    replacement: '[주민번호 제거됨]',
  },
  // Phone numbers (010-xxxx-xxxx variants)
  {
    name: 'phone_number',
    regex: /01[016789]-?\d{3,4}-?\d{4}/g,
    replacement: '[전화번호 제거됨]',
  },
  // Email addresses
  {
    name: 'email',
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    replacement: '[이메일 제거됨]',
  },
  // Korean addresses (시/도 + 시/군/구)
  {
    name: 'address',
    regex: /(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[시도]?\s+[가-힣]+[시군구]/g,
    replacement: '[주소 제거됨]',
  },
  // Credit card numbers (4 groups of 4 digits) — must be before bank_account
  {
    name: 'credit_card',
    regex: /\b\d{4}[- ]\d{4}[- ]\d{4}[- ]\d{4}\b/g,
    replacement: '[카드번호 제거됨]',
  },
  // IP addresses (private/Tailscale ranges) — must be before bank_account
  {
    name: 'ip_address',
    regex: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1[0-2]\d)\.\d{1,3}\.\d{1,3})\b/g,
    replacement: '[IP 제거됨]',
  },
  // Bank account numbers (3-4 digit groups with hyphens)
  {
    name: 'bank_account',
    regex: /\d{3,4}-\d{2,6}-\d{2,6}/g,
    replacement: '[계좌 제거됨]',
  },
  // Financial amounts with labels
  {
    name: 'financial_amount',
    regex: /(자산|현금|예금|보증금|연봉|월급)[:：]?\s*[약~]?\s*\d+[만억천]/g,
    replacement: '[금융정보 제거됨]',
  },
  // Internal/private URLs and hostnames (*.local, *.internal, *.ts.net, localhost)
  {
    name: 'internal_url',
    regex: /https?:\/\/(?:localhost|[\w.-]+\.(?:local|internal|tailnet|ts\.net))(?::\d+)?(?:\/[^\s]*)?/gi,
    replacement: '[내부URL 제거됨]',
  },
];

// === Sanitize text ===

export const sanitize_text = (text: string): string => {
  let result = text;
  for (const pattern of PII_PATTERNS) {
    result = result.replace(pattern.regex, pattern.replacement);
  }
  return result;
};

// === Sanitize a task for Hunter (whitelist approach) ===
// Only explicitly safe fields are included. New fields are excluded by default.

export type HunterSafeTask = {
  id: string;
  title: string;
  description?: string;
  priority: Task['priority'];
  mode: Task['mode'];
  risk_level: Task['risk_level'];
  status: Task['status'];
  deadline: string | null;
};

export const sanitize_task = (task: Task): HunterSafeTask => ({
  id: task.id,
  title: sanitize_text(task.title),
  description: task.description ? sanitize_text(task.description) : undefined,
  priority: task.priority,
  mode: task.mode,
  risk_level: task.risk_level,
  status: task.status,
  deadline: task.deadline,
});

// === Check if text contains PII ===

export const contains_pii = (text: string): boolean => {
  return PII_PATTERNS.some((pattern) => pattern.regex.test(text));
};

// === Get detected PII types in text ===

export const detect_pii_types = (text: string): string[] => {
  return PII_PATTERNS
    .filter((pattern) => {
      // Reset lastIndex for global regex
      pattern.regex.lastIndex = 0;
      return pattern.regex.test(text);
    })
    .map((pattern) => pattern.name);
};

---

## 파일: [OPS] src/gateway/rate_limiter.ts

// Simple in-memory sliding window rate limiter for Hunter API
// No external dependencies — lightweight defense against abuse

export type RateLimiterConfig = {
  window_ms: number;     // Time window in ms (e.g., 60_000 = 1 min)
  max_requests: number;  // Max requests allowed within the window
};

export const create_rate_limiter = (config: RateLimiterConfig) => {
  const timestamps: number[] = [];

  // Check if a new request is allowed within the rate limit
  const is_allowed = (): boolean => {
    const now = Date.now();

    // Evict expired entries outside the sliding window
    while (timestamps.length > 0 && timestamps[0]! <= now - config.window_ms) {
      timestamps.shift();
    }

    // Reject if at capacity
    if (timestamps.length >= config.max_requests) {
      return false;
    }

    // Record this request
    timestamps.push(now);
    return true;
  };

  // Reset all tracked requests (useful for testing)
  const reset = (): void => {
    timestamps.length = 0;
  };

  // Get remaining requests in current window
  const remaining = (): number => {
    const now = Date.now();
    while (timestamps.length > 0 && timestamps[0]! <= now - config.window_ms) {
      timestamps.shift();
    }
    return Math.max(0, config.max_requests - timestamps.length);
  };

  return { is_allowed, reset, remaining };
};

export type RateLimiter = ReturnType<typeof create_rate_limiter>;

---

## 파일: [OPS] src/notification/telegram.ts

// Telegram Bot notification module for FAS
// Handles: urgent alerts, approval requests, morning briefings

import TelegramBot from 'node-telegram-bot-api';
import type { TelegramMessageType, TelegramSendResult, ApprovalResponse, NotificationResult } from '../shared/types.js';

// === Configuration ===

export type TelegramConfig = {
  token: string;
  chat_id: string;
  polling?: boolean;
};

// === Telegram Client ===

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const create_telegram_client = (config: TelegramConfig) => {
  const bot = new TelegramBot(config.token, {
    polling: config.polling ?? false,
  });

  // Pending approval callbacks: request_id -> resolve function
  const pending_approvals = new Map<string, (approved: boolean) => void>();

  // Listen for inline keyboard callbacks (approval responses)
  if (config.polling) {
    bot.on('callback_query', (query) => {
      if (!query.data) return;

      // callback_data format: "approve:{request_id}" or "reject:{request_id}"
      const [action, request_id] = query.data.split(':');
      const resolver = pending_approvals.get(request_id);

      if (resolver) {
        resolver(action === 'approve');
        pending_approvals.delete(request_id);
        bot.answerCallbackQuery(query.id, {
          text: action === 'approve' ? '✅ 승인되었습니다' : '❌ 거부되었습니다',
        });
      } else {
        bot.answerCallbackQuery(query.id, {
          text: '⚠️ 이미 처리된 요청입니다',
        });
      }
    });
  }

  // === Send message with retry (exponential backoff, max 3 attempts) ===
  const send = async (
    text: string,
    type: TelegramMessageType,
    request_id?: string,
  ): Promise<TelegramSendResult> => {
    const reply_markup = type === 'approval' && request_id
      ? {
          inline_keyboard: [[
            { text: '✅ 승인', callback_data: `approve:${request_id}` },
            { text: '❌ 거부', callback_data: `reject:${request_id}` },
          ]],
        }
      : undefined;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const message = await bot.sendMessage(config.chat_id, text, {
          parse_mode: 'Markdown',
          reply_markup,
        });
        return { message_id: message.message_id, success: true };
      } catch (error) {
        console.error(`[Telegram] Attempt ${attempt}/${MAX_RETRIES} failed:`, error);
        if (attempt < MAX_RETRIES) {
          await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
        }
      }
    }
    console.error(`[Telegram] All ${MAX_RETRIES} attempts exhausted`);
    return { message_id: 0, success: false };
  };

  // === Send with detailed result ===
  const send_with_result = async (
    text: string,
    type: TelegramMessageType,
    request_id?: string,
  ): Promise<NotificationResult> => {
    const result = await send(text, type, request_id);
    return {
      channel: 'telegram',
      success: result.success,
      attempts: MAX_RETRIES, // send already retries internally
    };
  };

  // === Wait for approval response ===
  const wait_for_approval = (
    request_id: string,
    timeout_ms: number | null,
  ): Promise<ApprovalResponse> => {
    return new Promise((resolve) => {
      // Register resolver for this request
      pending_approvals.set(request_id, (approved) => {
        resolve({
          approved,
          responded_by: 'human',
          responded_at: new Date().toISOString(),
        });
      });

      // Set timeout if specified
      if (timeout_ms !== null) {
        setTimeout(() => {
          if (pending_approvals.has(request_id)) {
            pending_approvals.delete(request_id);
            resolve(null); // timeout
          }
        }, timeout_ms);
      }
    });
  };

  // === Format helpers ===
  const format_approval_message = (
    request_id: string,
    action: string,
    detail: string,
    risk_level: string,
  ): string => {
    const emoji = risk_level === 'critical' ? '🔴' : '🟠';
    return [
      `${emoji} *승인 요청* [${risk_level.toUpperCase()}]`,
      '',
      `*행동:* ${action}`,
      `*상세:* ${detail}`,
      '',
      `ID: \`${request_id}\``,
    ].join('\n');
  };

  const format_alert = (message: string): string => {
    return `🚨 *FAS Alert*\n\n${message}`;
  };

  const format_briefing = (content: string): string => {
    return `🌅 *FAS 모닝 브리핑*\n\n${content}`;
  };

  // === Cleanup ===
  const stop = () => {
    if (config.polling) {
      bot.stopPolling();
    }
    pending_approvals.clear();
  };

  return {
    send,
    send_with_result,
    wait_for_approval,
    format_approval_message,
    format_alert,
    format_briefing,
    stop,
    // Expose for testing
    _bot: bot,
    _pending_approvals: pending_approvals,
  };
};

export type TelegramClient = ReturnType<typeof create_telegram_client>;

---

## 파일: [OPS] src/notification/slack.ts

// Slack notification module for FAS
// Handles: agent logs, approvals, reports, crawl results, alerts

import { WebClient } from '@slack/web-api';
import type {
  SlackChannel,
  NotificationEvent,
  NotificationEventType,
  NotificationResult,
} from '../shared/types.js';

// === Configuration ===

export type SlackConfig = {
  token: string;
};

// === Channel routing map ===
// Maps event types to their target Slack channels

const CHANNEL_ROUTING: Record<NotificationEventType, SlackChannel | ((event: NotificationEvent) => SlackChannel)> = {
  agent_log: (event) =>
    event.device === 'captain' ? '#captain-logs' : '#hunter-logs',
  crawl_result: '#crawl-results',
  approval_mid: '#approvals',
  approval_high: '#approvals',
  academy: '#academy',
  alert: '#alerts',
  briefing: '#fas-general',
  milestone: '#fas-general',
  done: '#captain-logs',
  blocked: '#alerts',
  error: '#alerts',
};

// === Slack Client ===

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const create_slack_client = (config: SlackConfig) => {
  const web = new WebClient(config.token);

  // === Send message with retry (exponential backoff, max 3 attempts) ===
  const send = async (
    channel: SlackChannel,
    text: string,
    blocks?: unknown[],
  ): Promise<boolean> => {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await web.chat.postMessage({
          channel,
          text,
          blocks: blocks as never[],
        });
        return true;
      } catch (error) {
        console.error(`[Slack] Attempt ${attempt}/${MAX_RETRIES} failed for ${channel}:`, error);
        if (attempt < MAX_RETRIES) {
          await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
        }
      }
    }
    console.error(`[Slack] All ${MAX_RETRIES} attempts exhausted for ${channel}`);
    return false;
  };

  // === Send with retry returning detailed result ===
  const send_with_result = async (
    channel: SlackChannel,
    text: string,
    blocks?: unknown[],
  ): Promise<NotificationResult> => {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await web.chat.postMessage({
          channel,
          text,
          blocks: blocks as never[],
        });
        return { channel: 'slack', success: true, attempts: attempt };
      } catch (error) {
        console.error(`[Slack] Attempt ${attempt}/${MAX_RETRIES} failed for ${channel}:`, error);
        if (attempt < MAX_RETRIES) {
          await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
        }
      }
    }
    return { channel: 'slack', success: false, attempts: MAX_RETRIES, error: 'All retry attempts exhausted' };
  };

  // === Route notification to the correct channel ===
  const route = async (event: NotificationEvent): Promise<boolean> => {
    const routing = CHANNEL_ROUTING[event.type];
    if (!routing) {
      console.warn(`[Slack] No routing for event type: ${event.type}`);
      return false;
    }

    const channel = typeof routing === 'function' ? routing(event) : routing;
    return send(channel, event.message);
  };

  // === Resolve the channel for a given event ===
  const resolve_channel = (event: NotificationEvent): SlackChannel | null => {
    const routing = CHANNEL_ROUTING[event.type];
    if (!routing) return null;
    return typeof routing === 'function' ? routing(event) : routing;
  };

  // === Format helpers ===

  const format_milestone = (description: string): string => {
    return `✅ *[MILESTONE]* ${description}`;
  };

  const format_done = (description: string): string => {
    return `🎉 *[DONE]* ${description}`;
  };

  const format_blocked = (description: string): string => {
    return `🚫 *[BLOCKED]* ${description}`;
  };

  const format_error = (description: string): string => {
    return `⚠️ *[ERROR]* ${description}`;
  };

  return {
    send,
    send_with_result,
    route,
    resolve_channel,
    format_milestone,
    format_done,
    format_blocked,
    format_error,
    // Expose for testing
    _web: web,
  };
};

export type SlackClient = ReturnType<typeof create_slack_client>;

---

## 파일: [OPS] src/notification/router.ts

// Unified notification router for FAS
// Routes events to Telegram, Slack, and Notion based on the routing matrix

import type { TelegramClient } from './telegram.js';
import type { SlackClient } from './slack.js';
import type { NotificationEvent, NotificationEventType, NotificationResult } from '../shared/types.js';

// === Routing matrix: which channels receive which events ===

type RoutingRule = {
  telegram: boolean;
  slack: boolean;
  notion: boolean;
};

const ROUTING_MATRIX: Record<NotificationEventType, RoutingRule> = {
  briefing:      { telegram: true,  slack: true,  notion: true  },
  agent_log:     { telegram: false, slack: true,  notion: false },
  approval_mid:  { telegram: false, slack: true,  notion: false },
  approval_high: { telegram: true,  slack: true,  notion: false },
  crawl_result:  { telegram: false, slack: true,  notion: true  },
  alert:         { telegram: true,  slack: true,  notion: false },
  academy:       { telegram: false, slack: true,  notion: false },
  milestone:     { telegram: false, slack: true,  notion: false },
  done:          { telegram: false, slack: true,  notion: false },
  blocked:       { telegram: true,  slack: true,  notion: false },
  error:         { telegram: false, slack: true,  notion: false },
};

// === Router ===

export type NotificationRouterDeps = {
  telegram: TelegramClient | null;
  slack: SlackClient | null;
  // notion: NotionClient | null; // TODO: add in Phase 0-3 extension
};

export const create_notification_router = (deps: NotificationRouterDeps) => {
  // === Route a notification event to all configured channels ===
  const route = async (event: NotificationEvent): Promise<{
    telegram: boolean;
    slack: boolean;
    notion: boolean;
  }> => {
    const rules = ROUTING_MATRIX[event.type];
    if (!rules) {
      console.warn(`[Router] Unknown event type: ${event.type}`);
      return { telegram: false, slack: false, notion: false };
    }

    const results = {
      telegram: false,
      slack: false,
      notion: false,
    };

    const telegram_type = event.type === 'approval_high' ? 'approval' as const
      : event.type === 'alert' || event.type === 'blocked' ? 'alert' as const
      : event.type === 'briefing' ? 'briefing' as const
      : 'info' as const;

    // Telegram
    if (rules.telegram && deps.telegram) {
      const result = await deps.telegram.send(event.message, telegram_type);
      results.telegram = result.success;
    }

    // Slack
    if (rules.slack && deps.slack) {
      results.slack = await deps.slack.route(event);
    }

    // Fallback: Telegram failed → try Slack (for critical events)
    if (rules.telegram && !results.telegram && deps.slack && !results.slack) {
      console.warn(`[Router] Both Telegram and Slack failed for ${event.type} — critical notification lost`);
    } else if (rules.telegram && !results.telegram && deps.slack) {
      console.warn(`[Router] Telegram failed for ${event.type}, falling back to Slack`);
      results.slack = await deps.slack.send('#alerts', `[Telegram Fallback] ${event.message}`);
    } else if (rules.slack && !results.slack && deps.telegram) {
      // Fallback: Slack failed → try Telegram
      console.warn(`[Router] Slack failed for ${event.type}, falling back to Telegram`);
      const fallback = await deps.telegram.send(`[Slack Fallback] ${event.message}`, telegram_type);
      results.telegram = fallback.success;
    }

    // Notion — placeholder for future implementation
    // if (rules.notion && deps.notion) {
    //   results.notion = await deps.notion.create_page(event);
    // }

    return results;
  };

  // === Get routing rules for an event type ===
  const get_rules = (event_type: NotificationEventType): RoutingRule | null => {
    return ROUTING_MATRIX[event_type] ?? null;
  };

  return {
    route,
    get_rules,
  };
};

export type NotificationRouter = ReturnType<typeof create_notification_router>;

---

## 파일: [OPS] src/notification/index.ts

// Notification module barrel export
export { create_telegram_client, type TelegramClient, type TelegramConfig } from './telegram.js';
export { create_slack_client, type SlackClient, type SlackConfig } from './slack.js';
export { create_notification_router, type NotificationRouter, type NotificationRouterDeps } from './router.js';

---

## 파일: [OPS] src/hunter/api_client.ts

// HTTP client for Captain's Task API
// Uses native fetch — no external dependencies needed
// Supports API key authentication (Defense in Depth)

import type { Task, HunterTaskResult, HunterHeartbeatResponse } from '../shared/types.js';
import type { Logger } from './logger.js';

export type ApiClientConfig = {
  base_url: string;
  api_key?: string;       // Optional API key for captain authentication
  timeout_ms?: number;
};

export type ApiClient = {
  fetch_pending_tasks: () => Promise<Task[]>;
  submit_result: (task_id: string, result: HunterTaskResult) => Promise<boolean>;
  send_heartbeat: () => Promise<HunterHeartbeatResponse | null>;
};

const DEFAULT_TIMEOUT_MS = 5_000;
const API_KEY_HEADER = 'x-hunter-api-key';

export const create_api_client = (config: ApiClientConfig, logger: Logger): ApiClient => {
  const { base_url, api_key, timeout_ms = DEFAULT_TIMEOUT_MS } = config;

  const make_url = (path: string): string => `${base_url}${path}`;

  // Build common headers — include API key if configured
  const make_headers = (extra?: Record<string, string>): Record<string, string> => {
    const headers: Record<string, string> = { ...extra };
    if (api_key) {
      headers[API_KEY_HEADER] = api_key;
    }
    return headers;
  };

  // Fetch pending tasks assigned to hunter (PII-sanitized by captain)
  const fetch_pending_tasks = async (): Promise<Task[]> => {
    try {
      const res = await fetch(make_url('/api/hunter/tasks/pending'), {
        headers: make_headers(),
        signal: AbortSignal.timeout(timeout_ms),
      });

      if (!res.ok) {
        logger.warn(`fetch_pending_tasks: HTTP ${res.status}`);
        return [];
      }

      const data = await res.json() as { tasks: Task[]; count: number };
      return data.tasks;
    } catch (err) {
      logger.error(`fetch_pending_tasks failed: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  };

  // Submit task execution result back to captain
  const submit_result = async (task_id: string, result: HunterTaskResult): Promise<boolean> => {
    try {
      const res = await fetch(make_url(`/api/hunter/tasks/${task_id}/result`), {
        method: 'POST',
        headers: make_headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(result),
        signal: AbortSignal.timeout(timeout_ms),
      });

      if (!res.ok) {
        // Handle quarantine response (202) — PII detected in output
        if (res.status === 202) {
          const data = await res.json() as { quarantined: boolean; detected_types: string[] };
          logger.warn(
            `submit_result(${task_id}): quarantined — PII detected: ${data.detected_types?.join(', ')}`
          );
          return false;
        }
        logger.warn(`submit_result(${task_id}): HTTP ${res.status}`);
        return false;
      }

      return true;
    } catch (err) {
      logger.error(`submit_result(${task_id}) failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  };

  // Send heartbeat signal to captain
  const send_heartbeat = async (): Promise<HunterHeartbeatResponse | null> => {
    try {
      const res = await fetch(make_url('/api/hunter/heartbeat'), {
        method: 'POST',
        headers: make_headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          agent: 'openclaw',
          timestamp: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(timeout_ms),
      });

      if (!res.ok) {
        logger.warn(`send_heartbeat: HTTP ${res.status}`);
        return null;
      }

      return await res.json() as HunterHeartbeatResponse;
    } catch (err) {
      logger.error(`send_heartbeat failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  };

  return { fetch_pending_tasks, submit_result, send_heartbeat };
};

---

## 파일: [OPS] src/hunter/task_executor.ts

// Task executor with action routing
// Currently all executors are stubs — OpenClaw integration comes later

import type { Task, HunterActionType, HunterTaskResult } from '../shared/types.js';
import type { Logger } from './logger.js';

type ActionHandler = (task: Task) => Promise<HunterTaskResult>;

// Resolve action type from task title/description keywords
export const resolve_action = (task: Task): HunterActionType => {
  const text = `${task.title} ${task.description ?? ''}`.toLowerCase();

  if (text.includes('notebooklm') || text.includes('notebook_lm')) return 'notebooklm_verify';
  if (text.includes('deep research') || text.includes('deep_research')) return 'deep_research';
  if (text.includes('crawl') || text.includes('scrape') || text.includes('크롤링')) return 'web_crawl';
  return 'browser_task'; // default fallback
};

export const create_task_executor = (logger: Logger) => {
  // === Stub action handlers ===
  // These will be replaced with real OpenClaw integration later

  const handle_notebooklm_verify: ActionHandler = async (task) => {
    logger.info(`[STUB] NotebookLM verify: ${task.title}`);
    return {
      status: 'success',
      output: `[STUB] NotebookLM verification completed for: ${task.title}`,
      files: [],
    };
  };

  const handle_deep_research: ActionHandler = async (task) => {
    logger.info(`[STUB] Deep Research: ${task.title}`);
    return {
      status: 'success',
      output: `[STUB] Deep Research completed for: ${task.title}`,
      files: [],
    };
  };

  const handle_web_crawl: ActionHandler = async (task) => {
    logger.info(`[STUB] Web Crawl: ${task.title}`);
    return {
      status: 'success',
      output: `[STUB] Web crawl completed for: ${task.title}`,
      files: [],
    };
  };

  const handle_browser_task: ActionHandler = async (task) => {
    logger.info(`[STUB] Browser Task: ${task.title}`);
    return {
      status: 'success',
      output: `[STUB] Browser task completed for: ${task.title}`,
      files: [],
    };
  };

  // Action router
  const action_map: Record<HunterActionType, ActionHandler> = {
    notebooklm_verify: handle_notebooklm_verify,
    deep_research: handle_deep_research,
    web_crawl: handle_web_crawl,
    browser_task: handle_browser_task,
  };

  // Execute a task — resolves action type and dispatches to handler
  const execute = async (task: Task): Promise<HunterTaskResult> => {
    const action = resolve_action(task);
    logger.info(`Executing task ${task.id}: action=${action}, title="${task.title}"`);

    try {
      const handler = action_map[action];
      return await handler(task);
    } catch (err) {
      const error_msg = err instanceof Error ? err.message : String(err);
      logger.error(`Task ${task.id} execution failed: ${error_msg}`);
      return {
        status: 'failure',
        output: `Execution error: ${error_msg}`,
        files: [],
      };
    }
  };

  return { execute, resolve_action };
};

---

## 파일: [OPS] src/hunter/poll_loop.ts

// Main polling loop for Hunter agent
// Cycle: heartbeat → fetch pending → execute first task → submit result → wait
//
// Uses setTimeout recursion instead of setInterval to prevent
// overlapping cycles when task execution takes longer than poll interval.

import type { ApiClient } from './api_client.js';
import type { Logger } from './logger.js';
import type { HunterConfig } from './config.js';

type TaskExecutor = {
  execute: (task: import('../shared/types.js').Task) => Promise<import('../shared/types.js').HunterTaskResult>;
};

export type PollLoopDeps = {
  api: ApiClient;
  executor: TaskExecutor;
  logger: Logger;
  config: HunterConfig;
};

export type PollLoopState = {
  running: boolean;
  consecutive_failures: number;
  total_tasks_processed: number;
  last_heartbeat_at: string | null;
};

const MAX_BACKOFF_MS = 300_000; // 5 minutes

export const create_poll_loop = (deps: PollLoopDeps) => {
  const { api, executor, logger, config } = deps;

  const state: PollLoopState = {
    running: false,
    consecutive_failures: 0,
    total_tasks_processed: 0,
    last_heartbeat_at: null,
  };

  let timer: ReturnType<typeof setTimeout> | null = null;

  // Exponential backoff: base_interval * 2^failures (capped at MAX_BACKOFF_MS)
  const get_current_interval = (): number => {
    if (state.consecutive_failures === 0) return config.poll_interval_ms;
    const backoff = config.poll_interval_ms * Math.pow(2, state.consecutive_failures);
    return Math.min(backoff, MAX_BACKOFF_MS);
  };

  // Single poll cycle
  const run_cycle = async (): Promise<void> => {
    try {
      // 1. Send heartbeat
      const hb = await api.send_heartbeat();
      if (hb) {
        state.last_heartbeat_at = hb.server_time;
      }

      // 2. Fetch pending tasks
      const tasks = await api.fetch_pending_tasks();

      if (tasks.length === 0) {
        // No work — reset failure counter on successful communication
        state.consecutive_failures = 0;
        return;
      }

      // 3. Execute first task only (max_concurrent_tasks: 1)
      const task = tasks[0];
      logger.info(`Processing task: ${task.id} — "${task.title}"`);

      const result = await executor.execute(task);

      // 4. Submit result
      const submitted = await api.submit_result(task.id, result);
      if (submitted) {
        state.total_tasks_processed += 1;
        logger.info(`Task ${task.id} completed: ${result.status}`);
      } else {
        logger.warn(`Task ${task.id} result submission failed — will retry`);
      }

      // Success — reset failure counter
      state.consecutive_failures = 0;
    } catch (err) {
      state.consecutive_failures += 1;
      const error_msg = err instanceof Error ? err.message : String(err);
      logger.error(`Poll cycle error (failures: ${state.consecutive_failures}): ${error_msg}`);
    }
  };

  // Schedule next cycle after current one completes
  const schedule_next = () => {
    if (!state.running) return;

    const interval = get_current_interval();
    if (state.consecutive_failures > 0) {
      logger.warn(`Backing off: next poll in ${interval}ms (failures: ${state.consecutive_failures})`);
    }

    timer = setTimeout(async () => {
      await run_cycle();
      schedule_next();
    }, interval);
  };

  const start = () => {
    if (state.running) return;
    state.running = true;
    logger.info('Poll loop started');

    // Run first cycle immediately, then schedule
    run_cycle().then(() => schedule_next());
  };

  const stop = () => {
    state.running = false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    logger.info(`Poll loop stopped. Total tasks processed: ${state.total_tasks_processed}`);
  };

  const get_state = (): Readonly<PollLoopState> => ({ ...state });

  return { start, stop, get_state, run_cycle, get_current_interval };
};

---

## 파일: [OPS] src/hunter/config.ts

// Hunter agent configuration loader
// Reads from environment variables with sensible defaults

export type HunterConfig = {
  captain_api_url: string;
  hunter_api_key?: string;  // API key for captain authentication (Defense in Depth)
  poll_interval_ms: number;
  log_dir: string;
  device_name: string;
};

export const load_hunter_config = (): HunterConfig => {
  const captain_api_url = process.env.CAPTAIN_API_URL;
  if (!captain_api_url) {
    throw new Error('CAPTAIN_API_URL environment variable is required');
  }

  const hunter_api_key = process.env.HUNTER_API_KEY;
  if (!hunter_api_key) {
    console.warn('[Hunter] HUNTER_API_KEY not set — API key authentication disabled');
  }

  return {
    captain_api_url,
    hunter_api_key,
    poll_interval_ms: parseInt(process.env.HUNTER_POLL_INTERVAL ?? '10000', 10),
    log_dir: process.env.HUNTER_LOG_DIR ?? './logs',
    device_name: 'hunter',
  };
};

---

## 파일: [OPS] src/hunter/logger.ts

// Simple file + console logger for Hunter agent
// Logs to: console + {log_dir}/hunter_{date}.log

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export type Logger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
};

const get_log_file_path = (log_dir: string): string => {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return join(log_dir, `hunter_${date}.log`);
};

const format_line = (level: string, msg: string): string => {
  const ts = new Date().toISOString();
  return `[${ts}] [${level.toUpperCase()}] ${msg}`;
};

export const create_logger = (log_dir: string): Logger => {
  mkdirSync(log_dir, { recursive: true });

  const write = (level: string, msg: string) => {
    const line = format_line(level, msg);

    // Console output
    if (level === 'error') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }

    // File output
    try {
      appendFileSync(get_log_file_path(log_dir), line + '\n');
    } catch {
      // Silently ignore file write errors — console is still working
    }
  };

  return {
    info: (msg) => write('info', msg),
    warn: (msg) => write('warn', msg),
    error: (msg) => write('error', msg),
  };
};

---

## 파일: [OPS] src/hunter/main.ts

// Hunter agent entry point
// Polls Captain's Task API, executes tasks via OpenClaw (stubs for now)
//
// Usage:
//   npx tsx src/hunter/main.ts
//   # or via package.json:
//   pnpm run hunter
//
// Env vars:
//   CAPTAIN_API_URL      — Captain Task API (default: http://100.64.0.1:3100)
//   HUNTER_POLL_INTERVAL — Poll interval in ms (default: 10000)
//   HUNTER_LOG_DIR       — Log directory (default: ./logs)

import { load_hunter_config } from './config.js';
import { create_api_client } from './api_client.js';
import { create_task_executor } from './task_executor.js';
import { create_poll_loop } from './poll_loop.js';
import { create_logger } from './logger.js';

const is_main = import.meta.url === `file://${process.argv[1]}`;

if (is_main) {
  const config = load_hunter_config();
  const logger = create_logger(config.log_dir);
  const api = create_api_client({ base_url: config.captain_api_url }, logger);
  const executor = create_task_executor(logger);
  const loop = create_poll_loop({ api, executor, logger, config });

  logger.info(`Hunter agent starting — polling ${config.captain_api_url} every ${config.poll_interval_ms}ms`);
  loop.start();

  // Graceful shutdown
  const shutdown = () => {
    logger.info('Hunter agent shutting down...');
    loop.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

---

## 파일: [OPS] src/hunter/index.ts

// Hunter module — barrel export

export { load_hunter_config, type HunterConfig } from './config.js';
export { create_api_client, type ApiClient, type ApiClientConfig } from './api_client.js';
export { create_task_executor, resolve_action } from './task_executor.js';
export { create_poll_loop, type PollLoopDeps, type PollLoopState } from './poll_loop.js';
export { create_logger, type Logger } from './logger.js';

---

## 파일: [OPS] src/watchdog/output_watcher.ts

// FAS Output Watcher
// Monitors tmux session output for predefined patterns
// and routes them to Telegram/Slack notifications.
//
// Patterns detected:
//   [APPROVAL_NEEDED] → Telegram urgent
//   [BLOCKED]         → Telegram urgent
//   [MILESTONE]       → Slack #fas-general
//   [DONE]            → Slack #captain-logs
//   [ERROR]           → Slack #alerts

import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

// === Pattern definitions ===

export type PatternMatch = {
  pattern_name: string;
  full_match: string;
  description: string;
  timestamp: string;
  session: string;
};

type WatchPattern = {
  name: string;
  regex: RegExp;
  // extract description from the match
  extract: (match: RegExpMatchArray) => string;
};

const WATCH_PATTERNS: WatchPattern[] = [
  {
    name: 'APPROVAL_NEEDED',
    regex: /\[APPROVAL_NEEDED\]\s*(.*)/,
    extract: (m) => m[1]?.trim() ?? '',
  },
  {
    name: 'BLOCKED',
    regex: /\[BLOCKED\]\s*(.*)/,
    extract: (m) => m[1]?.trim() ?? '',
  },
  {
    name: 'MILESTONE',
    regex: /\[MILESTONE\]\s*(.*)/,
    extract: (m) => m[1]?.trim() ?? '',
  },
  {
    name: 'DONE',
    regex: /\[DONE\]\s*(.*)/,
    extract: (m) => m[1]?.trim() ?? '',
  },
  {
    name: 'ERROR',
    regex: /\[ERROR\]\s*(.*)/,
    extract: (m) => m[1]?.trim() ?? '',
  },
];

// === Line scanner (pure function, testable) ===

export const scan_line = (line: string, session: string): PatternMatch | null => {
  for (const pattern of WATCH_PATTERNS) {
    const match = line.match(pattern.regex);
    if (match) {
      return {
        pattern_name: pattern.name,
        full_match: match[0],
        description: pattern.extract(match),
        timestamp: new Date().toISOString(),
        session,
      };
    }
  }
  return null;
};

// === Watcher class ===

export type WatcherConfig = {
  sessions: string[];           // tmux session names to watch
  poll_interval_ms?: number;    // how often to capture output (default: 2000)
  on_match: (match: PatternMatch) => void | Promise<void>;
};

export class OutputWatcher extends EventEmitter {
  private config: WatcherConfig;
  private running = false;
  private timers: ReturnType<typeof setInterval>[] = [];
  // Track last captured content per session to detect new lines
  private last_content: Map<string, string> = new Map();

  constructor(config: WatcherConfig) {
    super();
    this.config = config;
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    for (const session of this.config.sessions) {
      const timer = setInterval(
        () => this.capture_session(session),
        this.config.poll_interval_ms ?? 2000,
      );
      this.timers.push(timer);
    }

    this.emit('started', this.config.sessions);
  }

  stop(): void {
    this.running = false;
    for (const timer of this.timers) {
      clearInterval(timer);
    }
    this.timers = [];
    this.last_content.clear();
    this.emit('stopped');
  }

  is_running(): boolean {
    return this.running;
  }

  // Capture recent output from a tmux session pane
  private async capture_session(session: string): Promise<void> {
    try {
      const output = await this.tmux_capture_pane(session);
      const previous = this.last_content.get(session) ?? '';

      if (output === previous) return; // no new content

      // Find new lines by comparing with previous content
      const new_lines = this.extract_new_lines(previous, output);
      this.last_content.set(session, output);

      // Scan each new line for patterns
      for (const line of new_lines) {
        const match = scan_line(line, session);
        if (match) {
          this.emit('match', match);
          await this.config.on_match(match);
        }
      }
    } catch {
      // Session might not exist yet, ignore errors silently
    }
  }

  // Extract lines that are in new_content but not in old_content
  private extract_new_lines(old_content: string, new_content: string): string[] {
    const old_lines = old_content.split('\n');
    const new_lines = new_content.split('\n');

    // Find where old content ends in new content
    if (old_lines.length === 0) return new_lines;

    // Simple approach: return lines after the old content length
    const start_index = old_lines.length > 0 ? old_lines.length - 1 : 0;
    return new_lines.slice(start_index).filter((l) => l.trim().length > 0);
  }

  // Run tmux capture-pane and return output
  private tmux_capture_pane(session: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('tmux', [
        'capture-pane', '-t', session, '-p', '-S', '-50',
      ]);

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`tmux capture-pane failed: ${stderr}`));
        }
      });
    });
  }
}

// === Main entry point ===

const is_main = import.meta.url === `file://${process.argv[1]}`;

if (is_main) {
  const WATCHED_SESSIONS = [
    'fas-claude',
    'fas-gemini-a',
    'fas-gemini-b',
    'fas-gateway',
  ];

  console.log(`[Watcher] Starting output watcher for sessions: ${WATCHED_SESSIONS.join(', ')}`);

  const watcher = new OutputWatcher({
    sessions: WATCHED_SESSIONS,
    poll_interval_ms: 2000,
    on_match: async (match) => {
      console.log(`[Watcher] Pattern detected: [${match.pattern_name}] ${match.description} (session: ${match.session})`);

      // TODO: integrate with notification router once env vars are configured
      // const router = create_notification_router({ telegram, slack });
      // await router.route({ type: map_pattern_to_event(match), ... });
    },
  });

  watcher.start();

  process.on('SIGINT', () => {
    console.log('[Watcher] Shutting down...');
    watcher.stop();
    process.exit(0);
  });
}

---

## 파일: [OPS] src/shared/types.ts

// === Notification Types ===

export type NotificationLevel = 'info' | 'approval' | 'alert' | 'briefing' | 'critical';

export type SlackChannel =
  | '#fas-general'
  | '#captain-logs'
  | '#hunter-logs'
  | '#approvals'
  | '#reports'
  | '#crawl-results'
  | '#academy'
  | '#ideas'
  | '#alerts';

export type NotificationEventType =
  | 'agent_log'
  | 'crawl_result'
  | 'approval_mid'
  | 'approval_high'
  | 'academy'
  | 'alert'
  | 'briefing'
  | 'milestone'
  | 'done'
  | 'blocked'
  | 'error';

export type DeviceName = 'captain' | 'hunter';

export type NotificationEvent = {
  type: NotificationEventType;
  message: string;
  device: DeviceName;
  severity?: 'low' | 'mid' | 'high' | 'critical';
  metadata?: Record<string, unknown>;
};

// === Telegram specific ===

export type TelegramMessageType = 'info' | 'approval' | 'alert' | 'briefing';

export type TelegramSendResult = {
  message_id: number;
  success: boolean;
};

export type ApprovalResponse = {
  approved: boolean;
  responded_by: string;
  responded_at: string;
} | null; // null = timeout

// === Notification Result ===

export type NotificationResult = {
  channel: 'telegram' | 'slack' | 'notion';
  success: boolean;
  attempts: number;
  error?: string;
  fallback_used?: boolean;
};

// === Error Types ===

export type FASErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'AUTH_ERROR'
  | 'RATE_LIMIT'
  | 'PII_DETECTED'
  | 'INTERNAL_ERROR'
  | 'NOTIFICATION_ERROR'
  | 'TIMEOUT';

export class FASError extends Error {
  readonly code: FASErrorCode;
  readonly status_code: number;
  readonly details?: Record<string, unknown>;

  constructor(code: FASErrorCode, message: string, status_code: number, details?: Record<string, unknown>) {
    super(message);
    this.name = 'FASError';
    this.code = code;
    this.status_code = status_code;
    this.details = details;
  }

  to_json() {
    return {
      error: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

// === Task Types ===

export type RiskLevel = 'low' | 'mid' | 'high' | 'critical';

export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'blocked' | 'quarantined';

export type FasMode = 'sleep' | 'awake';

export type Task = {
  id: string;
  title: string;
  description?: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assigned_to: string;
  mode: FasMode | 'recurring';
  risk_level: RiskLevel;
  requires_personal_info: boolean;
  status: TaskStatus;
  created_at: string;
  deadline: string | null;
  depends_on: string[];
  output?: {
    summary: string;
    files_created: string[];
  };
  completed_at?: string;
};

// === Hunter Types ===

export type HunterActionType =
  | 'notebooklm_verify'
  | 'deep_research'
  | 'web_crawl'
  | 'browser_task';

export type HunterTaskResult = {
  status: 'success' | 'failure';
  output: string;
  files: string[];
};

export type HunterHeartbeatResponse = {
  ok: boolean;
  server_time: string;
};

export type HunterPendingTasksResponse = {
  tasks: Task[];
  count: number;
};

// === Gateway Types ===

export type ApprovalRequest = {
  id: string;
  requester: string;
  action_type: string;
  action_detail: string;
  risk_level: RiskLevel;
  context: {
    task_id: string;
    files_affected: string[];
    diff_summary?: string;
    evidence: string[];
  };
  status: 'pending' | 'approved' | 'rejected' | 'timeout';
  created_at: string;
  resolved_at?: string;
};

export type HealthCheckResponse = {
  status: 'ok' | 'degraded' | 'down';
  mode: FasMode;
  uptime_seconds: number;
  agents: Record<string, {
    status: 'running' | 'stopped' | 'crashed';
    last_heartbeat: string | null;
  }>;
  timestamp: string;
};

---
