// Retrospective engine for Hunter autonomous agent
// Delegates self-reflection to OpenClaw (ChatGPT Pro CLI) for:
//   - Daily reports: review today's work, save insights
//   - Weekly reports: analyze weekly performance, strategic pivots
//   - Failure analysis: root cause analysis when a project fails

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { Logger } from './logger.js';
import type { HunterConfig } from './config.js';
import type { Project } from '../shared/types.js';

// === Types ===

type ProjectDBLike = {
  get_all: () => Project[];
  get_by_status: (status: string) => Project[];
};

export type RetrospectiveResult = {
  type: 'daily' | 'weekly' | 'failure';
  report_path: string;
  openclaw_output: string;
  success: boolean;
};

export type RetrospectiveEngine = {
  run_daily: () => Promise<RetrospectiveResult>;
  run_weekly: () => Promise<RetrospectiveResult>;
  run_failure_analysis: (project: Project) => Promise<RetrospectiveResult>;
};

// === OpenClaw CLI execution ===
// Reuses the same spawn pattern as task_executor.ts
// Timeout: 300_000ms (5 min) for all retrospective prompts

type OpenClawResult = {
  success: boolean;
  output: string;
  error?: string;
};

const RETROSPECTIVE_TIMEOUT_MS = 300_000;

export const exec_openclaw = (
  command: string,
  agent: string,
  prompt: string,
  timeout_ms: number = RETROSPECTIVE_TIMEOUT_MS,
): Promise<OpenClawResult> => {
  return new Promise((resolve) => {
    const proc = spawn(command, ['agent', '--agent', agent, '-m', prompt, '--json'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeout_ms,
      env: { ...process.env, NO_COLOR: '1' },
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
        resolve({ success: true, output: stdout.trim() });
      } else {
        resolve({
          success: false,
          output: stdout.trim(),
          error: `OpenClaw exited with code ${code}: ${stderr.trim().slice(0, 500)}`,
        });
      }
    });

    proc.on('error', (err) => {
      resolve({
        success: false,
        output: '',
        error: err.message.includes('ENOENT')
          ? 'OpenClaw not installed. Run: npm install -g openclaw@latest && openclaw onboard'
          : err.message,
      });
    });
  });
};

// === Date helper ===
// Returns YYYY-MM-DD string for current date

const get_date_string = (): string => {
  return new Date().toISOString().slice(0, 10);
};

// === Prompt builders ===

const build_daily_prompt = (active_projects: Project[], failed_projects: Project[]): string => {
  const active_summary = active_projects.length > 0
    ? JSON.stringify(active_projects, null, 2)
    : 'No active projects.';

  const failed_summary = failed_projects.length > 0
    ? JSON.stringify(failed_projects, null, 2)
    : 'No recently failed projects.';

  return `Review today's project attempts for Hunter autonomous agent.

Current projects:
${active_summary}

Recently failed projects:
${failed_summary}

Answer these questions:
- What did you try today?
- Why did each attempt succeed or fail?
- What will you do differently tomorrow?
- What new things did you learn?
- What are the top 3 priorities for tomorrow?

Save insights to your memory for future reference.
Write a concise daily report.`;
};

const build_weekly_prompt = (all_projects: Project[]): string => {
  const projects_summary = all_projects.length > 0
    ? JSON.stringify(all_projects, null, 2)
    : 'No projects recorded.';

  return `Analyze this week's overall performance for Hunter autonomous agent.

All projects:
${projects_summary}

Answer these questions:
- How many projects were attempted? Success rate?
- Which categories show the most promise?
- Which categories should be abandoned?
- What are the top 3 focus areas for next week?
- Are there any strategic pivots needed?

Write a detailed weekly strategy report.`;
};

const build_failure_prompt = (project: Project): string => {
  return `A project has failed. Analyze the failure for Hunter autonomous agent.

Failed project:
- Title: ${project.title}
- Category: ${project.category}
- Expected revenue: ${project.expected_revenue}
- Resources needed: ${JSON.stringify(project.resources_needed)}
- Status at failure: ${project.status}
- Retrospective notes: ${project.retrospective ?? 'None'}

Answer:
- What was the root cause of failure?
- What methods were tried?
- What lessons should be carried forward?
- Should this project be retried with a different approach? If so, what approach?

Write a concise failure analysis report.`;
};

// === Project summary table ===
// Generates a markdown table for the report footer

const build_project_summary_table = (projects: Project[]): string => {
  if (projects.length === 0) {
    return '_No projects to summarize._';
  }

  const header = '| Title | Category | Status | Expected Revenue |';
  const separator = '|-------|----------|--------|-----------------|';
  const rows = projects.map(
    (p) => `| ${p.title} | ${p.category} | ${p.status} | ${p.expected_revenue} |`,
  );

  return [header, separator, ...rows].join('\n');
};

// === Report file writer ===
// Creates directory structure and writes markdown report

