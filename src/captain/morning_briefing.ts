// Morning briefing generator for FAS Captain
// Collects overnight task results, today's schedule, and blocked tasks,
// then sends a concise summary to Telegram + Slack and a detailed backup to Notion.
// Designed as fire-and-forget — failures are logged but never crash the system.

import { readFileSync } from 'node:fs';
import { parse as yaml_parse } from 'yaml';
import type { TaskStore } from '../gateway/task_store.js';
import type { NotificationRouter } from '../notification/router.js';
import type { NotionClient } from '../notification/notion.js';
import type { Task, TaskStatus } from '../shared/types.js';

// === Configuration ===

export type MorningBriefingDeps = {
  store: TaskStore;
  router: NotificationRouter;
  notion: NotionClient | null;
  schedules_path: string;
};

// === Schedule types (mirrored from planning_loop for schedule reading) ===

type ScheduleEntry = {
  title: string;
  type: string;
  time: string;
  mode?: string;
  agent?: string;
  day?: string;
  workflow?: string;
  action?: string;
  description?: string;
};

type SchedulesFile = {
  schedules: Record<string, ScheduleEntry>;
};

// === Constants ===

// Overnight window: previous day 22:00 ~ current day 07:00 (9-hour window)
const OVERNIGHT_START_HOUR = 22;
const OVERNIGHT_END_HOUR = 7;

// Day names for weekly schedule matching
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

// === Briefing data types ===

export type OvernightSummary = {
  completed_tasks: Task[];
  total_count: number;
};

export type TodaySchedule = {
  title: string;
  time: string;
  agent: string;
  action: string;
};

export type BlockedTasksSummary = {
  blocked_tasks: Task[];
  pending_tasks: Task[];
  in_progress_tasks: Task[];
};

export type BriefingData = {
  date: string;
  overnight: OvernightSummary;
  today_schedules: TodaySchedule[];
  blocked: BlockedTasksSummary;
};

// === Helper: check if a timestamp falls within overnight window ===

const is_in_overnight_window = (timestamp: string, reference_date: Date): boolean => {
  const task_time = new Date(timestamp);

  // Calculate overnight window boundaries using UTC to avoid timezone issues
  // Start: previous day at OVERNIGHT_START_HOUR:00 UTC
  const window_start = new Date(Date.UTC(
    reference_date.getUTCFullYear(),
    reference_date.getUTCMonth(),
    reference_date.getUTCDate() - 1,
    OVERNIGHT_START_HOUR, 0, 0, 0,
  ));

  // End: reference day at OVERNIGHT_END_HOUR:00 UTC
  const window_end = new Date(Date.UTC(
    reference_date.getUTCFullYear(),
    reference_date.getUTCMonth(),
    reference_date.getUTCDate(),
    OVERNIGHT_END_HOUR, 0, 0, 0,
  ));

  return task_time >= window_start && task_time <= window_end;
};

// === Helper: check if schedule is due on a given date ===

const is_schedule_due_today = (entry: ScheduleEntry, today: Date): boolean => {
  const day_name = DAY_NAMES[today.getDay()];

  switch (entry.type) {
    case 'daily':
      return true;
    case 'weekly':
      return entry.day ? day_name === entry.day.toLowerCase() : false;
    case 'every_3_days': {
      // Use same epoch as planning_loop (2026-01-01)
      const epoch = new Date('2026-01-01T00:00:00Z');
      const diff_ms = today.getTime() - epoch.getTime();
      const diff_days = Math.floor(diff_ms / (24 * 60 * 60 * 1000));
      return diff_days % 3 === 0;
    }
    default:
      return false;
  }
};

// === Core: collect briefing data ===

