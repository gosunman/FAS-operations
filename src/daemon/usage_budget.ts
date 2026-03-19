// Usage Budget Manager for FAS Daemon
//
// Prevents Claude Code usage exhaustion by implementing:
//   - Time-slot based daily budget allocation
//   - Hourly high-cost task limits
//   - Consecutive high-cost task cooldown
//   - Priority-based access control at different alert levels
//   - Deferred task priority queue
//
// Designed to integrate with usage_monitor.ts:
//   usage_monitor handles reactive failure detection (consecutive errors)
//   usage_budget handles proactive budget management (prevent exhaustion)
//
// Alert levels and their effects:
//   none      (<50%)  — all tasks allowed
//   info      (50%)   — Slack notification
//   warning   (70%)   — Telegram notification
//   critical  (85%)   — only high/emergency tasks allowed
//   emergency (95%)   — only emergency tasks allowed, Gemini fallback recommended

// === Types ===

export type TaskPriority = 'low' | 'normal' | 'high' | 'emergency';

export type TaskCost = {
  cost: number;
  priority: TaskPriority;
  label: string;
};

export type TaskHistoryEntry = TaskCost & {
  recorded_at: string; // ISO 8601
};

export type AlertLevel = 'none' | 'info' | 'warning' | 'critical' | 'emergency';

export type TimeSlot = {
  label: string;
  start_hour: number; // 0-23 inclusive
  end_hour: number;   // 1-24 exclusive
  budget_pct: number; // percentage of daily budget
};

export type AlertThresholds = {
  info: number;      // percentage (default 50)
  warning: number;   // percentage (default 70)
  critical: number;  // percentage (default 85)
  emergency: number; // percentage (default 95)
};

export type UsageBudgetConfig = {
  daily_budget?: number;                   // Total daily budget units (default: 100)
  hourly_max_high_cost_tasks?: number;     // Max high-cost tasks per hour (default: 3)
  cooldown_after_consecutive?: number;     // Consecutive high-cost tasks before cooldown (default: 3)
  cooldown_duration_ms?: number;           // Cooldown duration in ms (default: 300_000 = 5 min)
  time_slots?: TimeSlot[];                 // Time-based budget allocation
  alert_thresholds?: AlertThresholds;      // Percentage thresholds for alerts
};

export type BudgetStatus = {
  daily_budget: number;
  used_today: number;
  usage_pct: number;
  alert_level: AlertLevel;
  in_cooldown: boolean;
  cooldown_ends_at?: string; // ISO 8601
  current_slot: TimeSlot;
  slot_usage: number;
  slot_budget: number;
  deferred_count: number;
};

export type CanExecuteResult = {
  allowed: boolean;
  reason?: string;
};

type AlertChangeCallback = (old_level: AlertLevel, new_level: AlertLevel) => void;

// === Constants ===

const DEFAULT_DAILY_BUDGET = 100;
const DEFAULT_HOURLY_MAX_HIGH_COST = 3;
const DEFAULT_COOLDOWN_CONSECUTIVE = 3;
const DEFAULT_COOLDOWN_DURATION_MS = 5 * 60 * 1000; // 5 minutes

const DEFAULT_TIME_SLOTS: TimeSlot[] = [
  { label: 'night',     start_hour: 0,  end_hour: 6,  budget_pct: 15 },
  { label: 'morning',   start_hour: 6,  end_hour: 12, budget_pct: 30 },
  { label: 'afternoon', start_hour: 12, end_hour: 18, budget_pct: 35 },
  { label: 'evening',   start_hour: 18, end_hour: 24, budget_pct: 20 },
];

const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {
  info: 50,
  warning: 70,
  critical: 85,
  emergency: 95,
};

const PRIORITY_ORDER: Record<TaskPriority, number> = {
  emergency: 4,
  high: 3,
  normal: 2,
  low: 1,
};

// High-cost threshold: tasks with cost >= this are considered high-cost
const HIGH_COST_THRESHOLD = 10;

const LOG_PREFIX = '[UsageBudget]';

// === Factory ===

