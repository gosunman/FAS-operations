// HTTP client for Captain's Task API
// Uses native fetch — no external dependencies needed

import type { Task, HunterTaskResult, HunterHeartbeatResponse } from '../shared/types.js';
import type { Logger } from './logger.js';

export type ApiClientConfig = {
  base_url: string;
  timeout_ms?: number;
};

export type ApiClient = {
  fetch_pending_tasks: () => Promise<Task[]>;
  submit_result: (task_id: string, result: HunterTaskResult) => Promise<boolean>;
  send_heartbeat: () => Promise<HunterHeartbeatResponse | null>;
};

const DEFAULT_TIMEOUT_MS = 5_000;

export const create_api_client = (config: ApiClientConfig, logger: Logger): ApiClient => {
  const { base_url, timeout_ms = DEFAULT_TIMEOUT_MS } = config;

  const make_url = (path: string): string => `${base_url}${path}`;

  // Fetch pending tasks assigned to hunter (PII-sanitized by captain)
  const fetch_pending_tasks = async (): Promise<Task[]> => {
    try {
      const res = await fetch(make_url('/api/hunter/tasks/pending'), {
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result),
        signal: AbortSignal.timeout(timeout_ms),
      });

      if (!res.ok) {
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
        headers: { 'Content-Type': 'application/json' },
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
