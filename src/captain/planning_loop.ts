// Captain's planning loop — morning/night autonomous scheduling
// Reads schedules.yml, creates due tasks in store, sends briefing notifications

import { readFileSync } from 'node:fs';
import { parse as yaml_parse } from 'yaml';
import type { TaskStore } from '../gateway/task_store.js';
import type { NotificationRouter } from '../notification/router.js';

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

// === Dependencies ===

export type PlanningLoopDeps = {
  store: TaskStore;
  router: NotificationRouter;
  schedules_path: string;
  epoch?: Date;  // Reference date for every_3_days calculation (default: 2026-01-01)
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

  // Night planning: send daily summary
  const run_night = async (): Promise<{
    summary: { done: number; blocked: number; pending: number };
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

    return { summary };
  };

  return {
    run_morning,
    run_night,
    // Exposed for testing
    _is_due_today: is_due_today,
    _load_schedules: load_schedules,
  };
};

export type PlanningLoop = ReturnType<typeof create_planning_loop>;
