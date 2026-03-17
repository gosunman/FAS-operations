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
