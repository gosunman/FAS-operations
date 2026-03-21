// Project executor for Hunter autonomous mode
// Takes the most promising project from DB and advances it to the next stage
// Each stage is delegated to OpenClaw (ChatGPT Pro CLI)

import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { Project, ProjectStatus } from '../shared/types.js';
import type { Logger } from './logger.js';
import type { HunterConfig } from './config.js';

// === OpenClaw CLI execution ===
// Reused pattern from task_executor.ts — invokes OpenClaw agent framework

export type OpenClawResult = {
  success: boolean;
  output: string;
  error?: string;
};

// Callable type for OpenClaw execution — allows dependency injection in tests
export type ExecOpenClawFn = (
  command: string,
  agent: string,
  prompt: string,
  timeout_ms: number,
) => Promise<OpenClawResult>;

// Default implementation using child_process.spawn
export const exec_openclaw: ExecOpenClawFn = (
  command,
  agent,
  prompt,
  timeout_ms,
) => {
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
          error: `Exit code ${code}: ${stderr.trim().slice(0, 500)}`,
        });
      }
    });

    proc.on('error', (err) => {
      resolve({
        success: false,
        output: '',
        error: err.message,
      });
    });
  });
};

// === Stage transition map ===
// Each status maps to its next stage, timeout, and prompt prefix

export type StageConfig = {
  next: ProjectStatus;
  timeout_ms: number;
  prompt_prefix: string;
};

export const STAGE_MAP: Record<string, StageConfig> = {
  discovered: {
    next: 'researching',
    timeout_ms: 1_800_000, // 30 min
    prompt_prefix:
      'Research this project idea thoroughly. Evaluate market size, competition, technical feasibility, and provide a detailed analysis.',
  },
  researching: {
    next: 'planned',
    timeout_ms: 900_000, // 15 min
    prompt_prefix:
      'Create a detailed execution plan for this project. Include: architecture, tech stack, MVP scope, timeline, and step-by-step build instructions.',
  },
  planned: {
    next: 'building',
    timeout_ms: 3_600_000, // 60 min
    prompt_prefix:
      'Build the MVP for this project. Write working code, create necessary files, and implement the core functionality.',
  },
  building: {
    next: 'testing',
    timeout_ms: 1_800_000, // 30 min
    prompt_prefix:
      'Test this project thoroughly. Verify all functionality works, check for bugs, and validate the user experience.',
  },
  testing: {
    next: 'deployed',
    timeout_ms: 1_800_000, // 30 min
    prompt_prefix:
      'Deploy this project. Set up hosting, configure production environment, and make it accessible.',
  },
};

// Hunter brain instruction — injected into every OpenClaw prompt
export const HUNTER_BRAIN_INSTRUCTION =
  '너는 Hunter라는 자율 에이전트의 두뇌다. 끊임없이 스스로 활동하고 학습해야 한다. ' +
  '실패해도 괜찮다. 실패에서 배워서 다음에 더 잘하면 된다. ' +
  '하지만 멈추면 안 된다. 항상 다음 기회를 찾고, 다음 프로젝트를 시도하라.';

// === DB interface for dependency injection ===

export type ProjectDBLike = {
  get_most_promising: () => Project | undefined;
  update_status: (id: string, status: ProjectStatus) => boolean;
  set_retrospective: (id: string, text: string) => boolean;
  add_openclaw_session: (id: string, session_id: string) => boolean;
};

// === Execution result ===

export type ExecutionResult = {
  project_id: string;
  previous_status: ProjectStatus;
  new_status: ProjectStatus;
  openclaw_output: string;
  success: boolean;
};

// === Public API ===

export type ProjectExecutor = {
  execute_next: () => Promise<ExecutionResult | null>;
};

// === Prompt builder (exported for testing) ===

export const build_prompt = (project: Project, stage: StageConfig): string => {
  const parts = [
    stage.prompt_prefix,
    '',
    `Project: ${project.title}`,
    `Category: ${project.category}`,
    `Expected Revenue: ${project.expected_revenue}`,
    `Resources Needed: ${project.resources_needed.join(', ') || 'none'}`,
    '',
    HUNTER_BRAIN_INSTRUCTION,
  ];
  return parts.join('\n');
};

// === Factory function with dependency injection ===

export const create_project_executor = (deps: {
  config: HunterConfig;
  logger: Logger;
  project_db: ProjectDBLike;
  exec_openclaw_fn?: ExecOpenClawFn; // Optional — defaults to real exec_openclaw
}): ProjectExecutor => {
  const { config, logger, project_db } = deps;
  const run_openclaw = deps.exec_openclaw_fn ?? exec_openclaw;

  const execute_next = async (): Promise<ExecutionResult | null> => {
    // Step 1: Get the most promising project from DB
    const project = project_db.get_most_promising();
    if (!project) {
      logger.info('project_executor: no projects available');
      return null;
    }

    // Step 2: Look up the stage map for current status
    const stage = STAGE_MAP[project.status];
    if (!stage) {
      // Current status is terminal or not actionable (deployed, monitoring, succeeded, failed, needs_owner)
      logger.info(`project_executor: project ${project.id} is in non-actionable status "${project.status}"`);
      return null;
    }

    const previous_status = project.status;
    logger.info(`project_executor: advancing project ${project.id} ("${project.title}") from ${previous_status} to ${stage.next}`);

    // Step 3: Build prompt and execute via OpenClaw
    const prompt = build_prompt(project, stage);
    const result = await run_openclaw(
      config.openclaw_command,
      config.openclaw_agent,
      prompt,
      stage.timeout_ms,
    );

    // Step 4: Handle result
    if (result.success) {
      // Success: advance to next stage
      project_db.update_status(project.id, stage.next);
      const session_id = randomUUID();
      project_db.add_openclaw_session(project.id, session_id);

      logger.info(`project_executor: project ${project.id} advanced to ${stage.next}`);

      return {
        project_id: project.id,
        previous_status,
        new_status: stage.next,
        openclaw_output: result.output,
        success: true,
      };
    } else {
      // Failure: mark as failed and write retrospective
      project_db.update_status(project.id, 'failed');

      const retrospective =
        `Failed during stage "${previous_status}" → "${stage.next}"\n` +
        `Error: ${result.error ?? 'Unknown error'}\n` +
        `Output: ${result.output.slice(0, 1000)}`;
      project_db.set_retrospective(project.id, retrospective);

      logger.error(`project_executor: project ${project.id} failed — ${result.error}`);

      return {
        project_id: project.id,
        previous_status,
        new_status: 'failed',
        openclaw_output: result.output,
        success: false,
      };
    }
  };

  return { execute_next };
};