export const collect_briefing_data = (
  store: TaskStore,
  schedules_path: string,
  now: Date = new Date(),
): BriefingData => {
  const date_str = now.toISOString().slice(0, 10);

  // 1. Overnight completed tasks (22:00 yesterday ~ 07:00 today)
  const done_tasks = store.get_by_status('done');
  const completed_overnight = done_tasks.filter(
    (t) => t.completed_at && is_in_overnight_window(t.completed_at, now),
  );

  // 2. Today's scheduled tasks from schedules.yml
  let today_schedules: TodaySchedule[] = [];
  try {
    const raw = readFileSync(schedules_path, 'utf-8');
    const parsed = yaml_parse(raw) as SchedulesFile;
    const schedules = parsed.schedules ?? {};

    today_schedules = Object.values(schedules)
      .filter((entry) => is_schedule_due_today(entry, now))
      .map((entry) => ({
        title: entry.title,
        time: entry.time,
        agent: entry.agent ?? entry.workflow ?? 'system',
        action: entry.action ?? entry.workflow ?? 'N/A',
      }));
  } catch (err) {
    // Schedule file read failure should not block briefing
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[MorningBriefing] Failed to read schedules: ${msg}`);
  }

  // 3. Blocked / pending / in_progress tasks
  const blocked_tasks = store.get_by_status('blocked');
  const pending_tasks = store.get_by_status('pending');
  const in_progress_tasks = store.get_by_status('in_progress');

  return {
    date: date_str,
    overnight: {
      completed_tasks: completed_overnight,
      total_count: completed_overnight.length,
    },
    today_schedules,
    blocked: {
      blocked_tasks,
      pending_tasks,
      in_progress_tasks,
    },
  };
};

// === Format: concise message for Telegram + Slack ===

export const format_short_briefing = (data: BriefingData): string => {
  const lines: string[] = [];

  lines.push(`[Morning Briefing] ${data.date}`);
  lines.push('');

  // Overnight summary
  lines.push(`## Overnight (${OVERNIGHT_START_HOUR}:00~${OVERNIGHT_END_HOUR}:00)`);
  if (data.overnight.total_count === 0) {
    lines.push('No tasks completed overnight.');
  } else {
    lines.push(`${data.overnight.total_count} task(s) completed:`);
    for (const task of data.overnight.completed_tasks) {
      const summary_snippet = task.output?.summary
        ? ` — ${task.output.summary.slice(0, 80)}`
        : '';
      lines.push(`  - ${task.title}${summary_snippet}`);
    }
  }
  lines.push('');

  // Today's schedule
  lines.push(`## Today's Schedule (${data.today_schedules.length} tasks)`);
  if (data.today_schedules.length === 0) {
    lines.push('No scheduled tasks for today.');
  } else {
    for (const sched of data.today_schedules) {
      lines.push(`  - [${sched.time}] ${sched.title} (${sched.agent})`);
    }
  }
  lines.push('');

  // Blocked / waiting status
  const { blocked_tasks, pending_tasks, in_progress_tasks } = data.blocked;
  lines.push('## Task Status');
  lines.push(`  Blocked: ${blocked_tasks.length} | Pending: ${pending_tasks.length} | In Progress: ${in_progress_tasks.length}`);

  if (blocked_tasks.length > 0) {
    lines.push('  Blocked tasks:');
    for (const t of blocked_tasks) {
      const reason = t.output?.summary ?? 'unknown reason';
      lines.push(`    - ${t.title}: ${reason.slice(0, 60)}`);
    }
  }

  return lines.join('\n');
};

// === Format: detailed content for Notion backup ===

export const format_detailed_briefing = (data: BriefingData): {
  title: string;
  sections: Array<{ title: string; content: string }>;
} => {
  const sections: Array<{ title: string; content: string }> = [];

  // Overnight completed tasks
  const overnight_lines: string[] = [];
  if (data.overnight.total_count === 0) {
    overnight_lines.push('No tasks completed during the overnight window (22:00~07:00).');
  } else {
    overnight_lines.push(`${data.overnight.total_count} task(s) completed:\n`);
    for (const task of data.overnight.completed_tasks) {
      overnight_lines.push(`Task: ${task.title}`);
      overnight_lines.push(`  Assigned to: ${task.assigned_to}`);
      overnight_lines.push(`  Completed at: ${task.completed_at ?? 'N/A'}`);
      if (task.output?.summary) {
        overnight_lines.push(`  Summary: ${task.output.summary}`);
      }
      if (task.output?.files_created && task.output.files_created.length > 0) {
        overnight_lines.push(`  Files: ${task.output.files_created.join(', ')}`);
      }
      overnight_lines.push('');
    }
  }
  sections.push({ title: 'Overnight Completed Tasks', content: overnight_lines.join('\n') });

  // Today's schedule
  const schedule_lines: string[] = [];
  if (data.today_schedules.length === 0) {
    schedule_lines.push('No scheduled tasks for today.');
  } else {
    for (const sched of data.today_schedules) {
      schedule_lines.push(`[${sched.time}] ${sched.title}`);
      schedule_lines.push(`  Agent: ${sched.agent} | Action: ${sched.action}`);
      schedule_lines.push('');
    }
  }
  sections.push({ title: "Today's Scheduled Tasks", content: schedule_lines.join('\n') });

  // Blocked / pending / in-progress
  const status_lines: string[] = [];
  const { blocked_tasks, pending_tasks, in_progress_tasks } = data.blocked;

  status_lines.push(`Blocked: ${blocked_tasks.length}`);
  status_lines.push(`Pending: ${pending_tasks.length}`);
  status_lines.push(`In Progress: ${in_progress_tasks.length}`);
  status_lines.push('');

  if (blocked_tasks.length > 0) {
    status_lines.push('--- Blocked Tasks ---');
    for (const t of blocked_tasks) {
      status_lines.push(`- ${t.title}: ${t.output?.summary ?? 'no reason provided'}`);
    }
    status_lines.push('');
  }

  if (in_progress_tasks.length > 0) {
    status_lines.push('--- In Progress ---');
    for (const t of in_progress_tasks) {
      status_lines.push(`- ${t.title} (assigned: ${t.assigned_to})`);
    }
    status_lines.push('');
  }

  sections.push({ title: 'Task Status Overview', content: status_lines.join('\n') });

  return {
    title: `Morning Briefing — ${data.date}`,
    sections,
  };
};

// === Main: generate and send morning briefing ===

export const create_morning_briefing = (deps: MorningBriefingDeps) => {
  // Generate briefing, send to all channels, return result
  const run = async (now: Date = new Date()): Promise<{
    success: boolean;
    data: BriefingData;
    channels: { telegram_slack: boolean; notion: boolean };
  }> => {
    // 1. Collect data
    const data = collect_briefing_data(deps.store, deps.schedules_path, now);

    // 2. Format short message for Telegram + Slack (via notification router)
    const short_msg = format_short_briefing(data);

    let telegram_slack_ok = false;
    let notion_ok = false;

    // 3. Send via router (Telegram + Slack according to routing matrix)
    try {
      const route_result = await deps.router.route({
        type: 'briefing',
        message: short_msg,
        device: 'captain',
      });
      telegram_slack_ok = route_result.telegram || route_result.slack;
    } catch (err) {
      // Fire-and-forget: log and continue to Notion
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[MorningBriefing] Router send failed: ${msg}`);
    }

    // 4. Send detailed briefing to Notion
    if (deps.notion) {
      try {
        const detailed = format_detailed_briefing(data);
        await deps.notion.create_daily_briefing({
          date: data.date,
          sections: detailed.sections,
        });
        notion_ok = true;
      } catch (err) {
        // Fire-and-forget: Notion failure should not crash the system
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[MorningBriefing] Notion backup failed: ${msg}`);
      }
    }

    const success = telegram_slack_ok || notion_ok;

    if (success) {
      console.log(`[MorningBriefing] Briefing sent for ${data.date} — overnight: ${data.overnight.total_count}, scheduled: ${data.today_schedules.length}, blocked: ${data.blocked.blocked_tasks.length}`);
    } else {
      console.warn(`[MorningBriefing] All channels failed for ${data.date}`);
    }

    return {
      success,
      data,
      channels: {
        telegram_slack: telegram_slack_ok,
        notion: notion_ok,
      },
    };
  };

  return { run };
};

export type MorningBriefing = ReturnType<typeof create_morning_briefing>;
