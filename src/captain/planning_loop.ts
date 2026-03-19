// Captain's planning loop — morning/night autonomous scheduling
// Reads schedules.yml, creates due tasks in store, sends briefing notifications
// Also supports dynamic task discovery via Gemini analysis of crawl results

import { readFileSync } from 'node:fs';
import { parse as yaml_parse } from 'yaml';
import type { TaskStore } from '../gateway/task_store.js';
import type { NotificationRouter } from '../notification/router.js';
import type { GeminiConfig } from '../gemini/types.js';
import { spawn_gemini } from '../gemini/cli_wrapper.js';
import type { PersonaInjector } from './persona_injector.js';

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
  action?: string;       // Action type (e.g., 'web_crawl', 'research', 'chatgpt_task')
  description?: string;  // Task description from schedule config
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

const VALID_AGENTS = ['gemini_a', 'openclaw', 'claude'] as const;

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
  persona_injector?: PersonaInjector;  // Optional: enriches hunter task descriptions with user context
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

      // Build task description — inject persona context for hunter chatgpt_task routes
      // Hunter tasks without a URL will route to OpenClaw (chatgpt_task), so we enrich
      // the description with user background to give Hunter proper context.
      let description = entry.description;
      if (
        entry.agent === 'hunter' &&
        deps.persona_injector &&
        description &&
        !description.match(/https?:\/\//)
      ) {
        try {
          description = await deps.persona_injector.inject(description);
        } catch {
          // Fire-and-forget: persona injection failure should never block task creation
          console.warn(`[planning_loop] Persona injection failed for "${entry.title}", using original description`);
        }
      }

      // Create task
      deps.store.create({
        title: entry.title,
        description,
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
