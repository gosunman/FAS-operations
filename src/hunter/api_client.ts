// HTTP client for Captain's Task API
// Uses native fetch — no external dependencies needed
// Supports API key authentication (Defense in Depth)

import type { Task, HunterTaskResult, HunterHeartbeatResponse } from '../shared/types.js';
import type { Logger } from './logger.js';
import type { LocalQueue } from '../watchdog/local_queue.js';

export type ApiClientConfig = {
  base_url: string;
  api_key?: string;       // Optional API key for captain authentication
  timeout_ms?: number;
  local_queue?: LocalQueue;  // Optional queue for network disconnect resilience
};

export type ApiClient = {
  fetch_pending_tasks: () => Promise<Task[]>;
  submit_result: (task_id: string, result: HunterTaskResult) => Promise<boolean>;
  send_heartbeat: () => Promise<HunterHeartbeatResponse | null>;
};

const DEFAULT_TIMEOUT_MS = 5_000;
const API_KEY_HEADER = 'x-hunter-api-key';

export const create_api_client = (config: ApiClientConfig, logger: Logger): ApiClient => {
  const { base_url, api_key, timeout_ms = DEFAULT_TIMEOUT_MS, local_queue } = config;

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
      // Queue failed submission for later retry
      if (local_queue) {
        local_queue.enqueue(`/api/hunter/tasks/${task_id}/result`, 'POST', result);
        logger.info(`submit_result(${task_id}): queued for retry`);
      }
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
      // Queue failed heartbeat for later retry
      if (local_queue) {
        local_queue.enqueue('/api/hunter/heartbeat', 'POST', { agent: 'openclaw', timestamp: new Date().toISOString() });
      }
      return null;
    }
  };

  return { fetch_pending_tasks, submit_result, send_heartbeat };
};
