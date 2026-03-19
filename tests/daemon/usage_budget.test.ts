// TDD tests for Usage Budget system
// Tests: time-based budget allocation, cooldown, priority queue, alert levels
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  create_usage_budget,
  type UsageBudgetConfig,
  type TaskCost,
  type AlertLevel,
  type BudgetStatus,
  type TimeSlot,
} from '../../src/daemon/usage_budget.js';

// === Helpers ===

const fixed_now = new Date('2026-03-19T10:30:00Z');

const make_config = (overrides?: Partial<UsageBudgetConfig>): UsageBudgetConfig => ({
  daily_budget: 100,
  hourly_max_high_cost_tasks: 3,
  cooldown_after_consecutive: 3,
  cooldown_duration_ms: 5 * 60 * 1000, // 5 minutes
  time_slots: [
    { label: 'night',    start_hour: 0,  end_hour: 6,  budget_pct: 15 },
    { label: 'morning',  start_hour: 6,  end_hour: 12, budget_pct: 30 },
    { label: 'afternoon',start_hour: 12, end_hour: 18, budget_pct: 35 },
    { label: 'evening',  start_hour: 18, end_hour: 24, budget_pct: 20 },
  ],
  alert_thresholds: { info: 50, warning: 70, critical: 85, emergency: 95 },
  ...overrides,
});

