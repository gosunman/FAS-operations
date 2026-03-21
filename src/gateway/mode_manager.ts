// SLEEP/AWAKE mode manager for FAS Gateway
// Controls which actions are allowed based on current operating mode

import type { FasMode, ModeState, ModeTransitionRequest, RiskLevel } from '../shared/types.js';

// === Configuration ===

export type ModeManagerConfig = {
  sleep_start_hour: number;     // default: 23
  sleep_end_hour: number;       // default: 7
  sleep_end_minute: number;     // default: 30
  initial_mode?: FasMode;
  // Optional: callback to check if HIGH/CRITICAL tasks are running.
  // If provided, SLEEP transition is deferred when active critical work exists.
  has_active_critical_tasks?: () => boolean;
};

// Actions blocked in SLEEP mode regardless of risk level
const SLEEP_BLOCKED_ACTIONS = new Set([
  'git_push', 'pr_creation', 'deploy', 'external_api_call',
  'account_action', 'financial_action', 'package_install',
]);

// === Factory ===

export const create_mode_manager = (config: ModeManagerConfig) => {
  let state: ModeState = {
    current_mode: config.initial_mode ?? 'awake',
    switched_at: new Date().toISOString(),
    switched_by: 'api',
    next_scheduled_switch: calculate_next_switch(config.initial_mode ?? 'awake', config),
  };

  const get_state = (): Readonly<ModeState> => ({ ...state });

  const transition = (request: ModeTransitionRequest): {
    success: boolean;
    previous_mode: FasMode;
    current_mode: FasMode;
    reason?: string;
    deferred?: boolean;
  } => {
    const previous = state.current_mode;
    if (previous === request.target_mode) {
      return { success: true, previous_mode: previous, current_mode: previous, reason: 'Already in target mode' };
    }

    // Defer SLEEP transition if HIGH/CRITICAL tasks are still running
    // This prevents mid-deployment shutdowns when n8n triggers SLEEP at 23:00
    if (
      request.target_mode === 'sleep' &&
      config.has_active_critical_tasks?.()
    ) {
      return {
        success: false,
        previous_mode: previous,
        current_mode: previous,
        reason: 'SLEEP deferred: HIGH/CRITICAL tasks still in progress',
        deferred: true,
      };
    }

    state = {
      current_mode: request.target_mode,
      switched_at: new Date().toISOString(),
      switched_by: request.requested_by,
      next_scheduled_switch: calculate_next_switch(request.target_mode, config),
    };
    return { success: true, previous_mode: previous, current_mode: state.current_mode };
  };

  // Check if an action is allowed in current mode
  const is_action_allowed = (action: string, risk_level: RiskLevel): boolean => {
    if (state.current_mode === 'awake') return true;

    // SLEEP mode restrictions:
    // HIGH/CRITICAL risk always blocked
    if (risk_level === 'high' || risk_level === 'critical') return false;

    // Specific actions blocked in SLEEP mode
    if (SLEEP_BLOCKED_ACTIONS.has(action)) return false;

    return true;
  };

  return { get_state, transition, is_action_allowed };
};

// Calculate next scheduled mode switch time
const calculate_next_switch = (current_mode: FasMode, config: ModeManagerConfig): string | null => {
  const now = new Date();
  const target = new Date(now);
  if (current_mode === 'sleep') {
    // Next switch: AWAKE at sleep_end_hour:sleep_end_minute
    target.setHours(config.sleep_end_hour, config.sleep_end_minute, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
  } else {
    // Next switch: SLEEP at sleep_start_hour:00
    target.setHours(config.sleep_start_hour, 0, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
  }
  return target.toISOString();
};

export type ModeManager = ReturnType<typeof create_mode_manager>;
