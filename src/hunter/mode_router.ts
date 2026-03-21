// Mode router — switches between Captain mode and Autonomous mode
// based on Captain API health. Monitors connectivity and triggers
// mode transitions with Telegram notifications.
//
// In captain mode, Hunter polls Captain's Task API for work.
// When Captain becomes unreachable (N consecutive failures),
// Hunter switches to autonomous mode and pursues self-directed
// revenue projects. When Captain recovers, Hunter switches back.

import type { HunterConfig } from './config.js';
import type { Logger } from './logger.js';
import type { HunterNotify } from './notify.js';
import type { HunterMode } from '../shared/types.js';

export type ModeRouterDeps = {
  config: HunterConfig;
  logger: Logger;
  notify?: HunterNotify;
};

export type ModeRouterState = {
  current_mode: HunterMode;
  consecutive_failures: number;
  last_check_at: string | null;
  last_transition_at: string | null;
};

// Health check timeout — abort if Captain doesn't respond within 5s
const HEALTH_CHECK_TIMEOUT_MS = 5_000;

export const create_mode_router = (deps: ModeRouterDeps) => {
  const { config, logger, notify } = deps;

  const state: ModeRouterState = {
    current_mode: 'captain',
    consecutive_failures: 0,
    last_check_at: null,
    last_transition_at: null,
  };

  let timer: ReturnType<typeof setInterval> | null = null;

  // Transition to a new mode with logging and notification
  const transition_to = async (new_mode: HunterMode, message: string): Promise<void> => {
    state.current_mode = new_mode;
    state.last_transition_at = new Date().toISOString();

    if (new_mode === 'autonomous') {
      logger.warn(message);
    } else {
      logger.info(message);
    }

    // Fire-and-forget Telegram alert — never block on notification failure
    try {
      await notify?.alert(message);
    } catch {
      // Notification failure must not affect mode routing
    }
  };

  // Single health check against Captain API
  // Returns true if Captain is reachable, false otherwise
  const check_captain_health = async (): Promise<boolean> => {
    const health_url = `${config.captain_api_url}/api/health`;
    state.last_check_at = new Date().toISOString();

    try {
      const controller = new AbortController();
      const timeout_id = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

      const response = await fetch(health_url, {
        signal: controller.signal,
      });

      clearTimeout(timeout_id);

      if (response.ok) {
        // Captain is healthy — reset failure counter
        const was_autonomous = state.current_mode === 'autonomous';
        state.consecutive_failures = 0;

        // If recovering from autonomous mode, switch back to captain
        if (was_autonomous) {
          await transition_to(
            'captain',
            '🔄 Captain reconnected. Switching back to CAPTAIN mode.',
          );
        }

        return true;
      }

      // Non-200 response — treat as failure
      state.consecutive_failures += 1;
      logger.warn(
        `Captain health check failed: HTTP ${response.status} (failures: ${state.consecutive_failures})`,
      );
    } catch (err) {
      // Network error, timeout, or other failure
      state.consecutive_failures += 1;
      const error_msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        `Captain health check error: ${error_msg} (failures: ${state.consecutive_failures})`,
      );
    }

    // Check if we should switch to autonomous mode
    if (
      state.consecutive_failures >= config.captain_failure_threshold &&
      state.current_mode === 'captain'
    ) {
      await transition_to(
        'autonomous',
        `🔄 Captain unreachable (${state.consecutive_failures} failures). Switching to AUTONOMOUS mode.`,
      );
    }

    return false;
  };

  // Start periodic health checking
  const start = (): void => {
    if (timer) return; // Already running

    logger.info(
      `Mode router started (check interval: ${config.captain_health_check_interval_ms}ms, ` +
      `failure threshold: ${config.captain_failure_threshold})`,
    );

    // Run first check immediately
    check_captain_health();

    // Schedule periodic checks
    timer = setInterval(() => {
      check_captain_health();
    }, config.captain_health_check_interval_ms);
  };

  // Stop periodic health checking
  const stop = (): void => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    logger.info(`Mode router stopped (mode: ${state.current_mode})`);
  };

  // Get a snapshot of the current state
  const get_state = (): Readonly<ModeRouterState> => ({ ...state });

  // Get current mode (convenience shorthand)
  const get_mode = (): HunterMode => state.current_mode;

  return { start, stop, get_state, check_captain_health, get_mode };
};