export const create_usage_budget = (config?: UsageBudgetConfig) => {
  const daily_budget = config?.daily_budget ?? DEFAULT_DAILY_BUDGET;
  const hourly_max_high_cost = config?.hourly_max_high_cost_tasks ?? DEFAULT_HOURLY_MAX_HIGH_COST;
  const cooldown_consecutive = config?.cooldown_after_consecutive ?? DEFAULT_COOLDOWN_CONSECUTIVE;
  const cooldown_duration_ms = config?.cooldown_duration_ms ?? DEFAULT_COOLDOWN_DURATION_MS;
  const time_slots = config?.time_slots ?? DEFAULT_TIME_SLOTS;
  const thresholds = config?.alert_thresholds ?? DEFAULT_ALERT_THRESHOLDS;

  // Internal state
  let task_history: TaskHistoryEntry[] = [];
  let current_day = _get_day_key(new Date());
  let consecutive_high_cost = 0;
  let cooldown_ends_at: number | null = null;
  let current_alert_level: AlertLevel = 'none';

  // Deferred task queue
  let deferred_queue: TaskCost[] = [];

  // Callbacks
  const alert_change_callbacks: AlertChangeCallback[] = [];

  // === Internal helpers ===

  /** Check if day has changed and reset if needed */
  const _check_day_reset = (): void => {
    const today = _get_day_key(new Date());
    if (today !== current_day) {
      console.log(`${LOG_PREFIX} Day changed (${current_day} → ${today}), resetting usage`);
      task_history = [];
      current_day = today;
      consecutive_high_cost = 0;
      cooldown_ends_at = null;
      current_alert_level = 'none';
    }
  };

  /** Get tasks recorded today */
  const _get_today_tasks = (): TaskHistoryEntry[] => {
    _check_day_reset();
    return task_history;
  };

  /** Calculate total usage for today */
  const _get_used_today = (): number => {
    return _get_today_tasks().reduce((sum, t) => sum + t.cost, 0);
  };

  /** Calculate usage percentage */
  const _get_usage_pct = (): number => {
    return (_get_used_today() / daily_budget) * 100;
  };

  /** Determine alert level from usage percentage */
  const _compute_alert_level = (): AlertLevel => {
    const pct = _get_usage_pct();
    if (pct >= thresholds.emergency) return 'emergency';
    if (pct >= thresholds.critical) return 'critical';
    if (pct >= thresholds.warning) return 'warning';
    if (pct >= thresholds.info) return 'info';
    return 'none';
  };

  /** Check and notify alert level changes */
  const _update_alert_level = (): void => {
    const new_level = _compute_alert_level();
    if (new_level !== current_alert_level) {
      const old_level = current_alert_level;
      current_alert_level = new_level;
      console.log(`${LOG_PREFIX} Alert level: ${old_level} → ${new_level} (${_get_usage_pct().toFixed(1)}%)`);
      for (const cb of alert_change_callbacks) {
        try {
          cb(old_level, new_level);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`${LOG_PREFIX} Alert callback error: ${msg}`);
        }
      }
    }
  };

  /** Check if currently in cooldown */
  const _is_in_cooldown = (): boolean => {
    if (cooldown_ends_at === null) return false;
    return Date.now() < cooldown_ends_at;
  };

  /** Get the current time slot */
  const _get_current_slot = (): TimeSlot => {
    const hour = new Date().getUTCHours();
    const slot = time_slots.find(s => hour >= s.start_hour && hour < s.end_hour);
    return slot ?? time_slots[0]; // fallback to first slot
  };

  /** Count high-cost tasks in current hour */
  const _get_hourly_high_cost = (): number => {
    const now = new Date();
    const hour_start = new Date(now);
    hour_start.setMinutes(0, 0, 0);
    const hour_start_iso = hour_start.toISOString();

    return _get_today_tasks().filter(
      t => t.cost >= HIGH_COST_THRESHOLD && t.recorded_at >= hour_start_iso,
    ).length;
  };

  /** Get usage within current time slot */
  const _get_slot_usage = (): number => {
    const slot = _get_current_slot();
    const now = new Date();
    const slot_start = new Date(now);
    slot_start.setUTCHours(slot.start_hour, 0, 0, 0);
    const slot_start_iso = slot_start.toISOString();

    const slot_end = new Date(now);
    slot_end.setUTCHours(slot.end_hour, 0, 0, 0);
    const slot_end_iso = slot_end.toISOString();

    return _get_today_tasks()
      .filter(t => t.recorded_at >= slot_start_iso && t.recorded_at < slot_end_iso)
      .reduce((sum, t) => sum + t.cost, 0);
  };

  // === Public API ===

  /** Record a completed task's cost */
  const record_task = (task: TaskCost): void => {
    _check_day_reset();

    const entry: TaskHistoryEntry = {
      ...task,
      recorded_at: new Date().toISOString(),
    };
    task_history.push(entry);

    // Track consecutive high-cost tasks
    if (task.cost >= HIGH_COST_THRESHOLD) {
      consecutive_high_cost += 1;
      if (consecutive_high_cost >= cooldown_consecutive) {
        cooldown_ends_at = Date.now() + cooldown_duration_ms;
        console.log(
          `${LOG_PREFIX} Cooldown activated after ${consecutive_high_cost} consecutive high-cost tasks ` +
          `(${cooldown_duration_ms / 1000}s)`,
        );
      }
    } else {
      // Low-cost task breaks the chain
      consecutive_high_cost = 0;
    }

    _update_alert_level();
  };

  /** Check if a task can be executed given current budget state */
  const can_execute = (task: TaskCost): CanExecuteResult => {
    _check_day_reset();

    // Emergency tasks always pass
    if (task.priority === 'emergency') {
      return { allowed: true };
    }

    // Check cooldown
    if (_is_in_cooldown()) {
      return {
        allowed: false,
        reason: `In cooldown — ${Math.ceil(((cooldown_ends_at ?? 0) - Date.now()) / 1000)}s remaining`,
      };
    }

    // Check hourly high-cost limit
    if (task.cost >= HIGH_COST_THRESHOLD && _get_hourly_high_cost() >= hourly_max_high_cost) {
      return {
        allowed: false,
        reason: `Hourly high-cost task limit reached (${hourly_max_high_cost})`,
      };
    }

    // Check alert-level based restrictions
    const level = _compute_alert_level();

    if (level === 'emergency') {
      return {
        allowed: false,
        reason: `Budget at emergency level (${_get_usage_pct().toFixed(1)}%) — only emergency tasks allowed`,
      };
    }

    if (level === 'critical' && PRIORITY_ORDER[task.priority] < PRIORITY_ORDER['high']) {
      return {
        allowed: false,
        reason: `Budget at critical level (${_get_usage_pct().toFixed(1)}%) — only high/emergency tasks allowed`,
      };
    }

    return { allowed: true };
  };

  /** Get detailed budget status */
  const get_status = (): BudgetStatus => {
    _check_day_reset();
    const slot = _get_current_slot();
    return {
      daily_budget,
      used_today: _get_used_today(),
      usage_pct: _get_usage_pct(),
      alert_level: _compute_alert_level(),
      in_cooldown: _is_in_cooldown(),
      cooldown_ends_at: cooldown_ends_at ? new Date(cooldown_ends_at).toISOString() : undefined,
      current_slot: slot,
      slot_usage: _get_slot_usage(),
      slot_budget: (slot.budget_pct / 100) * daily_budget,
      deferred_count: deferred_queue.length,
    };
  };

  /** Get current time slot */
  const get_current_time_slot = (): TimeSlot => _get_current_slot();

  /** Get budget allocated for current time slot */
  const get_current_slot_budget = (): number => {
    const slot = _get_current_slot();
    return (slot.budget_pct / 100) * daily_budget;
  };

  /** Get usage in current time slot */
  const get_current_slot_usage = (): number => _get_slot_usage();

  /** Check if current slot budget is exceeded */
  const is_slot_budget_exceeded = (): boolean => {
    return _get_slot_usage() > get_current_slot_budget();
  };

  /** Get count of high-cost tasks in current hour */
  const get_hourly_high_cost_count = (): number => _get_hourly_high_cost();

  /** Register alert level change callback */
  const on_alert_change = (callback: AlertChangeCallback): void => {
    alert_change_callbacks.push(callback);
  };

  /** Whether Gemini fallback should be activated (at emergency level) */
  const should_use_gemini_fallback = (): boolean => {
    return _compute_alert_level() === 'emergency';
  };

  /** Get task history for today */
  const get_task_history = (): TaskHistoryEntry[] => {
    _check_day_reset();
    return [...task_history];
  };

  /** Enqueue a task to be executed later (when budget allows) */
  const enqueue_deferred = (task: TaskCost): void => {
    deferred_queue.push(task);
    console.log(`${LOG_PREFIX} Deferred task enqueued: ${task.label} (priority: ${task.priority})`);
  };

  /** Dequeue highest-priority deferred task */
  const dequeue_deferred = (): TaskCost | undefined => {
    if (deferred_queue.length === 0) return undefined;

    // Sort by priority descending
    deferred_queue.sort((a, b) => PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority]);
    return deferred_queue.shift();
  };

  /** Get count of deferred tasks */
  const get_deferred_count = (): number => deferred_queue.length;

  return {
    record_task,
    can_execute,
    get_status,
    get_current_time_slot,
    get_current_slot_budget,
    get_current_slot_usage,
    is_slot_budget_exceeded,
    get_hourly_high_cost_count,
    on_alert_change,
    should_use_gemini_fallback,
    get_task_history,
    enqueue_deferred,
    dequeue_deferred,
    get_deferred_count,
  };
};

export type UsageBudget = ReturnType<typeof create_usage_budget>;

// === Utility ===

/** Get a YYYY-MM-DD key for the given date */
const _get_day_key = (date: Date): string => {
  return date.toISOString().slice(0, 10);
};
