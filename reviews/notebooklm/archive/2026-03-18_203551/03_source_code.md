# FAS Operations — 소스 코드 — NotebookLM 교차 검증 소스

> 소스 코드 (테스트 제외). 생성일: 2026-03-18

## 파일: [OPS] src/captain/feedback_extractor.ts

// Feedback extractor for FAS Captain
// Extracts lessons learned from completed tasks via Gemini CLI
// Fire-and-forget: failures only log warnings, never block task completion

import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';

// === Configuration ===

export type FeedbackExtractorConfig = {
  gemini_command?: string;    // CLI command (default: 'gemini')
  feedback_path: string;      // Path to Doctrine feedback file (append)
  timeout_ms?: number;        // Gemini timeout (default: 60_000 = 1 min)
};

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_GEMINI_COMMAND = 'gemini';

// === Execute Gemini CLI ===

const exec_gemini = (command: string, prompt: string, timeout_ms: number): Promise<string> => {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, [prompt], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeout_ms,
    });

    let stdout = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Gemini CLI exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
};

// === Factory ===

export const create_feedback_extractor = (config: FeedbackExtractorConfig) => {
  const gemini_command = config.gemini_command ?? DEFAULT_GEMINI_COMMAND;
  const timeout_ms = config.timeout_ms ?? DEFAULT_TIMEOUT_MS;

  // Extract a one-sentence lesson from a completed task
  const extract = async (task_title: string, output_summary: string): Promise<void> => {
    const prompt =
      `Task: "${task_title}"\nResult: "${output_summary}"\n\n` +
      `이 작업에서 얻은 교훈을 한 문장으로 요약하세요. 한국어로 답변하세요.`;

    try {
      const lesson = await exec_gemini(gemini_command, prompt, timeout_ms);

      if (lesson.length > 0 && lesson.length < 500) {
        const timestamp = new Date().toISOString().split('T')[0];
        const entry = `\n- [${timestamp}] ${task_title}: ${lesson}`;
        appendFileSync(config.feedback_path, entry, 'utf-8');
      } else {
        console.warn(`[FeedbackExtractor] Unexpected response length (${lesson.length}), skipping`);
      }
    } catch (err) {
      // Non-critical: log and continue
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[FeedbackExtractor] Failed to extract feedback: ${msg}`);
    }
  };

  return { extract };
};

export type FeedbackExtractor = ReturnType<typeof create_feedback_extractor>;

---

## 파일: [OPS] src/captain/planning_loop.ts

// Captain's planning loop — morning/night autonomous scheduling
// Reads schedules.yml, creates due tasks in store, sends briefing notifications
// Also supports dynamic task discovery via Gemini analysis of crawl results

import { readFileSync } from 'node:fs';
import { parse as yaml_parse } from 'yaml';
import type { TaskStore } from '../gateway/task_store.js';
import type { NotificationRouter } from '../notification/router.js';
import type { GeminiConfig } from '../gemini/types.js';
import { spawn_gemini } from '../gemini/cli_wrapper.js';

// === Schedule types (from schedules.yml) ===

type ScheduleType = 'daily' | 'every_3_days' | 'weekly';

type ScheduleEntry = {
  title: string;
  type: ScheduleType;
  time: string;
  mode?: string;
  agent?: string;
  risk_level?: string;
  requires_personal_info?: boolean;
  day?: string;          // For weekly schedules (e.g., 'monday')
  workflow?: string;     // System workflows (not task-based)
};

type SchedulesFile = {
  schedules: Record<string, ScheduleEntry>;
};

// === Day-of-week helpers ===

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

const get_day_name = (date: Date): string => DAY_NAMES[date.getDay()];

// === Check if a schedule is due today ===

const is_due_today = (entry: ScheduleEntry, today: Date, epoch: Date): boolean => {
  switch (entry.type) {
    case 'daily':
      return true;
    case 'weekly':
      return entry.day ? get_day_name(today) === entry.day.toLowerCase() : false;
    case 'every_3_days': {
      // Calculate days since epoch, check if divisible by 3
      const diff_ms = today.getTime() - epoch.getTime();
      const diff_days = Math.floor(diff_ms / (24 * 60 * 60 * 1000));
      return diff_days % 3 === 0;
    }
    default:
      return false;
  }
};

// === Valid agents for discovered tasks ===

const VALID_AGENTS = ['gemini_a', 'gemini_b', 'openclaw', 'claude'] as const;

// === Crawl-related keywords for filtering completed tasks ===

const CRAWL_KEYWORDS = ['crawl', '크롤링', 'scrape', 'research'] as const;

// === Max suggestions per discovery cycle ===

const MAX_DISCOVER_SUGGESTIONS = 3;

// === Lookback window for recent crawl tasks (3 days in ms) ===

const DISCOVER_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;

// === Type for Gemini discovery suggestion ===

type DiscoverySuggestion = {
  title: string;
  description: string;
  agent: string;
  priority: 'low' | 'medium' | 'high';
};

// === Dependencies ===

export type PlanningLoopDeps = {
  store: TaskStore;
  router: NotificationRouter;
  schedules_path: string;
  epoch?: Date;  // Reference date for every_3_days calculation (default: 2026-01-01)
  gemini_config?: GeminiConfig;  // For discover_opportunities
};

// === Factory ===

export const create_planning_loop = (deps: PlanningLoopDeps) => {
  const epoch = deps.epoch ?? new Date('2026-01-01T00:00:00Z');

  // Load and parse schedules.yml
  const load_schedules = (): Record<string, ScheduleEntry> => {
    const raw = readFileSync(deps.schedules_path, 'utf-8');
    const parsed = yaml_parse(raw) as SchedulesFile;
    return parsed.schedules ?? {};
  };

  // Check if a task with the same title was already completed recently (within 20 hours)
  const is_recently_completed = (title: string): boolean => {
    const done_tasks = deps.store.get_by_status('done');
    const twenty_hours_ago = Date.now() - 20 * 60 * 60 * 1000;
    return done_tasks.some(
      (t) => t.title === title && t.completed_at && new Date(t.completed_at).getTime() > twenty_hours_ago,
    );
  };

  // Check if a task with the same title is already pending or in_progress
  const is_already_queued = (title: string): boolean => {
    const pending = deps.store.get_by_status('pending');
    const in_progress = deps.store.get_by_status('in_progress');
    return [...pending, ...in_progress].some((t) => t.title === title);
  };

  // Morning planning: create due tasks from schedules.yml
  const run_morning = async (today: Date = new Date()): Promise<{
    created: string[];
    skipped: string[];
  }> => {
    const schedules = load_schedules();
    const created: string[] = [];
    const skipped: string[] = [];

    for (const [_key, entry] of Object.entries(schedules)) {
      // Skip system workflows (no agent assigned)
      if (!entry.agent) {
        skipped.push(`${entry.title} (system workflow)`);
        continue;
      }

      // Check if due today
      if (!is_due_today(entry, today, epoch)) {
        skipped.push(`${entry.title} (not due)`);
        continue;
      }

      // Dedup: skip if already queued or recently completed
      if (is_already_queued(entry.title)) {
        skipped.push(`${entry.title} (already queued)`);
        continue;
      }
      if (is_recently_completed(entry.title)) {
        skipped.push(`${entry.title} (recently completed)`);
        continue;
      }

      // Create task
      deps.store.create({
        title: entry.title,
        assigned_to: entry.agent,
        mode: (entry.mode as 'awake' | 'sleep' | 'recurring') ?? 'awake',
        risk_level: (entry.risk_level as 'low' | 'mid' | 'high' | 'critical') ?? 'low',
        requires_personal_info: entry.requires_personal_info ?? false,
      });

      created.push(entry.title);
    }

    // Send morning briefing
    if (created.length > 0) {
      const briefing_msg = `[Morning Briefing] ${created.length} tasks scheduled:\n${created.map((t) => `• ${t}`).join('\n')}`;
      await deps.router.route({
        type: 'briefing',
        message: briefing_msg,
        device: 'captain',
      });
    }

    return { created, skipped };
  };

  // === Dynamic task discovery via Gemini analysis of crawl results ===

  // Get recently completed crawl tasks (last 3 days)
  const get_recent_crawl_tasks = () => {
    const done_tasks = deps.store.get_by_status('done');
    const cutoff = Date.now() - DISCOVER_LOOKBACK_MS;

    return done_tasks.filter((t) => {
      // Must have completed within lookback window
      if (!t.completed_at || new Date(t.completed_at).getTime() < cutoff) {
        return false;
      }
      // Must be crawl-related (title contains any crawl keyword)
      const lower_title = t.title.toLowerCase();
      return CRAWL_KEYWORDS.some((kw) => lower_title.includes(kw));
    });
  };

  // Build the Gemini prompt with crawl result summaries
  const build_discover_prompt = (summaries: string[]): string => {
    const joined = summaries.join('\n\n');
    return `다음은 최근 3일간의 크롤링/리서치 결과 요약입니다:

${joined}

이 결과를 분석하여, 주인님에게 도움이 될 만한 추가 조사/행동 아이템을 최대 3개 제안해 주세요.
JSON 배열 형식으로 응답하세요:
[{"title": "태스크 제목", "description": "설명", "agent": "에이전트명", "priority": "low|medium|high"}]

기준:
- 마감이 임박한 지원 사업
- 새로 발견된 채용 공고
- 시장/트렌드 변화로 즉시 행동이 필요한 사항`;
  };

  // Parse Gemini response into suggestion array (safely)
  const parse_suggestions = (content: string): DiscoverySuggestion[] => {
    try {
      // Try to extract JSON array from response
      const array_match = content.match(/\[[\s\S]*\]/);
      if (!array_match) return [];

      const parsed = JSON.parse(array_match[0]) as unknown[];
      if (!Array.isArray(parsed)) return [];

      // Validate and filter each suggestion
      const valid: DiscoverySuggestion[] = [];
      for (const item of parsed) {
        if (valid.length >= MAX_DISCOVER_SUGGESTIONS) break;

        if (
          typeof item === 'object' &&
          item !== null &&
          'title' in item &&
          'description' in item &&
          'agent' in item &&
          'priority' in item &&
          typeof (item as Record<string, unknown>).title === 'string' &&
          typeof (item as Record<string, unknown>).description === 'string' &&
          typeof (item as Record<string, unknown>).agent === 'string' &&
          typeof (item as Record<string, unknown>).priority === 'string'
        ) {
          const suggestion = item as { title: string; description: string; agent: string; priority: string };

          // Only accept valid agents
          if (!(VALID_AGENTS as readonly string[]).includes(suggestion.agent)) continue;

          // Only accept valid priorities
          const valid_priorities = ['low', 'medium', 'high'] as const;
          if (!(valid_priorities as readonly string[]).includes(suggestion.priority)) continue;

          valid.push({
            title: suggestion.title,
            description: suggestion.description,
            agent: suggestion.agent,
            priority: suggestion.priority as 'low' | 'medium' | 'high',
          });
        }
      }

      return valid;
    } catch {
      // Malformed JSON — return empty
      return [];
    }
  };

  // Discover opportunities from recent crawl results using Gemini
  const run_discover = async (): Promise<{
    analyzed_tasks: number;
    created: string[];
    skipped: string[];
  }> => {
    const created: string[] = [];
    const skipped: string[] = [];

    // Early return if no Gemini config provided
    if (!deps.gemini_config) {
      return { analyzed_tasks: 0, created, skipped };
    }

    // Get recent crawl tasks
    const crawl_tasks = get_recent_crawl_tasks();
    if (crawl_tasks.length === 0) {
      return { analyzed_tasks: 0, created, skipped };
    }

    // Build summaries from crawl task outputs
    const summaries = crawl_tasks.map((t) => {
      const output_summary = t.output?.summary ?? '(no summary)';
      return `[${t.title}] ${output_summary}`;
    });

    // Call Gemini to analyze and suggest tasks
    const prompt = build_discover_prompt(summaries);

    let response;
    try {
      response = await spawn_gemini(deps.gemini_config, prompt);
    } catch (err) {
      // Fire-and-forget: log warning and continue
      console.warn('[discover_opportunities] Gemini call failed:', err);
      return { analyzed_tasks: crawl_tasks.length, created, skipped };
    }

    if (!response.success) {
      console.warn('[discover_opportunities] Gemini returned error:', response.error);
      return { analyzed_tasks: crawl_tasks.length, created, skipped };
    }

    // Parse suggestions from Gemini response
    const suggestions = parse_suggestions(response.content);

    // Create tasks for valid suggestions (with deduplication)
    for (const suggestion of suggestions) {
      if (is_already_queued(suggestion.title)) {
        skipped.push(`${suggestion.title} (already queued)`);
        continue;
      }

      deps.store.create({
        title: suggestion.title,
        description: suggestion.description,
        assigned_to: suggestion.agent,
        priority: suggestion.priority,
        mode: 'sleep',
        risk_level: 'low',
        requires_personal_info: false,
      });

      created.push(suggestion.title);
    }

    // Send notification about discovered opportunities
    if (created.length > 0) {
      const discover_msg = `[Discovery] ${created.length} opportunities found from ${crawl_tasks.length} crawl results:\n${created.map((t) => `• ${t}`).join('\n')}`;
      await deps.router.route({
        type: 'briefing',
        message: discover_msg,
        device: 'captain',
      });
    }

    return { analyzed_tasks: crawl_tasks.length, created, skipped };
  };

  // Night planning: send daily summary + discover opportunities
  const run_night = async (): Promise<{
    summary: { done: number; blocked: number; pending: number };
    discovery?: { analyzed_tasks: number; created: string[]; skipped: string[] };
  }> => {
    const stats = deps.store.get_stats();
    const summary = {
      done: stats.done ?? 0,
      blocked: stats.blocked ?? 0,
      pending: stats.pending ?? 0,
    };

    const night_msg = `[Night Summary] Done: ${summary.done}, Blocked: ${summary.blocked}, Pending: ${summary.pending}`;
    await deps.router.route({
      type: 'briefing',
      message: night_msg,
      device: 'captain',
    });

    // Run discovery if gemini_config is provided
    let discovery: { analyzed_tasks: number; created: string[]; skipped: string[] } | undefined;
    if (deps.gemini_config) {
      discovery = await run_discover();
    }

    return { summary, discovery };
  };

  return {
    run_morning,
    run_night,
    run_discover,
    // Exposed for testing
    _is_due_today: is_due_today,
    _load_schedules: load_schedules,
  };
};

export type PlanningLoop = ReturnType<typeof create_planning_loop>;

---

## 파일: [OPS] src/gateway/cross_approval.ts

// Cross-approval module for FAS
// Requests approval from Gemini CLI for MID-risk actions
// Auto-rejects on timeout or parse failure (secure by default)

import { spawn } from 'node:child_process';
import type { CrossApprovalResult, CrossApprovalConfig } from '../shared/types.js';

const DEFAULT_TIMEOUT_MS = 600_000; // 10 minutes
const DEFAULT_GEMINI_COMMAND = 'gemini';

// === Build the prompt for Gemini to evaluate an action ===

const build_prompt = (action: string, context: string): string =>
  `You are a security reviewer for the FAS (Fully Automation System).
Evaluate the following action and respond with ONLY a JSON object (no markdown, no explanation).

Action: ${action}
Context: ${context}

Respond in this exact JSON format:
{"decision": "approved" | "rejected", "reason": "one sentence explanation"}`;

// === Execute Gemini CLI and capture stdout ===

const exec_gemini = (command: string, prompt: string, timeout_ms: number): Promise<string> => {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, [prompt], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeout_ms,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Gemini CLI exited with code ${code}: ${stderr.trim()}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
};

// === Parse Gemini response JSON ===

const parse_response = (raw: string): { decision: 'approved' | 'rejected'; reason: string } => {
  // Try to extract JSON from the response (Gemini may add surrounding text)
  const json_match = raw.match(/\{[\s\S]*"decision"[\s\S]*\}/);
  if (!json_match) {
    throw new Error(`No JSON found in Gemini response: ${raw.slice(0, 200)}`);
  }

  const parsed = JSON.parse(json_match[0]) as Record<string, unknown>;

  if (parsed.decision !== 'approved' && parsed.decision !== 'rejected') {
    throw new Error(`Invalid decision value: ${String(parsed.decision)}`);
  }

  return {
    decision: parsed.decision,
    reason: typeof parsed.reason === 'string' ? parsed.reason : 'No reason provided',
  };
};

// === Factory: create cross-approval client ===

export const create_cross_approval = (config: CrossApprovalConfig = {}) => {
  const gemini_command = config.gemini_command ?? DEFAULT_GEMINI_COMMAND;
  const timeout_ms = config.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  const auto_reject = config.auto_reject_on_error ?? true;

  const request_approval = async (
    action: string,
    context: string,
  ): Promise<CrossApprovalResult> => {
    const prompt = build_prompt(action, context);

    try {
      const raw = await exec_gemini(gemini_command, prompt, timeout_ms);
      const { decision, reason } = parse_response(raw);

      return {
        decision,
        reason,
        reviewed_by: 'gemini_a',
        reviewed_at: new Date().toISOString(),
      };
    } catch (err) {
      const error_msg = err instanceof Error ? err.message : String(err);
      console.warn(`[CrossApproval] Error: ${error_msg}`);

      if (auto_reject) {
        return {
          decision: 'rejected',
          reason: `Auto-rejected due to error: ${error_msg}`,
          reviewed_by: 'system',
          reviewed_at: new Date().toISOString(),
        };
      }

      throw err;
    }
  };

  return { request_approval };
};

export type CrossApproval = ReturnType<typeof create_cross_approval>;

---

## 파일: [OPS] src/gateway/mode_manager.ts

// SLEEP/AWAKE mode manager for FAS Gateway
// Controls which actions are allowed based on current operating mode

import type { FasMode, ModeState, ModeTransitionRequest, RiskLevel } from '../shared/types.js';

// === Configuration ===

export type ModeManagerConfig = {
  sleep_start_hour: number;     // default: 23
  sleep_end_hour: number;       // default: 7
  sleep_end_minute: number;     // default: 30
  initial_mode?: FasMode;
};

// Actions blocked in SLEEP mode regardless of risk level
const SLEEP_BLOCKED_ACTIONS = new Set([
  'git_push', 'pr_creation', 'deploy', 'external_api_call',
  'account_action', 'financial_action', 'package_install',
]);

// === Factory ===

export const create_mode_manager = (config: ModeManagerConfig) => {
  let state: ModeState = {
    current_mode: config.initial_mode ?? 'awake',
    switched_at: new Date().toISOString(),
    switched_by: 'api',
    next_scheduled_switch: calculate_next_switch(config.initial_mode ?? 'awake', config),
  };

  const get_state = (): Readonly<ModeState> => ({ ...state });

  const transition = (request: ModeTransitionRequest): {
    success: boolean;
    previous_mode: FasMode;
    current_mode: FasMode;
    reason?: string;
  } => {
    const previous = state.current_mode;
    if (previous === request.target_mode) {
      return { success: true, previous_mode: previous, current_mode: previous, reason: 'Already in target mode' };
    }
    state = {
      current_mode: request.target_mode,
      switched_at: new Date().toISOString(),
      switched_by: request.requested_by,
      next_scheduled_switch: calculate_next_switch(request.target_mode, config),
    };
    return { success: true, previous_mode: previous, current_mode: state.current_mode };
  };

  // Check if an action is allowed in current mode
  const is_action_allowed = (action: string, risk_level: RiskLevel): boolean => {
    if (state.current_mode === 'awake') return true;

    // SLEEP mode restrictions:
    // HIGH/CRITICAL risk always blocked
    if (risk_level === 'high' || risk_level === 'critical') return false;

    // Specific actions blocked in SLEEP mode
    if (SLEEP_BLOCKED_ACTIONS.has(action)) return false;

    return true;
  };

  return { get_state, transition, is_action_allowed };
};

// Calculate next scheduled mode switch time
const calculate_next_switch = (current_mode: FasMode, config: ModeManagerConfig): string | null => {
  const now = new Date();
  const target = new Date(now);
  if (current_mode === 'sleep') {
    // Next switch: AWAKE at sleep_end_hour:sleep_end_minute
    target.setHours(config.sleep_end_hour, config.sleep_end_minute, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
  } else {
    // Next switch: SLEEP at sleep_start_hour:00
    target.setHours(config.sleep_start_hour, 0, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
  }
  return target.toISOString();
};

export type ModeManager = ReturnType<typeof create_mode_manager>;

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
  // Phone numbers (010-xxxx-xxxx variants, with optional spaces around hyphens)
  {
    name: 'phone_number',
    regex: /01[016789]\s*-?\s*\d{3,4}\s*-?\s*\d{4}/g,
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
  // Credit card numbers (4 groups of 4 digits, with optional spaces) — must be before bank_account
  {
    name: 'credit_card',
    regex: /\b\d{4}\s*[- ]\s*\d{4}\s*[- ]\s*\d{4}\s*[- ]\s*\d{4}\b/g,
    replacement: '[카드번호 제거됨]',
  },
  // IP addresses (private/Tailscale ranges) — must be before bank_account
  {
    name: 'ip_address',
    regex: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1[0-2]\d)\.\d{1,3}\.\d{1,3})\b/g,
    replacement: '[IP 제거됨]',
  },
  // Bank account numbers (3-4 digit groups with hyphens, with optional spaces)
  {
    name: 'bank_account',
    regex: /\d{3,4}\s*-\s*\d{2,6}\s*-\s*\d{2,6}/g,
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
  return PII_PATTERNS.some((pattern) => {
    // Reset lastIndex for global regex to avoid stateful matching bugs
    pattern.regex.lastIndex = 0;
    return pattern.regex.test(text);
  });
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

  // Dev mode: only allowed when explicitly set AND not in production
  const is_production = process.env.NODE_ENV === 'production';
  const dev_mode_requested = process.env.NODE_ENV === 'development' || process.env.FAS_DEV_MODE === 'true';
  const dev_mode = dev_mode_requested && !is_production;

  // Guard: reject dev_mode in production environment
  if (dev_mode_requested && is_production) {
    console.error('[Gateway] FATAL: FAS_DEV_MODE=true is forbidden when NODE_ENV=production. Refusing to start.');
    process.exit(1);
  }

  if (!process.env.HUNTER_API_KEY && !dev_mode) {
    console.error('[Gateway] FATAL: HUNTER_API_KEY is not set and dev mode is off. Refusing to start.');
    console.error('[Gateway] Set HUNTER_API_KEY or FAS_DEV_MODE=true to proceed.');
    process.exit(1);
  }

  // Warn loudly when dev mode is active — should never reach production
  if (dev_mode) {
    console.warn('[Gateway] ⚠️  DEV MODE ACTIVE — Hunter auth is DISABLED. Do NOT use in production.');
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

---

## 파일: [OPS] src/gateway/task_store.ts

// SQLite-based task store for FAS
// Manages task lifecycle: create -> pending -> in_progress -> done/blocked

import Database from 'better-sqlite3';
import { v4 as uuid_v4 } from 'uuid';
import type { Task, TaskStatus, RiskLevel } from '../shared/types.js';

// === Task store using SQLite ===

export type TaskStoreConfig = {
  db_path: string;             // ':memory:' for testing
  busy_timeout_ms?: number;    // SQLite busy timeout (default: 5000ms)
};

export const create_task_store = (config: TaskStoreConfig) => {
  const db = new Database(config.db_path);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // Busy timeout: wait instead of failing immediately on SQLITE_BUSY
  db.pragma(`busy_timeout = ${config.busy_timeout_ms ?? 5000}`);

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

  // Run a function inside a SQLite transaction (atomic, auto-rollback on error)
  const run_in_transaction = <T>(fn: () => T): T => {
    return db.transaction(fn)();
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
    run_in_transaction,
    close,
    _db: db, // for testing
  };
};

export type TaskStore = ReturnType<typeof create_task_store>;

---

## 파일: [OPS] src/gemini/cli_wrapper.ts

// Gemini CLI wrapper module for FAS
// Spawns Gemini CLI as child process with timeout, retry, and output parsing
// Used by: cross-approval verification, research tasks, fact-checking

import { spawn } from 'node:child_process';
import { execSync } from 'node:child_process';
import type { GeminiAccount, GeminiConfig, GeminiResponse, GeminiSessionStatus } from './types.js';

// === Constants ===

const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes
const DEFAULT_GEMINI_COMMAND = 'gemini';

const SESSION_NAMES: Record<GeminiAccount, string> = {
  a: 'fas-gemini-a',
  b: 'fas-gemini-b',
};

// === Get CLI command for a specific account ===

export const get_gemini_command = (account: GeminiAccount, base_command?: string): string => {
  const cmd = base_command ?? DEFAULT_GEMINI_COMMAND;
  // Account-specific config directories allow multiple Gemini accounts
  // Account A uses default config, Account B uses alternate config dir
  if (account === 'b') {
    return `GEMINI_CONFIG_DIR=$HOME/.gemini-b ${cmd}`;
  }
  return cmd;
};

// === Parse Gemini CLI output ===

export const parse_gemini_response = (raw_output: string): string => {
  // Remove ANSI escape codes
  const cleaned = raw_output.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').trim();

  // Try to extract JSON if present
  const json_match = cleaned.match(/\{[\s\S]*\}/);
  if (json_match) {
    try {
      const parsed = JSON.parse(json_match[0]);
      return JSON.stringify(parsed, null, 2);
    } catch {
      // Not valid JSON, return cleaned text
    }
  }

  return cleaned;
};

// === Spawn Gemini CLI and capture output ===

export const spawn_gemini = (config: GeminiConfig, prompt: string): Promise<GeminiResponse> => {
  const timeout_ms = config.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  const command = config.gemini_command ?? DEFAULT_GEMINI_COMMAND;
  const start_time = Date.now();

  return new Promise((resolve) => {
    const args = [prompt];
    if (config.model) {
      args.unshift('--model', config.model);
    }

    // For account B, set alternate config directory
    const env = { ...process.env };
    if (config.account === 'b') {
      env.GEMINI_CONFIG_DIR = `${process.env.HOME}/.gemini-b`;
    }

    const proc = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
      shell: true,
      timeout: timeout_ms,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      const duration_ms = Date.now() - start_time;

      if (code === 0) {
        resolve({
          content: parse_gemini_response(stdout),
          raw_output: stdout,
          success: true,
          duration_ms,
        });
      } else {
        resolve({
          content: '',
          raw_output: stdout,
          success: false,
          error: `Gemini CLI exited with code ${code}: ${stderr.trim()}`,
          duration_ms,
        });
      }
    });

    proc.on('error', (err) => {
      const duration_ms = Date.now() - start_time;
      resolve({
        content: '',
        raw_output: '',
        success: false,
        error: `Failed to spawn Gemini CLI: ${err.message}`,
        duration_ms,
      });
    });
  });
};

// === Check tmux session status for a Gemini account ===

export const check_session_status = (account: GeminiAccount): GeminiSessionStatus => {
  const session_name = SESSION_NAMES[account];

  try {
    const output = execSync(`tmux has-session -t ${session_name} 2>&1 || true`, {
      encoding: 'utf-8',
      timeout: 5000,
    });

    // tmux has-session returns empty string on success, error message on failure
    if (output.trim() === '' || !output.includes('no server') && !output.includes("can't find")) {
      // Session exists, check if process is alive
      try {
        const pane_pid = execSync(
          `tmux list-panes -t ${session_name} -F '#{pane_pid}' 2>/dev/null`,
          { encoding: 'utf-8', timeout: 5000 },
        ).trim();

        if (pane_pid) {
          return 'running';
        }
      } catch {
        return 'crashed';
      }
    }

    return 'stopped';
  } catch {
    return 'stopped';
  }
};

// === Get session name for account ===

export const get_session_name = (account: GeminiAccount): string => SESSION_NAMES[account];

---

## 파일: [OPS] src/gemini/index.ts

// Gemini CLI module barrel export
export { spawn_gemini, parse_gemini_response, check_session_status, get_gemini_command, get_session_name } from './cli_wrapper.js';
export type { GeminiAccount, GeminiConfig, GeminiResponse, GeminiSessionStatus, GeminiSessionInfo } from './types.js';

---

## 파일: [OPS] src/gemini/types.ts

// Local type definitions for Gemini CLI module
// Kept separate from src/shared/types.ts to avoid cross-session conflicts

export type GeminiAccount = 'a' | 'b';

export type GeminiConfig = {
  account: GeminiAccount;
  timeout_ms?: number;           // Default: 300_000 (5 min)
  model?: string;                // Default: undefined (use CLI default)
  gemini_command?: string;       // Default: 'gemini'
};

export type GeminiResponse = {
  content: string;               // Parsed/cleaned response content
  raw_output: string;            // Raw stdout from CLI
  success: boolean;
  error?: string;
  duration_ms: number;
};

export type GeminiSessionStatus = 'running' | 'stopped' | 'crashed';

export type GeminiSessionInfo = {
  account: GeminiAccount;
  status: GeminiSessionStatus;
  session_name: string;          // tmux session name (fas-gemini-a, fas-gemini-b)
  pid?: number;
};

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

## 파일: [OPS] src/hunter/browser.ts

// Browser manager for Hunter agent
// Manages Playwright browser lifecycle with lazy initialization and cleanup
// Uses Chromium via Playwright for all browser automation tasks
//
// Two modes:
// 1. get_page() — Ephemeral browser for web_crawl/browser_task (headless OK)
// 2. get_persistent_page() — Persistent Chrome profile for Google services
//    (Gemini Deep Research, NotebookLM) that require cookie-based login

import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';

export type BrowserManagerConfig = {
  headless?: boolean;    // default: true
  timeout_ms?: number;   // default: 30_000
};

export type BrowserManager = {
  // Get a new page (lazy-initializes browser on first call)
  get_page: () => Promise<Page>;
  // Get a page from persistent Chrome profile (for Google login sessions)
  get_persistent_page: (profile_dir: string) => Promise<Page>;
  // Close the persistent context only
  close_persistent: () => Promise<void>;
  // Close browser and release resources
  close: () => Promise<void>;
};

const DEFAULT_CONFIG: Required<BrowserManagerConfig> = {
  headless: true,
  timeout_ms: 30_000,
};

// Factory function to create a browser manager instance
export const create_browser_manager = (config: BrowserManagerConfig = {}): BrowserManager => {
  const resolved = { ...DEFAULT_CONFIG, ...config };
  let browser: Browser | null = null;

  // Persistent context state — only one at a time
  let persistent_context: BrowserContext | null = null;
  let persistent_profile_dir: string | null = null;

  // Lazy initialization — browser is launched only on first get_page() call
  const ensure_browser = async (): Promise<Browser> => {
    if (!browser || !browser.isConnected()) {
      browser = await chromium.launch({
        headless: resolved.headless,
      });
    }
    return browser;
  };

  const get_page = async (): Promise<Page> => {
    const b = await ensure_browser();
    const context = await b.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(resolved.timeout_ms);
    page.setDefaultNavigationTimeout(resolved.timeout_ms);
    return page;
  };

  // Get a page from a persistent Chrome profile directory.
  // Google services (Gemini, NotebookLM) require non-headless mode for cookie persistence.
  // Only one persistent context is active at a time — if the profile_dir changes,
  // the previous context is closed before opening the new one.
  const get_persistent_page = async (profile_dir: string): Promise<Page> => {
    // If profile_dir changed, close the old persistent context
    if (persistent_context && persistent_profile_dir !== profile_dir) {
      try { await persistent_context.close(); } catch { /* ignore cleanup errors */ }
      persistent_context = null;
      persistent_profile_dir = null;
    }

    // Create persistent context if needed
    if (!persistent_context) {
      persistent_context = await chromium.launchPersistentContext(profile_dir, {
        // Google services block headless browsers — must use headed mode
        headless: false,
        // Standard viewport for consistent UI interaction
        viewport: { width: 1280, height: 900 },
      });
      persistent_profile_dir = profile_dir;
    }

    const page = await persistent_context.newPage();
    page.setDefaultTimeout(resolved.timeout_ms);
    page.setDefaultNavigationTimeout(resolved.timeout_ms);
    return page;
  };

  // Close only the persistent context (preserves the ephemeral browser)
  const close_persistent = async (): Promise<void> => {
    if (persistent_context) {
      try { await persistent_context.close(); } catch { /* ignore cleanup errors */ }
      persistent_context = null;
      persistent_profile_dir = null;
    }
  };

  const close = async (): Promise<void> => {
    // Close persistent context first
    await close_persistent();

    // Then close the ephemeral browser
    if (browser && browser.isConnected()) {
      await browser.close();
      browser = null;
    }
  };

  return { get_page, get_persistent_page, close_persistent, close };
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
  // Google Chrome profile directory for persistent login sessions
  google_profile_dir: string;
  // Timeout for Gemini Deep Research automation (research can take 1-5 min)
  deep_research_timeout_ms: number;
  // Timeout for NotebookLM verification automation
  notebooklm_timeout_ms: number;
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
    google_profile_dir: process.env.GOOGLE_PROFILE_DIR ?? './fas-google-profile-hunter',
    deep_research_timeout_ms: parseInt(process.env.DEEP_RESEARCH_TIMEOUT_MS ?? '300000', 10),
    notebooklm_timeout_ms: parseInt(process.env.NOTEBOOKLM_TIMEOUT_MS ?? '180000', 10),
  };
};

---

## 파일: [OPS] src/hunter/index.ts

// Hunter module — barrel export

export { load_hunter_config, type HunterConfig } from './config.js';
export { create_api_client, type ApiClient, type ApiClientConfig } from './api_client.js';
export { create_task_executor, resolve_action } from './task_executor.js';
export { create_poll_loop, type PollLoopDeps, type PollLoopState } from './poll_loop.js';
export { create_logger, type Logger } from './logger.js';

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
// Polls Captain's Task API, executes tasks via Playwright browser automation
//
// Usage:
//   npx tsx src/hunter/main.ts
//   # or via package.json:
//   pnpm run hunter
//
// Env vars:
//   CAPTAIN_API_URL          — Captain Task API (default: http://[MASKED_IP]:3100)
//   HUNTER_POLL_INTERVAL     — Poll interval in ms (default: 10000)
//   HUNTER_LOG_DIR           — Log directory (default: ./logs)
//   HUNTER_HEADLESS          — Headless browser mode (default: true)
//   GOOGLE_PROFILE_DIR       — Chrome profile for Google login (default: ./fas-google-profile-hunter)
//   DEEP_RESEARCH_TIMEOUT_MS — Gemini Deep Research timeout (default: 300000)
//   NOTEBOOKLM_TIMEOUT_MS    — NotebookLM timeout (default: 180000)

import { load_hunter_config } from './config.js';
import { create_api_client } from './api_client.js';
import { create_browser_manager } from './browser.js';
import { create_task_executor } from './task_executor.js';
import { create_poll_loop } from './poll_loop.js';
import { create_logger } from './logger.js';

const is_main = import.meta.url === `file://${process.argv[1]}`;

if (is_main) {
  const config = load_hunter_config();
  const logger = create_logger(config.log_dir);

  // Initialize browser manager with optional headless config
  const headless = process.env.HUNTER_HEADLESS !== 'false';
  const browser = create_browser_manager({ headless });

  const api = create_api_client({ base_url: config.captain_api_url }, logger);

  // Pass Google profile and timeout config to task executor
  const executor = create_task_executor(logger, browser, {
    google_profile_dir: config.google_profile_dir,
    deep_research_timeout_ms: config.deep_research_timeout_ms,
    notebooklm_timeout_ms: config.notebooklm_timeout_ms,
  });

  const loop = create_poll_loop({ api, executor, logger, config });

  logger.info(`Hunter agent starting — polling ${config.captain_api_url} every ${config.poll_interval_ms}ms`);
  logger.info(`Browser mode: ${headless ? 'headless' : 'headed'}`);
  logger.info(`Google profile: ${config.google_profile_dir}`);
  loop.start();

  // Graceful shutdown — close browser and stop polling
  const shutdown = async () => {
    logger.info('Hunter agent shutting down...');
    loop.stop();
    await browser.close();
    logger.info('Browser closed. Exiting.');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

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

## 파일: [OPS] src/hunter/task_executor.ts

// Task executor with action routing
// Dispatches tasks to Playwright-based browser handlers or structured TODOs

import { mkdirSync } from 'node:fs';
import type { Page } from 'playwright';
import type { Task, HunterActionType, HunterTaskResult } from '../shared/types.js';
import type { Logger } from './logger.js';
import type { BrowserManager } from './browser.js';

type ActionHandler = (task: Task) => Promise<HunterTaskResult>;

// Maximum characters to extract from page content
const MAX_CONTENT_LENGTH = 10_000;

// Output directory for screenshots and artifacts
const OUTPUT_DIR = './output';

// Polling interval for checking research completion (ms)
const RESEARCH_POLL_INTERVAL_MS = 10_000;

// ===== URL extraction helper =====
// Extracts the first http/https URL from a text string
export const extract_url = (text: string): string | null => {
  const match = text.match(/https?:\/\/[^\s<>"')\]]+/);
  return match ? match[0] : null;
};

// ===== Login wall detection helper =====
// Checks if the current page is showing a Google login/sign-in screen.
// Google services redirect to accounts.google.com when not authenticated.
export const detect_login_wall = async (page: Page): Promise<boolean> => {
  const url = page.url();

  // Primary check: URL-based detection — Google login always redirects here
  if (url.includes('accounts.google.com')) {
    return true;
  }

  // Secondary check: look for "Sign in" button or heading on the page
  // This catches cases where the login form is embedded or URL hasn't changed yet
  try {
    const sign_in_visible = await page.locator('text="Sign in"').first().isVisible({ timeout: 2_000 });
    if (sign_in_visible) {
      // Confirm it's actually a login page, not just a page mentioning "Sign in"
      const has_google_branding = await page.locator('[data-ogsr-up], #identifierId, [data-email], input[type="email"]')
        .first().isVisible({ timeout: 1_000 }).catch(() => false);
      return has_google_branding;
    }
  } catch {
    // Timeout or element not found — not a login wall
  }

  return false;
};

// Resolve action type from task title/description keywords
export const resolve_action = (task: Task): HunterActionType => {
  const text = `${task.title} ${task.description ?? ''}`.toLowerCase();

  if (text.includes('notebooklm') || text.includes('notebook_lm')) return 'notebooklm_verify';
  if (text.includes('deep research') || text.includes('deep_research')) return 'deep_research';
  if (text.includes('crawl') || text.includes('scrape') || text.includes('크롤링')) return 'web_crawl';
  return 'browser_task'; // default fallback
};

export type TaskExecutorConfig = {
  google_profile_dir: string;
  deep_research_timeout_ms: number;
  notebooklm_timeout_ms: number;
};

export const create_task_executor = (
  logger: Logger,
  browser: BrowserManager,
  config?: TaskExecutorConfig,
) => {
  // Default config for backwards compatibility
  const executor_config: TaskExecutorConfig = config ?? {
    google_profile_dir: './fas-google-profile-hunter',
    deep_research_timeout_ms: 300_000,
    notebooklm_timeout_ms: 180_000,
  };

  // ===== web_crawl handler =====
  // Navigates to URL, extracts page title and text content
  const handle_web_crawl: ActionHandler = async (task) => {
    const text = `${task.title} ${task.description ?? ''}`;
    const url = extract_url(text);

    if (!url) {
      logger.warn(`web_crawl: no URL found in task ${task.id}`);
      return {
        status: 'failure',
        output: `No URL found in task description: "${text}"`,
        files: [],
      };
    }

    logger.info(`web_crawl: navigating to ${url}`);
    let page;
    try {
      page = await browser.get_page();
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const title = await page.title();
      const body_text = await page.textContent('body') ?? '';
      const trimmed = body_text.trim().slice(0, MAX_CONTENT_LENGTH);

      logger.info(`web_crawl: extracted ${trimmed.length} chars from ${url}`);

      return {
        status: 'success',
        output: `Title: ${title}\nURL: ${url}\n\n${trimmed}`,
        files: [],
      };
    } catch (err) {
      const error_msg = err instanceof Error ? err.message : String(err);
      logger.error(`web_crawl failed for ${url}: ${error_msg}`);
      return {
        status: 'failure',
        output: `web_crawl error for ${url}: ${error_msg}`,
        files: [],
      };
    } finally {
      // Close the page context to free resources
      if (page) {
        try { await page.context().close(); } catch { /* ignore cleanup errors */ }
      }
    }
  };

  // ===== browser_task handler =====
  // Generic browser interaction: navigate, screenshot, extract text
  const handle_browser_task: ActionHandler = async (task) => {
    const text = `${task.title} ${task.description ?? ''}`;
    const url = extract_url(text);

    if (!url) {
      logger.warn(`browser_task: no URL found in task ${task.id}`);
      return {
        status: 'failure',
        output: `No URL found in task description: "${text}"`,
        files: [],
      };
    }

    logger.info(`browser_task: navigating to ${url}`);
    let page;
    try {
      page = await browser.get_page();
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const title = await page.title();
      const body_text = await page.textContent('body') ?? '';
      const trimmed = body_text.trim().slice(0, MAX_CONTENT_LENGTH);

      // Save screenshot to output directory
      mkdirSync(OUTPUT_DIR, { recursive: true });
      const screenshot_path = `${OUTPUT_DIR}/${task.id}.png`;
      await page.screenshot({ path: screenshot_path, fullPage: true });

      logger.info(`browser_task: screenshot saved to ${screenshot_path}`);

      return {
        status: 'success',
        output: `Title: ${title}\nURL: ${url}\nScreenshot: ${screenshot_path}\n\n${trimmed}`,
        files: [screenshot_path],
      };
    } catch (err) {
      const error_msg = err instanceof Error ? err.message : String(err);
      logger.error(`browser_task failed for ${url}: ${error_msg}`);
      return {
        status: 'failure',
        output: `browser_task error for ${url}: ${error_msg}`,
        files: [],
      };
    } finally {
      if (page) {
        try { await page.context().close(); } catch { /* ignore cleanup errors */ }
      }
    }
  };

  // ===== deep_research handler =====
  // Automates Gemini Deep Research via persistent Chrome profile.
  // Flow: navigate to Gemini → type research query → wait for completion → extract results
  const handle_deep_research: ActionHandler = async (task) => {
    logger.info(`deep_research: starting for task ${task.id}`);
    let page: Page | undefined;

    try {
      // Step 1: Get a page from the persistent Google profile
      page = await browser.get_persistent_page(executor_config.google_profile_dir);

      // Step 2: Navigate to Gemini web app
      await page.goto('https://gemini.google.com/app', {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });

      // Wait for page to fully load (Gemini is a SPA, needs extra time)
      await page.waitForTimeout(3_000);

      // Step 3: Check for login wall — if not authenticated, report back
      if (await detect_login_wall(page)) {
        logger.warn(`deep_research: Google login required for task ${task.id}`);
        return {
          status: 'failure',
          output: '[LOGIN_REQUIRED] Google login session expired. Run setup_hunter.sh to re-authenticate.',
          files: [],
        };
      }

      // Step 4: Find the chat input textarea
      // Gemini uses a rich text editor — try multiple selector strategies
      const input_selector = [
        // Rich text editor contenteditable div (primary)
        '[contenteditable="true"][role="textbox"]',
        // Fallback: aria-label based selector
        '[aria-label*="prompt" i]',
        // Fallback: generic rich text input
        '.ql-editor',
        // Fallback: plain textarea
        'textarea',
      ].join(', ');

      const input = page.locator(input_selector).first();
      await input.waitFor({ state: 'visible', timeout: 15_000 });

      // Step 5: Type the research query with "Deep Research:" prefix
      const query = `Deep Research: ${task.description ?? task.title}`;
      await input.click();
      await input.fill(query);
      logger.info(`deep_research: typed query for task ${task.id}`);

      // Step 6: Click the send button
      // Gemini's send button uses various selectors depending on version
      const send_selector = [
        // Send button by aria-label
        '[aria-label*="Send" i]',
        '[aria-label*="submit" i]',
        // Material icon send button
        'button[mattooltip*="Send" i]',
        // Fallback: button with send icon near the input
        'button.send-button',
      ].join(', ');

      const send_button = page.locator(send_selector).first();
      await send_button.waitFor({ state: 'visible', timeout: 5_000 });
      await send_button.click();
      logger.info(`deep_research: query submitted for task ${task.id}`);

      // Step 7: Wait for research completion via polling
      // Deep Research can take 1-5 minutes. We poll every 10 seconds
      // looking for completion indicators in the response area.
      const deadline = Date.now() + executor_config.deep_research_timeout_ms;
      let research_complete = false;

      while (Date.now() < deadline) {
        await page.waitForTimeout(RESEARCH_POLL_INTERVAL_MS);

        // Check for completion indicators:
        // - "Deep Research is complete" text
        // - Research report/result container
        // - Stop/regenerate button appearing (indicates generation finished)
        const page_text = await page.textContent('body') ?? '';
        const completion_indicators = [
          'deep research is complete',
          'research complete',
          'research report',
          'here is the research',
          'based on my research',
        ];

        const found_indicator = completion_indicators.some(
          (indicator) => page_text.toLowerCase().includes(indicator),
        );

        if (found_indicator) {
          research_complete = true;
          logger.info(`deep_research: research completed for task ${task.id}`);
          break;
        }

        // Also check if response has stopped generating (no loading spinner)
        const is_loading = await page.locator('[class*="loading"], [class*="spinner"], [class*="progress"]')
          .first().isVisible({ timeout: 1_000 }).catch(() => false);

        // If we have substantial text and no loading indicator, consider it done
        if (!is_loading && page_text.length > 500) {
          // Check if the response area has content (model finished generating)
          const response_containers = page.locator('[class*="response"], [class*="message-content"], .model-response');
          const response_count = await response_containers.count();
          if (response_count > 0) {
            const last_response_text = await response_containers.last().textContent() ?? '';
            if (last_response_text.length > 200) {
              research_complete = true;
              logger.info(`deep_research: response detected (no loading indicator) for task ${task.id}`);
              break;
            }
          }
        }

        logger.info(`deep_research: still waiting... (${Math.round((deadline - Date.now()) / 1000)}s remaining)`);
      }

      if (!research_complete) {
        logger.warn(`deep_research: timeout waiting for research completion (task ${task.id})`);
        // Still try to extract whatever is on the page
      }

      // Step 8: Extract the research result text
      // Try to get the latest model response from the conversation
      const response_selectors = [
        // Model response containers (Gemini-specific)
        '[class*="model-response"]',
        '[class*="response-container"]',
        '[class*="message-content"]',
        // Markdown rendered content area
        '.markdown-content',
        '[class*="markdown"]',
        // Fallback: the main content area
        'main',
      ];

      let result_text = '';
      for (const selector of response_selectors) {
        const elements = page.locator(selector);
        const count = await elements.count();
        if (count > 0) {
          // Get the last response element (most recent answer)
          result_text = await elements.last().textContent() ?? '';
          if (result_text.trim().length > 100) {
            break;
          }
        }
      }

      // Fallback: extract full body text if no specific response found
      if (result_text.trim().length < 100) {
        result_text = await page.textContent('body') ?? '';
      }

      // Step 9: Return success with extracted text (truncated)
      const trimmed = result_text.trim().slice(0, MAX_CONTENT_LENGTH);
      logger.info(`deep_research: extracted ${trimmed.length} chars for task ${task.id}`);

      return {
        status: 'success',
        output: trimmed,
        files: [],
      };
    } catch (err) {
      const error_msg = err instanceof Error ? err.message : String(err);
      logger.error(`deep_research failed for task ${task.id}: ${error_msg}`);
      return {
        status: 'failure',
        output: `deep_research error: ${error_msg}`,
        files: [],
      };
    } finally {
      // Close the page but keep the persistent context alive for session reuse
      if (page) {
        try { await page.close(); } catch { /* ignore cleanup errors */ }
      }
    }
  };

  // ===== notebooklm_verify handler =====
  // Automates NotebookLM verification via persistent Chrome profile.
  // Flow: navigate to NotebookLM → open notebook → ask verification query → extract response
  const handle_notebooklm_verify: ActionHandler = async (task) => {
    logger.info(`notebooklm_verify: starting for task ${task.id}`);
    let page: Page | undefined;

    try {
      const task_text = `${task.title} ${task.description ?? ''}`;

      // Step 1: Get a page from the persistent Google profile
      page = await browser.get_persistent_page(executor_config.google_profile_dir);

      // Step 2: Check if the task contains a direct notebook URL
      const notebook_url = extract_url(task_text);
      const target_url = notebook_url && notebook_url.includes('notebooklm.google.com')
        ? notebook_url
        : 'https://notebooklm.google.com/';

      await page.goto(target_url, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });

      // Wait for SPA to fully render
      await page.waitForTimeout(3_000);

      // Step 3: Check for login wall
      if (await detect_login_wall(page)) {
        logger.warn(`notebooklm_verify: Google login required for task ${task.id}`);
        return {
          status: 'failure',
          output: '[LOGIN_REQUIRED] Google login session expired. Run setup_hunter.sh to re-authenticate.',
          files: [],
        };
      }

      // Step 4: If we navigated to the main page (not a direct notebook URL),
      // try to find the notebook by name in the list
      if (!notebook_url || !notebook_url.includes('notebooklm.google.com/notebook/')) {
        // Extract notebook name from task description
        // Expected format: "notebooklm: <notebook_name> — <query>" or similar
        const notebook_name_match = task_text.match(/notebook[_\s]*(?:lm)?[:\s]+([^—\-\n]+)/i);
        const notebook_name = notebook_name_match?.[1]?.trim();

        if (notebook_name) {
          // Look for notebook in the list by its title text
          const notebook_link = page.locator(`text="${notebook_name}"`).first();
          const is_visible = await notebook_link.isVisible({ timeout: 10_000 }).catch(() => false);

          if (is_visible) {
            await notebook_link.click();
            await page.waitForTimeout(3_000); // Wait for notebook to open
            logger.info(`notebooklm_verify: opened notebook "${notebook_name}"`);
          } else {
            logger.warn(`notebooklm_verify: notebook "${notebook_name}" not found in list`);
            return {
              status: 'failure',
              output: `Notebook "${notebook_name}" not found in NotebookLM. Available notebooks may have different names.`,
              files: [],
            };
          }
        }
        // If no notebook name specified and no URL, we proceed with whatever is open
      }

      // Step 5: Find the chat/ask input in NotebookLM
      // NotebookLM has a chat interface at the bottom of the notebook view
      const chat_input_selector = [
        // NotebookLM chat input area
        '[contenteditable="true"]',
        'textarea[placeholder*="Ask" i]',
        'textarea[placeholder*="question" i]',
        // Generic textarea fallback
        'textarea',
        // Input with role
        '[role="textbox"]',
      ].join(', ');

      const chat_input = page.locator(chat_input_selector).first();
      await chat_input.waitFor({ state: 'visible', timeout: 15_000 });

      // Step 6: Extract the verification query from task description
      // Try to get the query part after the notebook name
      let query = task.description ?? task.title;
      // Strip out notebook name/URL prefix if present
      const query_match = query.match(/[—\-:]\s*(.+)$/s);
      if (query_match) {
        query = query_match[1].trim();
      }

      await chat_input.click();
      await chat_input.fill(query);
      logger.info(`notebooklm_verify: typed verification query for task ${task.id}`);

      // Step 7: Submit the query — press Enter or click send
      // Try send button first, fall back to Enter key
      const send_button = page.locator(
        '[aria-label*="Send" i], [aria-label*="Ask" i], button[type="submit"]',
      ).first();
      const send_visible = await send_button.isVisible({ timeout: 3_000 }).catch(() => false);

      if (send_visible) {
        await send_button.click();
      } else {
        await chat_input.press('Enter');
      }
      logger.info(`notebooklm_verify: query submitted for task ${task.id}`);

      // Step 8: Wait for the response to appear
      // NotebookLM typically responds within 10-60 seconds
      const deadline = Date.now() + executor_config.notebooklm_timeout_ms;
      let response_text = '';

      while (Date.now() < deadline) {
        await page.waitForTimeout(5_000);

        // Look for response containers in the chat area
        const response_selectors = [
          // NotebookLM AI response bubbles
          '[class*="response"]',
          '[class*="answer"]',
          '[class*="message"][class*="model"]',
          '[class*="assistant"]',
          // Markdown content in response
          '.markdown-content',
        ];

        for (const selector of response_selectors) {
          const elements = page.locator(selector);
          const count = await elements.count();
          if (count > 0) {
            const last_text = await elements.last().textContent() ?? '';
            if (last_text.trim().length > response_text.trim().length) {
              response_text = last_text;
            }
          }
        }

        // Check if loading indicator has disappeared (response complete)
        const is_loading = await page.locator(
          '[class*="loading"], [class*="spinner"], [class*="typing"]',
        ).first().isVisible({ timeout: 1_000 }).catch(() => false);

        if (!is_loading && response_text.trim().length > 50) {
          logger.info(`notebooklm_verify: response received for task ${task.id}`);
          break;
        }
      }

      // Fallback: if no specific response element found, grab the page text
      if (response_text.trim().length < 50) {
        response_text = await page.textContent('body') ?? '';
      }

      // Step 9: Return success with extracted text (truncated)
      const trimmed = response_text.trim().slice(0, MAX_CONTENT_LENGTH);
      logger.info(`notebooklm_verify: extracted ${trimmed.length} chars for task ${task.id}`);

      return {
        status: 'success',
        output: trimmed,
        files: [],
      };
    } catch (err) {
      const error_msg = err instanceof Error ? err.message : String(err);
      logger.error(`notebooklm_verify failed for task ${task.id}: ${error_msg}`);
      return {
        status: 'failure',
        output: `notebooklm_verify error: ${error_msg}`,
        files: [],
      };
    } finally {
      // Close the page but keep the persistent context alive for session reuse
      if (page) {
        try { await page.close(); } catch { /* ignore cleanup errors */ }
      }
    }
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

## 파일: [OPS] src/notification/index.ts

// Notification module barrel export
export { create_telegram_client, type TelegramClient, type TelegramConfig } from './telegram.js';
export { create_slack_client, type SlackClient, type SlackConfig } from './slack.js';
export { create_notification_router, type NotificationRouter, type NotificationRouterDeps } from './router.js';
export { create_notion_client, type NotionClient, type NotionConfig } from './notion.js';

---

## 파일: [OPS] src/notification/notion.ts

// Notion notification module for FAS
// Handles: daily briefings, detailed reports, notification logging
// Notion is used for long-form content that doesn't fit Telegram/Slack

import { Client } from '@notionhq/client';
import { FASError } from '../shared/types.js';
import type { NotificationEvent, NotificationResult } from '../shared/types.js';

// === Configuration ===

export type NotionConfig = {
  api_key: string;
  database_id: string;         // Main notification log database
  reports_db_id?: string;      // Reports database (optional)
};

// === Local types (not in shared/types.ts to avoid cross-session conflict) ===

export type NotionPage = {
  page_id: string;
  url: string;
};

export type DailyBriefingSection = {
  title: string;
  content: string;
};

// === Constants ===

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// === Severity to emoji mapping ===

const SEVERITY_EMOJI: Record<string, string> = {
  low: '🟢',
  mid: '🟡',
  high: '🟠',
  critical: '🔴',
};

// === Notion Client Factory ===

export const create_notion_client = (config: NotionConfig) => {
  const client = new Client({ auth: config.api_key });

  // === Send notification event to Notion database ===
  const send_notification = async (event: NotificationEvent): Promise<NotionPage> => {
    const emoji = SEVERITY_EMOJI[event.severity ?? 'low'] ?? '⚪';

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await client.pages.create({
          parent: { database_id: config.database_id },
          properties: {
            Name: {
              title: [{ text: { content: `${emoji} [${event.type.toUpperCase()}] ${event.message.slice(0, 100)}` } }],
            },
            Type: {
              select: { name: event.type },
            },
            Device: {
              select: { name: event.device },
            },
            Severity: {
              select: { name: event.severity ?? 'low' },
            },
            Timestamp: {
              date: { start: new Date().toISOString() },
            },
          },
          children: [
            {
              object: 'block' as const,
              type: 'paragraph' as const,
              paragraph: {
                rich_text: [{ type: 'text' as const, text: { content: event.message } }],
              },
            },
            ...(event.metadata ? [{
              object: 'block' as const,
              type: 'code' as const,
              code: {
                rich_text: [{ type: 'text' as const, text: { content: JSON.stringify(event.metadata, null, 2) } }],
                language: 'json' as const,
              },
            }] : []),
          ],
        });

        return {
          page_id: response.id,
          url: (response as Record<string, unknown>).url as string ?? '',
        };
      } catch (error) {
        console.error(`[Notion] Attempt ${attempt}/${MAX_RETRIES} failed:`, error);
        if (attempt < MAX_RETRIES) {
          await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
        }
      }
    }

    throw new FASError(
      'NOTIFICATION_ERROR',
      `Notion notification failed after ${MAX_RETRIES} attempts`,
      502,
    );
  };

  // === Send with detailed result (compatible with NotificationResult) ===
  const send_with_result = async (event: NotificationEvent): Promise<NotificationResult> => {
    try {
      await send_notification(event);
      return { channel: 'notion', success: true, attempts: 1 };
    } catch {
      return {
        channel: 'notion',
        success: false,
        attempts: MAX_RETRIES,
        error: 'All retry attempts exhausted',
      };
    }
  };

  // === Create a full page (for reports) ===
  const create_page = async (params: {
    title: string;
    content: string;
    database_id?: string;
  }): Promise<NotionPage> => {
    const db_id = params.database_id ?? config.reports_db_id ?? config.database_id;

    // Split content into chunks of 2000 chars (Notion block limit)
    const chunks = split_content(params.content, 2000);

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await client.pages.create({
          parent: { database_id: db_id },
          properties: {
            Name: {
              title: [{ text: { content: params.title } }],
            },
            Timestamp: {
              date: { start: new Date().toISOString() },
            },
          },
          children: chunks.map((chunk) => ({
            object: 'block' as const,
            type: 'paragraph' as const,
            paragraph: {
              rich_text: [{ type: 'text' as const, text: { content: chunk } }],
            },
          })),
        });

        return {
          page_id: response.id,
          url: (response as Record<string, unknown>).url as string ?? '',
        };
      } catch (error) {
        console.error(`[Notion] create_page attempt ${attempt}/${MAX_RETRIES} failed:`, error);
        if (attempt < MAX_RETRIES) {
          await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
        }
      }
    }

    throw new FASError(
      'NOTIFICATION_ERROR',
      `Notion page creation failed after ${MAX_RETRIES} attempts`,
      502,
    );
  };

  // === Create daily briefing page ===
  const create_daily_briefing = async (params: {
    date: string;             // ISO date string (YYYY-MM-DD)
    sections: DailyBriefingSection[];
  }): Promise<NotionPage> => {
    const db_id = config.reports_db_id ?? config.database_id;

    const children = params.sections.flatMap((section) => [
      {
        object: 'block' as const,
        type: 'heading_2' as const,
        heading_2: {
          rich_text: [{ type: 'text' as const, text: { content: section.title } }],
        },
      },
      ...split_content(section.content, 2000).map((chunk) => ({
        object: 'block' as const,
        type: 'paragraph' as const,
        paragraph: {
          rich_text: [{ type: 'text' as const, text: { content: chunk } }],
        },
      })),
    ]);

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await client.pages.create({
          parent: { database_id: db_id },
          properties: {
            Name: {
              title: [{ text: { content: `🌅 Daily Briefing — ${params.date}` } }],
            },
            Type: {
              select: { name: 'briefing' },
            },
            Timestamp: {
              date: { start: params.date },
            },
          },
          children,
        });

        return {
          page_id: response.id,
          url: (response as Record<string, unknown>).url as string ?? '',
        };
      } catch (error) {
        console.error(`[Notion] create_daily_briefing attempt ${attempt}/${MAX_RETRIES} failed:`, error);
        if (attempt < MAX_RETRIES) {
          await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
        }
      }
    }

    throw new FASError(
      'NOTIFICATION_ERROR',
      `Notion daily briefing creation failed after ${MAX_RETRIES} attempts`,
      502,
    );
  };

  return {
    send_notification,
    send_with_result,
    create_page,
    create_daily_briefing,
    // Expose for testing
    _client: client,
  };
};

export type NotionClient = ReturnType<typeof create_notion_client>;

// === Helper: split long content into chunks ===

const split_content = (content: string, max_length: number): string[] => {
  if (content.length <= max_length) return [content];

  const chunks: string[] = [];
  let remaining = content;

  while (remaining.length > 0) {
    if (remaining.length <= max_length) {
      chunks.push(remaining);
      break;
    }

    // Try to split at newline boundary
    const cut_point = remaining.lastIndexOf('\n', max_length);
    const actual_cut = cut_point > 0 ? cut_point + 1 : max_length;

    chunks.push(remaining.slice(0, actual_cut));
    remaining = remaining.slice(actual_cut);
  }

  return chunks;
};

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

    // === Cross-channel fallback logic ===

    // Case 1: Both Telegram and Slack were supposed to send but both failed
    if (rules.telegram && !results.telegram && rules.slack && !results.slack) {
      console.warn(`[Router] Both Telegram and Slack failed for ${event.type} — critical notification lost`);
    }
    // Case 2: Telegram failed → fallback to Slack
    else if (rules.telegram && !results.telegram && deps.slack) {
      console.warn(`[Router] Telegram failed for ${event.type}, falling back to Slack`);
      results.slack = await deps.slack.send('#alerts', `[Telegram Fallback] ${event.message}`);
    }
    // Case 3: Slack failed → fallback to Telegram (includes slack-only events as emergency fallback)
    else if (rules.slack && !results.slack && deps.telegram) {
      if (rules.telegram) {
        // Dual-route event: normal Slack fallback via Telegram
        console.warn(`[Router] Slack failed for ${event.type}, falling back to Telegram`);
        const fallback = await deps.telegram.send(`[Slack Fallback] ${event.message}`, telegram_type);
        results.telegram = fallback.success;
      } else {
        // Slack-only event: emergency fallback to Telegram (not normally routed there)
        console.warn(`[Router] Slack failed for slack-only event ${event.type}, emergency fallback to Telegram`);
        const fallback = await deps.telegram.send(`[Emergency Fallback] ${event.message}`, 'alert');
        results.telegram = fallback.success;
      }
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
  | 'TIMEOUT'
  | 'CROSS_APPROVAL_REJECTED'
  | 'MODE_VIOLATION';

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

// === Cross Approval Types ===

export type CrossApprovalDecision = 'approved' | 'rejected';

export type CrossApprovalResult = {
  decision: CrossApprovalDecision;
  reason: string;
  reviewed_by: string;   // e.g. 'gemini_a', 'gemini_b'
  reviewed_at: string;   // ISO 8601
};

export type CrossApprovalConfig = {
  gemini_command?: string;        // CLI command to invoke Gemini (default: 'gemini')
  timeout_ms?: number;            // Timeout for approval request (default: 600_000 = 10 min)
  auto_reject_on_error?: boolean; // Auto-reject on parse/timeout error (default: true)
};

// === Agent Healthcheck Types ===

export type AgentName = 'claude' | 'gemini_a' | 'gemini_b' | 'openclaw' | 'gateway' | 'watchdog';

export type AgentStatus = 'running' | 'stopped' | 'crashed';

export type AgentHealthInfo = {
  name: AgentName;
  status: AgentStatus;
  last_heartbeat: string | null;
  uptime_seconds: number | null;
  crash_count: number;
};

// === Mode Management Types (Phase 3) ===

export type ModeState = {
  current_mode: FasMode;
  switched_at: string;
  switched_by: 'cron' | 'human' | 'api';
  next_scheduled_switch: string | null;
};

export type ModeTransitionRequest = {
  target_mode: FasMode;
  reason: string;
  requested_by: 'cron' | 'human' | 'api';
};

// === Activity Logging Types (Phase 7) ===

export type ActivityLogEntry = {
  id: string;
  timestamp: string;
  agent: string;
  action: string;
  risk_level: RiskLevel;
  approval_decision?: CrossApprovalDecision;
  approval_reviewer?: string;
  details: Record<string, unknown>;
};

export type ApprovalHistoryEntry = {
  id: string;
  timestamp: string;
  requester: string;
  action: string;
  risk_level: RiskLevel;
  decision: CrossApprovalDecision | 'timeout';
  reviewer: string;
  reason: string;
  duration_ms: number;
};

// === Resource Monitoring Types (Phase 7) ===

export type ResourceSnapshot = {
  timestamp: string;
  cpu_usage_percent: number;
  memory_used_mb: number;
  memory_total_mb: number;
  disk_used_gb: number;
  disk_total_gb: number;
};

export type ResourceThresholds = {
  cpu_percent: number;
  memory_percent: number;
  disk_percent: number;
};

// === Network Queue Types (Phase 7) ===

export type QueuedRequest = {
  id: string;
  queued_at: string;
  endpoint: string;
  method: string;
  body: unknown;
  retry_count: number;
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

## 파일: [OPS] src/watchdog/activity_logger.ts

// FAS Activity Logger
// Structured activity logging and approval history using SQLite.
// Tracks all agent actions with risk levels and approval decisions,
// enabling audit trails and compliance reporting.

import Database from 'better-sqlite3';
import { v4 as uuid_v4 } from 'uuid';
import type { RiskLevel, CrossApprovalDecision, ActivityLogEntry, ApprovalHistoryEntry } from '../shared/types.js';

// === Config type ===

export type ActivityLoggerConfig = {
  db_path: string;  // ':memory:' for testing
};

// === Factory function ===

export const create_activity_logger = (config: ActivityLoggerConfig) => {
  const db = new Database(config.db_path);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  // === Initialize schema ===
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      agent TEXT NOT NULL,
      action TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      approval_decision TEXT,
      approval_reviewer TEXT,
      details TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS approval_history (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      requester TEXT NOT NULL,
      action TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      decision TEXT NOT NULL,
      reviewer TEXT NOT NULL,
      reason TEXT NOT NULL,
      duration_ms INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_activity_agent ON activity_logs(agent);
    CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_approval_timestamp ON approval_history(timestamp);
  `);

  // === Prepared statements ===

  const stmts = {
    insert_activity: db.prepare(`
      INSERT INTO activity_logs (id, timestamp, agent, action, risk_level, approval_decision, approval_reviewer, details)
      VALUES (@id, @timestamp, @agent, @action, @risk_level, @approval_decision, @approval_reviewer, @details)
    `),
    insert_approval: db.prepare(`
      INSERT INTO approval_history (id, timestamp, requester, action, risk_level, decision, reviewer, reason, duration_ms)
      VALUES (@id, @timestamp, @requester, @action, @risk_level, @decision, @reviewer, @reason, @duration_ms)
    `),
    get_by_agent: db.prepare(`
      SELECT * FROM activity_logs WHERE agent = ? ORDER BY timestamp DESC LIMIT ?
    `),
    get_activities_by_date: db.prepare(`
      SELECT * FROM activity_logs WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC
    `),
    get_approvals_by_date: db.prepare(`
      SELECT * FROM approval_history WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC
    `),
  };

  // === Row converters ===

  const row_to_activity = (row: Record<string, unknown>): ActivityLogEntry => ({
    id: row.id as string,
    timestamp: row.timestamp as string,
    agent: row.agent as string,
    action: row.action as string,
    risk_level: row.risk_level as RiskLevel,
    approval_decision: (row.approval_decision as CrossApprovalDecision) ?? undefined,
    approval_reviewer: (row.approval_reviewer as string) ?? undefined,
    details: JSON.parse(row.details as string) as Record<string, unknown>,
  });

  const row_to_approval = (row: Record<string, unknown>): ApprovalHistoryEntry => ({
    id: row.id as string,
    timestamp: row.timestamp as string,
    requester: row.requester as string,
    action: row.action as string,
    risk_level: row.risk_level as RiskLevel,
    decision: row.decision as CrossApprovalDecision | 'timeout',
    reviewer: row.reviewer as string,
    reason: row.reason as string,
    duration_ms: row.duration_ms as number,
  });

  // === Public methods ===

  // Log an agent activity (action performed, risk level, optional approval info)
  const log_activity = (params: {
    agent: string;
    action: string;
    risk_level: RiskLevel;
    approval_decision?: CrossApprovalDecision;
    approval_reviewer?: string;
    details?: Record<string, unknown>;
  }): string => {
    const id = uuid_v4();
    const now = new Date().toISOString();

    stmts.insert_activity.run({
      id,
      timestamp: now,
      agent: params.agent,
      action: params.action,
      risk_level: params.risk_level,
      approval_decision: params.approval_decision ?? null,
      approval_reviewer: params.approval_reviewer ?? null,
      details: JSON.stringify(params.details ?? {}),
    });

    return id;
  };

  // Log an approval decision (approved/rejected/timeout with reviewer info)
  const log_approval = (params: {
    requester: string;
    action: string;
    risk_level: RiskLevel;
    decision: CrossApprovalDecision | 'timeout';
    reviewer: string;
    reason: string;
    duration_ms: number;
  }): string => {
    const id = uuid_v4();
    const now = new Date().toISOString();

    stmts.insert_approval.run({
      id,
      timestamp: now,
      requester: params.requester,
      action: params.action,
      risk_level: params.risk_level,
      decision: params.decision,
      reviewer: params.reviewer,
      reason: params.reason,
      duration_ms: params.duration_ms,
    });

    return id;
  };

  // Retrieve activity logs for a specific agent, ordered by most recent first
  const get_activities_by_agent = (agent: string, limit = 100): ActivityLogEntry[] => {
    const rows = stmts.get_by_agent.all(agent, limit) as Record<string, unknown>[];
    return rows.map(row_to_activity);
  };

  // Retrieve activity logs within a date range (ISO 8601 strings)
  const get_activities_by_date = (start: string, end: string): ActivityLogEntry[] => {
    const rows = stmts.get_activities_by_date.all(start, end) as Record<string, unknown>[];
    return rows.map(row_to_activity);
  };

  // Retrieve approval history within a date range (ISO 8601 strings)
  const get_approvals_by_date = (start: string, end: string): ApprovalHistoryEntry[] => {
    const rows = stmts.get_approvals_by_date.all(start, end) as Record<string, unknown>[];
    return rows.map(row_to_approval);
  };

  // Close the database connection
  const close = (): void => {
    db.close();
  };

  return {
    log_activity,
    log_approval,
    get_activities_by_agent,
    get_activities_by_date,
    get_approvals_by_date,
    close,
    _db: db, // exposed for testing
  };
};

export type ActivityLogger = ReturnType<typeof create_activity_logger>;

---

## 파일: [OPS] src/watchdog/local_queue.ts

// FAS Local Queue — Network disconnect resilience layer
// SQLite-backed queue that buffers outbound HTTP requests
// when the network is unavailable. On reconnect, flush()
// replays them in FIFO order via the provided on_flush callback.
//
// Usage:
//   const queue = create_local_queue({
//     db_path: './fas_queue.db',
//     on_flush: async (req) => { /* send HTTP request, return true on success */ },
//   });
//   queue.enqueue('/api/notify', 'POST', { message: 'hello' });
//   await queue.flush();

import Database from 'better-sqlite3';
import { v4 as uuid_v4 } from 'uuid';
import type { QueuedRequest } from '../shared/types.js';

// === Configuration ===

export type LocalQueueConfig = {
  db_path: string;
  max_retries?: number;
  on_flush: (request: QueuedRequest) => Promise<boolean>;
};

// === Public interface ===

export type LocalQueue = {
  /** Enqueue a request for later delivery. Returns generated id. */
  enqueue: (endpoint: string, method: string, body: unknown) => string;
  /** Flush all pending items. Calls on_flush for each, removes successes, increments retry_count for failures. */
  flush: () => Promise<{ sent: number; failed: number }>;
  /** Number of items currently waiting in the queue. */
  pending_count: () => number;
  /** Close the database connection. */
  close: () => void;
  /** Exposed for testing only. */
  _db: Database.Database;
};

// === SQL statements ===

const SQL_CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS queue (
    id          TEXT PRIMARY KEY,
    queued_at   TEXT NOT NULL,
    endpoint    TEXT NOT NULL,
    method      TEXT NOT NULL,
    body        TEXT NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0
  )
`;

const SQL_INSERT = `
  INSERT INTO queue (id, queued_at, endpoint, method, body, retry_count)
  VALUES (?, ?, ?, ?, ?, 0)
`;

const SQL_SELECT_ALL = `SELECT * FROM queue ORDER BY queued_at ASC`;

const SQL_DELETE_BY_ID = `DELETE FROM queue WHERE id = ?`;

const SQL_INCREMENT_RETRY = `UPDATE queue SET retry_count = retry_count + 1 WHERE id = ?`;

const SQL_COUNT = `SELECT COUNT(*) AS cnt FROM queue`;

// === Factory ===

export const create_local_queue = (config: LocalQueueConfig): LocalQueue => {
  const max_retries = config.max_retries ?? 5;

  // Open database with WAL mode for better concurrent read performance
  const db = new Database(config.db_path);
  db.pragma('journal_mode = WAL');
  db.exec(SQL_CREATE_TABLE);

  // Prepare statements for performance
  const stmt_insert = db.prepare(SQL_INSERT);
  const stmt_select_all = db.prepare(SQL_SELECT_ALL);
  const stmt_delete = db.prepare(SQL_DELETE_BY_ID);
  const stmt_increment = db.prepare(SQL_INCREMENT_RETRY);
  const stmt_count = db.prepare(SQL_COUNT);

  // --- enqueue ---
  const enqueue = (endpoint: string, method: string, body: unknown): string => {
    const id = uuid_v4();
    const queued_at = new Date().toISOString();
    const body_json = JSON.stringify(body);
    stmt_insert.run(id, queued_at, endpoint, method, body_json);
    return id;
  };

  // --- flush ---
  const flush = async (): Promise<{ sent: number; failed: number }> => {
    // Snapshot current queue items
    const rows = stmt_select_all.all() as Array<{
      id: string;
      queued_at: string;
      endpoint: string;
      method: string;
      body: string;
      retry_count: number;
    }>;

    let sent = 0;
    let failed = 0;

    for (const row of rows) {
      // Reconstruct the QueuedRequest for the callback
      const request: QueuedRequest = {
        id: row.id,
        queued_at: row.queued_at,
        endpoint: row.endpoint,
        method: row.method,
        body: JSON.parse(row.body),
        retry_count: row.retry_count,
      };

      try {
        const success = await config.on_flush(request);

        if (success) {
          // Remove successfully sent item from queue
          stmt_delete.run(row.id);
          sent += 1;
        } else {
          // Increment retry count; drop if exceeding max_retries
          stmt_increment.run(row.id);
          const new_retry_count = row.retry_count + 1;

          if (new_retry_count >= max_retries) {
            stmt_delete.run(row.id);
          }

          failed += 1;
        }
      } catch {
        // Treat thrown errors as failure
        stmt_increment.run(row.id);
        const new_retry_count = row.retry_count + 1;

        if (new_retry_count >= max_retries) {
          stmt_delete.run(row.id);
        }

        failed += 1;
      }
    }

    return { sent, failed };
  };

  // --- pending_count ---
  const pending_count = (): number => {
    const result = stmt_count.get() as { cnt: number };
    return result.cnt;
  };

  // --- close ---
  const close = (): void => {
    db.close();
  };

  return {
    enqueue,
    flush,
    pending_count,
    close,
    _db: db,
  };
};

---

## 파일: [OPS] src/watchdog/output_watcher.ts

// FAS Output Watcher
// Monitors tmux session output for predefined patterns
// and routes them to Telegram/Slack notifications.
//
// Patterns detected:
//   [APPROVAL_NEEDED] → Telegram urgent
//   [BLOCKED]         → Telegram urgent
//   [LOGIN_REQUIRED]  → Telegram urgent (hunter Google login expiry)
//   [GEMINI_BLOCKED]  → Telegram alert (Gemini CLI crashed after retries)
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
  // Hunter reports Google login session expired — needs manual re-auth
  {
    name: 'LOGIN_REQUIRED',
    regex: /\[LOGIN_REQUIRED\]\s*(.*)/,
    extract: (m) => m[1]?.trim() ?? '',
  },
  // Gemini CLI crashed after max retries — session needs attention
  {
    name: 'GEMINI_BLOCKED',
    regex: /\[GEMINI_BLOCKED\]\s*(.*)/,
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
  on_crash?: (session: string, consecutive_failures: number) => void | Promise<void>;
  crash_threshold?: number;     // consecutive failures before on_crash fires (default: 3)
};

export class OutputWatcher extends EventEmitter {
  private config: WatcherConfig;
  private running = false;
  private timers: ReturnType<typeof setInterval>[] = [];
  // Track last captured content per session to detect new lines
  private last_content: Map<string, string> = new Map();
  // Track consecutive capture failures per session for crash detection
  private crash_counts: Map<string, number> = new Map();

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

      // Reset crash counter on successful capture
      this.crash_counts.set(session, 0);
    } catch {
      // Track consecutive failures for crash detection
      const count = (this.crash_counts.get(session) ?? 0) + 1;
      this.crash_counts.set(session, count);
      const threshold = this.config.crash_threshold ?? 3;
      if (count >= threshold && this.config.on_crash) {
        this.emit('crash', session, count);
        await this.config.on_crash(session, count);
      }
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

## 파일: [OPS] src/watchdog/resource_monitor.ts

// FAS Resource Monitor (macOS)
// Monitors system resources (CPU, memory, disk) and fires alerts
// when thresholds are exceeded. Uses macOS-specific commands:
//   - top -l 1 -n 0  → CPU usage
//   - vm_stat + sysctl → memory usage
//   - df -g /         → disk usage

import { execSync } from 'node:child_process';
import type { ResourceSnapshot, ResourceThresholds } from '../shared/types.js';

// === Config type ===

export type ResourceMonitorConfig = {
  thresholds?: Partial<ResourceThresholds>;
  check_interval_ms?: number; // default: 60_000
  on_alert: (metric: string, value: number, threshold: number) => void | Promise<void>;
};

// === Default thresholds ===

const DEFAULT_THRESHOLDS: ResourceThresholds = {
  cpu_percent: 85,
  memory_percent: 90,
  disk_percent: 85,
};

// === macOS-specific parsers (exported for testing) ===

/**
 * Parse CPU usage from `top -l 1 -n 0` output.
 * Looks for line like: "CPU usage: 45.2% user, 12.3% sys, 42.5% idle"
 * Returns combined user + sys percentage.
 */
export const parse_cpu_usage = (): number => {
  try {
    const output = execSync('top -l 1 -n 0', { encoding: 'utf-8', timeout: 10_000 });
    const match = output.match(/CPU usage:\s*([\d.]+)%\s*user,\s*([\d.]+)%\s*sys/);
    if (!match) return 0;
    return parseFloat(match[1]) + parseFloat(match[2]);
  } catch {
    return 0;
  }
};

/**
 * Parse memory usage from `vm_stat` and `sysctl -n hw.memsize`.
 * vm_stat reports pages (page size = 16384 on Apple Silicon, 4096 on Intel).
 * sysctl -n hw.memsize returns total bytes.
 */
export const parse_memory_usage = (): { used_mb: number; total_mb: number } => {
  try {
    const total_bytes = parseInt(
      execSync('sysctl -n hw.memsize', { encoding: 'utf-8', timeout: 5_000 }).trim(),
      10,
    );
    const total_mb = total_bytes / (1024 * 1024);

    const vm_output = execSync('vm_stat', { encoding: 'utf-8', timeout: 5_000 });

    // Extract page size from first line: "Mach Virtual Memory Statistics: (page size of XXXX bytes)"
    const page_size_match = vm_output.match(/page size of (\d+) bytes/);
    const page_size = page_size_match ? parseInt(page_size_match[1], 10) : 16384;

    // Parse page counts — vm_stat uses "Pages free:", "Pages inactive:", etc.
    const parse_pages = (label: string): number => {
      const regex = new RegExp(`${label}:\\s*(\\d+)`);
      const m = vm_output.match(regex);
      return m ? parseInt(m[1], 10) : 0;
    };

    const free = parse_pages('Pages free');
    const inactive = parse_pages('Pages inactive');
    const speculative = parse_pages('Pages speculative');

    // Available = free + inactive + speculative (rough approximation)
    const available_mb = (free + inactive + speculative) * page_size / (1024 * 1024);
    const used_mb = total_mb - available_mb;

    return { used_mb: Math.round(used_mb), total_mb: Math.round(total_mb) };
  } catch {
    return { used_mb: 0, total_mb: 0 };
  }
};

/**
 * Parse disk usage from `df -g /`.
 * Output format:
 *   Filesystem  1G-blocks  Used Available Capacity
 *   /dev/disk3s1  460  230  200  54%
 */
export const parse_disk_usage = (): { used_gb: number; total_gb: number } => {
  try {
    const output = execSync('df -g /', { encoding: 'utf-8', timeout: 5_000 });
    const lines = output.trim().split('\n');
    // Data is on the second line
    if (lines.length < 2) return { used_gb: 0, total_gb: 0 };

    const parts = lines[1].trim().split(/\s+/);
    // parts: [filesystem, 1G-blocks, Used, Available, Capacity, ...]
    if (parts.length < 4) return { used_gb: 0, total_gb: 0 };

    const total_gb = parseInt(parts[1], 10);
    const used_gb = parseInt(parts[2], 10);

    return {
      used_gb: isNaN(used_gb) ? 0 : used_gb,
      total_gb: isNaN(total_gb) ? 0 : total_gb,
    };
  } catch {
    return { used_gb: 0, total_gb: 0 };
  }
};

// === Resource Monitor (returned interface) ===

export type ResourceMonitor = {
  take_snapshot: () => ResourceSnapshot;
  check: () => Promise<ResourceSnapshot>;
  start: () => void;
  stop: () => void;
};

// === Factory function ===

export const create_resource_monitor = (config: ResourceMonitorConfig): ResourceMonitor => {
  const thresholds: ResourceThresholds = {
    ...DEFAULT_THRESHOLDS,
    ...config.thresholds,
  };
  const interval_ms = config.check_interval_ms ?? 60_000;
  let timer: ReturnType<typeof setInterval> | null = null;

  // Capture current system resource state
  const take_snapshot = (): ResourceSnapshot => {
    const cpu_usage_percent = parse_cpu_usage();
    const { used_mb, total_mb } = parse_memory_usage();
    const { used_gb, total_gb } = parse_disk_usage();

    return {
      timestamp: new Date().toISOString(),
      cpu_usage_percent,
      memory_used_mb: used_mb,
      memory_total_mb: total_mb,
      disk_used_gb: used_gb,
      disk_total_gb: total_gb,
    };
  };

  // Take snapshot and fire alerts for any threshold violations
  const check = async (): Promise<ResourceSnapshot> => {
    const snapshot = take_snapshot();

    // Check CPU threshold
    if (snapshot.cpu_usage_percent > thresholds.cpu_percent) {
      await config.on_alert('cpu', snapshot.cpu_usage_percent, thresholds.cpu_percent);
    }

    // Check memory threshold (compute percentage from used/total)
    if (snapshot.memory_total_mb > 0) {
      const memory_percent = (snapshot.memory_used_mb / snapshot.memory_total_mb) * 100;
      if (memory_percent > thresholds.memory_percent) {
        await config.on_alert('memory', memory_percent, thresholds.memory_percent);
      }
    }

    // Check disk threshold (compute percentage from used/total)
    if (snapshot.disk_total_gb > 0) {
      const disk_percent = (snapshot.disk_used_gb / snapshot.disk_total_gb) * 100;
      if (disk_percent > thresholds.disk_percent) {
        await config.on_alert('disk', disk_percent, thresholds.disk_percent);
      }
    }

    return snapshot;
  };

  // Start periodic checking
  const start = (): void => {
    if (timer) return; // already running
    timer = setInterval(() => {
      check().catch(() => {
        // Swallow errors in periodic checks — alert callback might throw
      });
    }, interval_ms);
  };

  // Stop periodic checking
  const stop = (): void => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  return { take_snapshot, check, start, stop };
};

---
