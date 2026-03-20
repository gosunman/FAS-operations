// Resilient sender: wraps any async send function with local queue fallback
// On network error → enqueue locally → periodic retry → dequeue on success
// Phase 7-3: network disconnection recovery

import { create_local_queue } from './local_queue.js';
import type { LocalQueue, QueueItem, ReplayResult } from './local_queue.js';

// === Types ===

export type SendFunction<T = unknown> = (payload: T) => Promise<boolean>;

export type ResilientSenderConfig = {
  queue_dir: string;           // directory to persist queued items
  channel_name: string;        // e.g. 'telegram', 'slack' — used as queue item type
  retry_interval_ms?: number;  // how often to retry queued items (default: 60_000)
  max_retry_count?: number;    // max retries per item before giving up (default: 10)
  on_replay_complete?: (result: ReplayResult) => void;  // callback after replay cycle
};

export type ResilientSender<T = unknown> = {
  send: (payload: T) => Promise<boolean>;
  start_retry_loop: () => void;
  stop_retry_loop: () => void;
  replay_now: () => Promise<ReplayResult>;
  queue_size: () => number;
  is_retrying: () => boolean;
};

// === Network error detection ===

// Common error patterns indicating network issues (not application errors)
const is_network_error = (error: unknown): boolean => {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('econnrefused') ||
      msg.includes('econnreset') ||
      msg.includes('enotfound') ||
      msg.includes('etimedout') ||
      msg.includes('enetunreach') ||
      msg.includes('epipe') ||
      msg.includes('network') ||
      msg.includes('socket hang up') ||
      msg.includes('fetch failed') ||
      msg.includes('abort')
    );
  }
  return false;
};

// === Factory ===

export const create_resilient_sender = <T = unknown>(
  send_fn: SendFunction<T>,
  config: ResilientSenderConfig,
): ResilientSender<T> => {
  const queue: LocalQueue = create_local_queue(config.queue_dir);
  const retry_interval = config.retry_interval_ms ?? 60_000;
  const max_retries = config.max_retry_count ?? 10;
  let retry_timer: ReturnType<typeof setInterval> | null = null;

  // Send: try direct send, on network error → enqueue
  const send = async (payload: T): Promise<boolean> => {
    try {
      const success = await send_fn(payload);
      if (success) return true;

      // send_fn returned false — treat as application-level failure, enqueue for retry
      queue.enqueue(config.channel_name, payload);
      return false;
    } catch (error) {
      if (is_network_error(error)) {
        // Network error → enqueue for later retry
        queue.enqueue(config.channel_name, payload);
        console.warn(
          `[ResilientSender:${config.channel_name}] Network error, queued locally. Queue size: ${queue.size()}`,
        );
        return false;
      }
      // Non-network error → rethrow (application bug, should not be silently queued)
      throw error;
    }
  };

  // Replay: attempt to send all queued items
  const replay_now = async (): Promise<ReplayResult> => {
    const result = await queue.replay_all(async (item: QueueItem) => {
      // Skip items that exceeded max retry count
      if (item.retry_count >= max_retries) {
        console.warn(
          `[ResilientSender:${config.channel_name}] Item ${item.id} exceeded max retries (${max_retries}), discarding`,
        );
        return true; // return true to remove from queue
      }

      try {
        return await send_fn(item.payload as T);
      } catch (error) {
        if (is_network_error(error)) {
          // Still disconnected — stop replaying remaining items
          return false;
        }
        // Non-network error on replay — discard the item (it will never succeed)
        console.warn(
          `[ResilientSender:${config.channel_name}] Non-network error replaying item ${item.id}, discarding`,
        );
        return true;
      }
    });

    config.on_replay_complete?.(result);
    return result;
  };

  // Start periodic retry loop
  const start_retry_loop = (): void => {
    if (retry_timer) return; // already running
    retry_timer = setInterval(async () => {
      if (queue.size() === 0) return;
      console.log(
        `[ResilientSender:${config.channel_name}] Retry loop: ${queue.size()} items pending`,
      );
      await replay_now();
    }, retry_interval);
  };

  // Stop periodic retry loop
  const stop_retry_loop = (): void => {
    if (retry_timer) {
      clearInterval(retry_timer);
      retry_timer = null;
    }
  };

  return {
    send,
    start_retry_loop,
    stop_retry_loop,
    replay_now,
    queue_size: () => queue.size(),
    is_retrying: () => retry_timer !== null,
  };
};

// Re-export for convenience
export { is_network_error };