const save_report = (
  report_path: string,
  type: 'Daily' | 'Weekly' | 'Failure',
  date: string,
  openclaw_output: string,
  projects: Project[],
): void => {
  // Ensure parent directory exists
  const dir = report_path.slice(0, report_path.lastIndexOf('/'));
  mkdirSync(dir, { recursive: true });

  const table = build_project_summary_table(projects);
  const content = `# ${type} Report - ${date}\n\n${openclaw_output}\n\n## Project Summary\n${table}\n`;

  writeFileSync(report_path, content, 'utf-8');
};

// === Factory function ===

export const create_retrospective_engine = (deps: {
  config: HunterConfig;
  logger: Logger;
  project_db: ProjectDBLike;
}): RetrospectiveEngine => {
  const { config, logger, project_db } = deps;

  const run_daily = async (): Promise<RetrospectiveResult> => {
    const date = get_date_string();
    const report_path = join(config.reports_dir, 'daily', `daily_${date}.md`);

    logger.info(`[retrospective] Starting daily retrospective for ${date}`);

    // Gather project data
    const all_projects = project_db.get_all();
    const active_projects = all_projects.filter(
      (p) => p.status !== 'succeeded' && p.status !== 'failed',
    );
    const failed_projects = project_db.get_by_status('failed');

    const prompt = build_daily_prompt(active_projects, failed_projects);

    try {
      const result = await exec_openclaw(
        config.openclaw_command,
        config.openclaw_agent,
        prompt,
        RETROSPECTIVE_TIMEOUT_MS,
      );

      if (!result.success) {
        logger.error(`[retrospective] Daily OpenClaw failed: ${result.error}`);
        // Save a failure report so we have a record
        const error_output = `OpenClaw failed: ${result.error}\n\nPartial output:\n${result.output}`;
        save_report(report_path, 'Daily', date, error_output, all_projects);
        return { type: 'daily', report_path, openclaw_output: error_output, success: false };
      }

      save_report(report_path, 'Daily', date, result.output, all_projects);
      logger.info(`[retrospective] Daily report saved to ${report_path}`);

      return { type: 'daily', report_path, openclaw_output: result.output, success: true };
    } catch (err) {
      const error_msg = err instanceof Error ? err.message : String(err);
      logger.error(`[retrospective] Daily retrospective error: ${error_msg}`);
      return { type: 'daily', report_path, openclaw_output: `Error: ${error_msg}`, success: false };
    }
  };

  const run_weekly = async (): Promise<RetrospectiveResult> => {
    const date = get_date_string();
    const report_path = join(config.reports_dir, 'weekly', `weekly_${date}.md`);

    logger.info(`[retrospective] Starting weekly retrospective for ${date}`);

    const all_projects = project_db.get_all();
    const prompt = build_weekly_prompt(all_projects);

    try {
      const result = await exec_openclaw(
        config.openclaw_command,
        config.openclaw_agent,
        prompt,
        RETROSPECTIVE_TIMEOUT_MS,
      );

      if (!result.success) {
        logger.error(`[retrospective] Weekly OpenClaw failed: ${result.error}`);
        const error_output = `OpenClaw failed: ${result.error}\n\nPartial output:\n${result.output}`;
        save_report(report_path, 'Weekly', date, error_output, all_projects);
        return { type: 'weekly', report_path, openclaw_output: error_output, success: false };
      }

      save_report(report_path, 'Weekly', date, result.output, all_projects);
      logger.info(`[retrospective] Weekly report saved to ${report_path}`);

      return { type: 'weekly', report_path, openclaw_output: result.output, success: true };
    } catch (err) {
      const error_msg = err instanceof Error ? err.message : String(err);
      logger.error(`[retrospective] Weekly retrospective error: ${error_msg}`);
      return { type: 'weekly', report_path, openclaw_output: `Error: ${error_msg}`, success: false };
    }
  };

  const run_failure_analysis = async (project: Project): Promise<RetrospectiveResult> => {
    const date = get_date_string();
    const report_path = join(config.reports_dir, 'failures', `failure_${project.id}_${date}.md`);

    logger.info(`[retrospective] Starting failure analysis for project ${project.id}: ${project.title}`);

    const prompt = build_failure_prompt(project);

    try {
      const result = await exec_openclaw(
        config.openclaw_command,
        config.openclaw_agent,
        prompt,
        RETROSPECTIVE_TIMEOUT_MS,
      );

      if (!result.success) {
        logger.error(`[retrospective] Failure analysis OpenClaw failed: ${result.error}`);
        const error_output = `OpenClaw failed: ${result.error}\n\nPartial output:\n${result.output}`;
        save_report(report_path, 'Failure', date, error_output, [project]);
        return { type: 'failure', report_path, openclaw_output: error_output, success: false };
      }

      save_report(report_path, 'Failure', date, result.output, [project]);
      logger.info(`[retrospective] Failure analysis saved to ${report_path}`);

      return { type: 'failure', report_path, openclaw_output: result.output, success: true };
    } catch (err) {
      const error_msg = err instanceof Error ? err.message : String(err);
      logger.error(`[retrospective] Failure analysis error: ${error_msg}`);
      return { type: 'failure', report_path, openclaw_output: `Error: ${error_msg}`, success: false };
    }
  };

  return { run_daily, run_weekly, run_failure_analysis };
};
