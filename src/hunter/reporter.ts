// Hunter reporter module — handles autonomous mode notifications and file reports
// Telegram: project discovery, owner help needed, success, valuable info
// File: daily summary in markdown format
// Daily summary sent at 22:00 KST via Telegram

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from './logger.js';
import type { HunterNotify } from './notify.js';
import type { HunterConfig } from './config.js';
import type { Project } from '../shared/types.js';

// Minimal interface for querying projects — avoids tight coupling to full DB
type ProjectDBLike = {
  get_all: () => Project[];
  get_by_status: (status: string) => Project[];
  get_stats: () => { total: number; by_status: Record<string, number>; total_revenue: number };
};

export type HunterReporter = {
  // Telegram notifications
  report_project_discovered: (project: Project) => Promise<void>;
  report_owner_help_needed: (project: Project) => Promise<void>;
  report_project_success: (project: Project) => Promise<void>;
  report_valuable_info: (info: string) => Promise<void>;

  // File reports
  generate_daily_summary: () => string;   // Returns the report content
  save_daily_summary: () => string;       // Saves to file, returns path

  // Scheduled: send daily summary via Telegram at 22:00 KST
  send_daily_telegram_summary: () => Promise<void>;
};

// Format today's date as YYYY-MM-DD
const get_today_date = (): string => {
  const now = new Date();
  return now.toISOString().slice(0, 10);
};

// Build the Telegram-formatted daily summary string
const build_telegram_summary = (
  date: string,
  stats: { total: number; by_status: Record<string, number>; total_revenue: number },
  active_projects: Project[],
): string => {
  const status_lines = Object.entries(stats.by_status)
    .map(([status, count]) => `  ${status}: ${count}`)
    .join('\n');

  const active_lines = active_projects.length > 0
    ? active_projects
        .map((p) => `  - ${p.title} [${p.status}]`)
        .join('\n')
    : '  (none)';

  return [
    `[DAILY SUMMARY] ${date}`,
    '',
    `📊 Projects: ${stats.total} total`,
    status_lines,
    '',
    `💰 Total Revenue: ₩${stats.total_revenue.toLocaleString()}`,
    '',
    `🔄 Active:`,
    active_lines,
  ].join('\n');
};

// Build the markdown file content for daily summary
const build_markdown_summary = (
  date: string,
  stats: { total: number; by_status: Record<string, number>; total_revenue: number },
  all_projects: Project[],
): string => {
  const status_table = Object.entries(stats.by_status)
    .map(([status, count]) => `| ${status} | ${count} |`)
    .join('\n');

  const active_statuses = new Set([
    'discovered', 'researching', 'planned', 'building', 'testing', 'deployed', 'monitoring',
  ]);

  const active_projects = all_projects.filter((p) => active_statuses.has(p.status));
  const project_details = active_projects.length > 0
    ? active_projects
        .map((p) => `- **${p.title}** (${p.category}) — ${p.status}, expected: ${p.expected_revenue}`)
        .join('\n')
    : '(none)';

  return [
    `# Hunter Daily Summary - ${date}`,
    '',
    '## Project Pipeline',
    '| Status | Count |',
    '|--------|-------|',
    status_table,
    '',
    '## Active Projects',
    project_details,
    '',
    '## Revenue',
    `Total: ₩${stats.total_revenue.toLocaleString()}`,
    '',
    '## Generated at',
    new Date().toISOString(),
    '',
  ].join('\n');
};

export const create_hunter_reporter = (deps: {
  config: HunterConfig;
  logger: Logger;
  notify?: HunterNotify;
  project_db: ProjectDBLike;
}): HunterReporter => {
  const { config, logger, notify, project_db } = deps;

  // Helper: send Telegram message safely (no crash if notify is missing)
  const safe_telegram = async (message: string): Promise<void> => {
    if (!notify) {
      logger.warn('Reporter: notify not configured, skipping Telegram message');
      return;
    }
    try {
      await notify.send_telegram(message);
    } catch (err) {
      logger.error(`Reporter: Telegram send failed — ${err}`);
    }
  };

  // Notify owner about a newly discovered project
  const report_project_discovered = async (project: Project): Promise<void> => {
    const message = [
      `[DISCOVERY] ${project.title}`,
      `Category: ${project.category}`,
      `Expected: ${project.expected_revenue}`,
      `Resources: ${project.resources_needed.join(', ')}`,
      `Status: Queued for research`,
    ].join('\n');

    logger.info(`Reporter: project discovered — ${project.title}`);
    await safe_telegram(message);
  };

  // Notify owner that a project requires manual intervention
  const report_owner_help_needed = async (project: Project): Promise<void> => {
    const message = [
      `[APPROVAL_NEEDED] ${project.title}`,
      `Action needed: ${project.owner_action_needed ?? 'Unknown'}`,
      `Category: ${project.category}`,
      `Expected: ${project.expected_revenue}`,
    ].join('\n');

    logger.info(`Reporter: owner help needed — ${project.title}`);
    await safe_telegram(message);
  };

  // Notify owner about a project that achieved revenue
  const report_project_success = async (project: Project): Promise<void> => {
    const message = [
      `[SUCCESS] 🎉 ${project.title}`,
      `Revenue: ₩${project.actual_revenue.toLocaleString()}`,
      `Category: ${project.category}`,
    ].join('\n');

    logger.info(`Reporter: project success — ${project.title}`);
    await safe_telegram(message);
  };

  // Send arbitrary valuable information to owner
  const report_valuable_info = async (info: string): Promise<void> => {
    const message = `[INFO] ${info}`;

    logger.info(`Reporter: valuable info — ${info}`);
    await safe_telegram(message);
  };

  // Generate daily summary as a markdown string (does not write to file)
  const generate_daily_summary = (): string => {
    const date = get_today_date();
    const stats = project_db.get_stats();
    const all_projects = project_db.get_all();

    return build_markdown_summary(date, stats, all_projects);
  };

  // Save daily summary to file, returns the file path
  const save_daily_summary = (): string => {
    const date = get_today_date();
    const dir = join(config.reports_dir, 'daily');
    mkdirSync(dir, { recursive: true });

    const file_path = join(dir, `summary_${date}.md`);
    const content = generate_daily_summary();

    writeFileSync(file_path, content, 'utf-8');
    logger.info(`Reporter: daily summary saved to ${file_path}`);

    return file_path;
  };

  // Send daily summary via Telegram (scheduled at 22:00 KST)
  const send_daily_telegram_summary = async (): Promise<void> => {
    const date = get_today_date();
    const stats = project_db.get_stats();

    // Get active projects (non-terminal statuses)
    const active_statuses = [
      'discovered', 'researching', 'planned', 'building', 'testing', 'deployed', 'monitoring',
    ];
    const active_projects = active_statuses.flatMap((s) => project_db.get_by_status(s));

    const message = build_telegram_summary(date, stats, active_projects);

    logger.info('Reporter: sending daily Telegram summary');
    await safe_telegram(message);
  };

  return {
    report_project_discovered,
    report_owner_help_needed,
    report_project_success,
    report_valuable_info,
    generate_daily_summary,
    save_daily_summary,
    send_daily_telegram_summary,
  };
};