describe('UsageBudget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(fixed_now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // === Creation & Defaults ===

  describe('creation', () => {
    it('should create with default config', () => {
      const budget = create_usage_budget();
      const status = budget.get_status();
      expect(status.daily_budget).toBe(100);
      expect(status.used_today).toBe(0);
      expect(status.alert_level).toBe('none');
      expect(status.in_cooldown).toBe(false);
    });

    it('should accept custom config', () => {
      const budget = create_usage_budget(make_config({ daily_budget: 200 }));
      const status = budget.get_status();
      expect(status.daily_budget).toBe(200);
    });
  });

  // === Task Recording ===

  describe('record_task', () => {
    it('should track task usage and increment used_today', () => {
      const budget = create_usage_budget(make_config());
      budget.record_task({ cost: 10, priority: 'normal', label: 'code_gen' });
      expect(budget.get_status().used_today).toBe(10);
    });

    it('should accumulate multiple tasks', () => {
      const budget = create_usage_budget(make_config());
      budget.record_task({ cost: 10, priority: 'normal', label: 'code_gen' });
      budget.record_task({ cost: 20, priority: 'normal', label: 'analysis' });
      budget.record_task({ cost: 5, priority: 'low', label: 'read' });
      expect(budget.get_status().used_today).toBe(35);
    });

    it('should track high-cost tasks per hour', () => {
      const budget = create_usage_budget(make_config({ hourly_max_high_cost_tasks: 3 }));
      budget.record_task({ cost: 15, priority: 'high', label: 'code_gen' });
      budget.record_task({ cost: 15, priority: 'high', label: 'code_gen' });
      expect(budget.get_hourly_high_cost_count()).toBe(2);
    });
  });

  // === Can Execute Check ===

  describe('can_execute', () => {
    it('should allow tasks when budget is available', () => {
      const budget = create_usage_budget(make_config());
      const result = budget.can_execute({ cost: 10, priority: 'normal', label: 'code_gen' });
      expect(result.allowed).toBe(true);
    });

    it('should block low priority tasks at critical alert level (85%)', () => {
      const budget = create_usage_budget(make_config({ daily_budget: 100 }));
      // Use 85 units
      budget.record_task({ cost: 85, priority: 'normal', label: 'bulk' });
      const result = budget.can_execute({ cost: 5, priority: 'low', label: 'read' });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('critical');
    });

    it('should allow high priority tasks at critical alert level', () => {
      const budget = create_usage_budget(make_config({ daily_budget: 100 }));
      budget.record_task({ cost: 85, priority: 'normal', label: 'bulk' });
      const result = budget.can_execute({ cost: 5, priority: 'high', label: 'urgent' });
      expect(result.allowed).toBe(true);
    });

    it('should block non-emergency tasks at emergency level (95%)', () => {
      const budget = create_usage_budget(make_config({ daily_budget: 100 }));
      budget.record_task({ cost: 96, priority: 'normal', label: 'bulk' });
      const result = budget.can_execute({ cost: 2, priority: 'high', label: 'important' });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('emergency');
    });

    it('should allow emergency tasks at emergency level', () => {
      const budget = create_usage_budget(make_config({ daily_budget: 100 }));
      budget.record_task({ cost: 96, priority: 'normal', label: 'bulk' });
      const result = budget.can_execute({ cost: 2, priority: 'emergency', label: 'critical_fix' });
      expect(result.allowed).toBe(true);
    });

    it('should block when hourly high-cost limit reached', () => {
      const budget = create_usage_budget(make_config({ hourly_max_high_cost_tasks: 2 }));
      budget.record_task({ cost: 10, priority: 'high', label: 'code_gen' });
      budget.record_task({ cost: 10, priority: 'high', label: 'code_gen' });
      const result = budget.can_execute({ cost: 10, priority: 'high', label: 'code_gen' });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Hourly');
    });

    it('should allow high-cost tasks after hour rolls over', () => {
      const budget = create_usage_budget(make_config({ hourly_max_high_cost_tasks: 2 }));
      budget.record_task({ cost: 10, priority: 'high', label: 'code_gen' });
      budget.record_task({ cost: 10, priority: 'high', label: 'code_gen' });

      // Advance 1 hour
      vi.setSystemTime(new Date('2026-03-19T11:30:00Z'));
      const result = budget.can_execute({ cost: 10, priority: 'high', label: 'code_gen' });
      expect(result.allowed).toBe(true);
    });
  });

  // === Cooldown System ===

  describe('cooldown', () => {
    it('should activate cooldown after consecutive high-cost tasks', () => {
      const budget = create_usage_budget(make_config({
        cooldown_after_consecutive: 3,
        cooldown_duration_ms: 5 * 60 * 1000,
      }));

      budget.record_task({ cost: 15, priority: 'high', label: 'gen1' });
      budget.record_task({ cost: 15, priority: 'high', label: 'gen2' });
      budget.record_task({ cost: 15, priority: 'high', label: 'gen3' });

      expect(budget.get_status().in_cooldown).toBe(true);
    });

    it('should block non-emergency tasks during cooldown', () => {
      const budget = create_usage_budget(make_config({
        cooldown_after_consecutive: 2,
        cooldown_duration_ms: 5 * 60 * 1000,
      }));

      budget.record_task({ cost: 15, priority: 'high', label: 'gen1' });
      budget.record_task({ cost: 15, priority: 'high', label: 'gen2' });

      const result = budget.can_execute({ cost: 10, priority: 'normal', label: 'gen3' });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('cooldown');
    });

    it('should allow emergency tasks during cooldown', () => {
      const budget = create_usage_budget(make_config({
        cooldown_after_consecutive: 2,
        cooldown_duration_ms: 5 * 60 * 1000,
      }));

      budget.record_task({ cost: 15, priority: 'high', label: 'gen1' });
      budget.record_task({ cost: 15, priority: 'high', label: 'gen2' });

      const result = budget.can_execute({ cost: 5, priority: 'emergency', label: 'critical' });
      expect(result.allowed).toBe(true);
    });

    it('should exit cooldown after duration elapses', () => {
      const budget = create_usage_budget(make_config({
        cooldown_after_consecutive: 2,
        cooldown_duration_ms: 5 * 60 * 1000,
      }));

      budget.record_task({ cost: 15, priority: 'high', label: 'gen1' });
      budget.record_task({ cost: 15, priority: 'high', label: 'gen2' });

      expect(budget.get_status().in_cooldown).toBe(true);

      // Advance 6 minutes
      vi.setSystemTime(new Date('2026-03-19T10:36:00Z'));

      expect(budget.get_status().in_cooldown).toBe(false);
    });

    it('should reset consecutive counter when a low-cost task is recorded', () => {
      const budget = create_usage_budget(make_config({ cooldown_after_consecutive: 3 }));

      budget.record_task({ cost: 15, priority: 'high', label: 'gen1' });
      budget.record_task({ cost: 15, priority: 'high', label: 'gen2' });
      budget.record_task({ cost: 2, priority: 'low', label: 'read' });
      budget.record_task({ cost: 15, priority: 'high', label: 'gen3' });

      expect(budget.get_status().in_cooldown).toBe(false);
    });
  });

  // === Alert Levels ===

  describe('alert levels', () => {
    it('should be "none" when usage is below 50%', () => {
      const budget = create_usage_budget(make_config({ daily_budget: 100 }));
      budget.record_task({ cost: 30, priority: 'normal', label: 'work' });
      expect(budget.get_status().alert_level).toBe('none');
    });

    it('should be "info" at 50% usage', () => {
      const budget = create_usage_budget(make_config({ daily_budget: 100 }));
      budget.record_task({ cost: 50, priority: 'normal', label: 'work' });
      expect(budget.get_status().alert_level).toBe('info');
    });

    it('should be "warning" at 70% usage', () => {
      const budget = create_usage_budget(make_config({ daily_budget: 100 }));
      budget.record_task({ cost: 70, priority: 'normal', label: 'work' });
      expect(budget.get_status().alert_level).toBe('warning');
    });

    it('should be "critical" at 85% usage', () => {
      const budget = create_usage_budget(make_config({ daily_budget: 100 }));
      budget.record_task({ cost: 85, priority: 'normal', label: 'work' });
      expect(budget.get_status().alert_level).toBe('critical');
    });

    it('should be "emergency" at 95% usage', () => {
      const budget = create_usage_budget(make_config({ daily_budget: 100 }));
      budget.record_task({ cost: 95, priority: 'normal', label: 'work' });
      expect(budget.get_status().alert_level).toBe('emergency');
    });
  });

  // === Alert Callbacks ===

  describe('alert callbacks', () => {
    it('should trigger callback when alert level changes', () => {
      const budget = create_usage_budget(make_config({ daily_budget: 100 }));
      const callback = vi.fn();
      budget.on_alert_change(callback);

      budget.record_task({ cost: 50, priority: 'normal', label: 'work' });
      expect(callback).toHaveBeenCalledWith('none', 'info');
    });

    it('should not trigger callback when level stays the same', () => {
      const budget = create_usage_budget(make_config({ daily_budget: 100 }));
      const callback = vi.fn();
      budget.on_alert_change(callback);

      budget.record_task({ cost: 30, priority: 'normal', label: 'work' });
      budget.record_task({ cost: 10, priority: 'normal', label: 'work' });
      // Both at < 50%, should not trigger
      expect(callback).not.toHaveBeenCalled();
    });

    it('should trigger callback on each level change', () => {
      const budget = create_usage_budget(make_config({ daily_budget: 100 }));
      const callback = vi.fn();
      budget.on_alert_change(callback);

      budget.record_task({ cost: 50, priority: 'normal', label: 'w1' }); // -> info
      budget.record_task({ cost: 21, priority: 'normal', label: 'w2' }); // -> warning (71%)
      budget.record_task({ cost: 15, priority: 'normal', label: 'w3' }); // -> critical (86%)

      expect(callback).toHaveBeenCalledTimes(3);
      expect(callback).toHaveBeenNthCalledWith(1, 'none', 'info');
      expect(callback).toHaveBeenNthCalledWith(2, 'info', 'warning');
      expect(callback).toHaveBeenNthCalledWith(3, 'warning', 'critical');
    });
  });

  // === Time Slot Budget ===

  describe('time slot budget', () => {
    it('should return current time slot', () => {
      // 10:30 UTC = morning slot (6-12)
      const budget = create_usage_budget(make_config());
      const slot = budget.get_current_time_slot();
      expect(slot.label).toBe('morning');
      expect(slot.budget_pct).toBe(30);
    });

    it('should calculate slot budget as percentage of daily budget', () => {
      const budget = create_usage_budget(make_config({ daily_budget: 100 }));
      const slot_budget = budget.get_current_slot_budget();
      // morning = 30% of 100 = 30
      expect(slot_budget).toBe(30);
    });

    it('should track usage within time slot', () => {
      const budget = create_usage_budget(make_config({ daily_budget: 100 }));
      budget.record_task({ cost: 10, priority: 'normal', label: 'work' });
      expect(budget.get_current_slot_usage()).toBe(10);
    });

    it('should warn when slot budget is exceeded', () => {
      const budget = create_usage_budget(make_config({ daily_budget: 100 }));
      // morning slot budget = 30
      budget.record_task({ cost: 25, priority: 'normal', label: 'work' });
      budget.record_task({ cost: 10, priority: 'normal', label: 'work' });
      // Total in slot = 35, exceeds 30
      expect(budget.is_slot_budget_exceeded()).toBe(true);
    });

    it('should show correct slot for night hours', () => {
      vi.setSystemTime(new Date('2026-03-19T03:00:00Z'));
      const budget = create_usage_budget(make_config());
      const slot = budget.get_current_time_slot();
      expect(slot.label).toBe('night');
      expect(slot.budget_pct).toBe(15);
    });
  });

  // === Priority Queue ===

  describe('priority queue', () => {
    it('should enqueue deferred tasks', () => {
      const budget = create_usage_budget(make_config());
      budget.enqueue_deferred({ cost: 10, priority: 'low', label: 'deferred_work' });
      expect(budget.get_deferred_count()).toBe(1);
    });

    it('should dequeue in priority order (emergency > high > normal > low)', () => {
      const budget = create_usage_budget(make_config());
      budget.enqueue_deferred({ cost: 5, priority: 'low', label: 'low_task' });
      budget.enqueue_deferred({ cost: 5, priority: 'high', label: 'high_task' });
      budget.enqueue_deferred({ cost: 5, priority: 'normal', label: 'normal_task' });

      const first = budget.dequeue_deferred();
      expect(first?.label).toBe('high_task');
      const second = budget.dequeue_deferred();
      expect(second?.label).toBe('normal_task');
      const third = budget.dequeue_deferred();
      expect(third?.label).toBe('low_task');
    });

    it('should return undefined when queue is empty', () => {
      const budget = create_usage_budget(make_config());
      expect(budget.dequeue_deferred()).toBeUndefined();
    });
  });

  // === Daily Reset ===

  describe('daily reset', () => {
    it('should reset daily usage when day changes', () => {
      const budget = create_usage_budget(make_config({ daily_budget: 100 }));
      budget.record_task({ cost: 80, priority: 'normal', label: 'work' });
      expect(budget.get_status().used_today).toBe(80);

      // Advance to next day
      vi.setSystemTime(new Date('2026-03-20T10:30:00Z'));
      expect(budget.get_status().used_today).toBe(0);
    });

    it('should reset alert level after daily reset', () => {
      const budget = create_usage_budget(make_config({ daily_budget: 100 }));
      budget.record_task({ cost: 90, priority: 'normal', label: 'work' });
      expect(budget.get_status().alert_level).toBe('critical');

      vi.setSystemTime(new Date('2026-03-20T10:30:00Z'));
      expect(budget.get_status().alert_level).toBe('none');
    });
  });

  // === Integration with UsageMonitor ===

  describe('gemini fallback recommendation', () => {
    it('should recommend gemini fallback at emergency level', () => {
      const budget = create_usage_budget(make_config({ daily_budget: 100 }));
      budget.record_task({ cost: 96, priority: 'normal', label: 'work' });
      expect(budget.should_use_gemini_fallback()).toBe(true);
    });

    it('should not recommend gemini fallback below emergency', () => {
      const budget = create_usage_budget(make_config({ daily_budget: 100 }));
      budget.record_task({ cost: 50, priority: 'normal', label: 'work' });
      expect(budget.should_use_gemini_fallback()).toBe(false);
    });
  });

  // === Usage History / Stats ===

  describe('usage history', () => {
    it('should return recorded task history', () => {
      const budget = create_usage_budget(make_config());
      budget.record_task({ cost: 10, priority: 'normal', label: 'task1' });
      budget.record_task({ cost: 20, priority: 'high', label: 'task2' });
      const history = budget.get_task_history();
      expect(history).toHaveLength(2);
      expect(history[0].label).toBe('task1');
      expect(history[1].label).toBe('task2');
    });

    it('should include timestamp in history entries', () => {
      const budget = create_usage_budget(make_config());
      budget.record_task({ cost: 10, priority: 'normal', label: 'task1' });
      const history = budget.get_task_history();
      expect(history[0].recorded_at).toBe(fixed_now.toISOString());
    });
  });
});
