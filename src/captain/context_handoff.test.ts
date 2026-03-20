// Tests for context_handoff module
// Mode transition context save/restore for SLEEP <-> AWAKE handoffs

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { create_task_store, type TaskStore } from '../gateway/task_store.js';
import { create_mode_manager, type ModeManager } from '../gateway/mode_manager.js';
import {
  create_handoff_store,
  build_snapshot,
  format_briefing,
  type HandoffSnapshot,
} from './context_handoff.js';

// === Test helpers ===

const make_temp_dir = (): string => mkdtempSync(join(tmpdir(), 'handoff-test-'));

const make_task_store = (): TaskStore => create_task_store({ db_path: ':memory:' });

const make_mode_manager = (mode: 'sleep' | 'awake' = 'awake'): ModeManager =>
  create_mode_manager({
    sleep_start_hour: 23,
    sleep_end_hour: 7,
    sleep_end_minute: 30,
    initial_mode: mode,
  });

const make_sample_snapshot = (overrides: Partial<HandoffSnapshot> = {}): HandoffSnapshot => ({
  snapshot_id: 'test-snap-001',
  created_at: '2026-03-21T07:30:00.000Z',
  previous_mode: 'sleep',
  target_mode: 'awake',
  active_tasks: [
    { id: 'task-1', title: 'Deploy API', status: 'in_progress', progress_note: '80% done' },
  ],
  pending_approvals: [
    { id: 'approval-1', description: 'PR #42 merge', requested_at: '2026-03-21T06:00:00.000Z' },
  ],
  period_summary: {
    tasks_completed: 3,
    tasks_created: 1,
    tasks_blocked: 0,
    notable_events: ['Overnight crawl finished successfully'],
  },
  recommended_actions: ['Review PR #42', 'Check crawl results'],
  ...overrides,
});

// === HandoffStore tests ===

describe('create_handoff_store', () => {
  let temp_dir: string;

  beforeEach(() => {
    temp_dir = make_temp_dir();
  });

  afterEach(() => {
    rmSync(temp_dir, { recursive: true, force: true });
  });

  it('should create handoffs directory if it does not exist', () => {
    const store = create_handoff_store(temp_dir);
    const snapshot = make_sample_snapshot();
    store.save(snapshot);

    const handoffs_dir = join(temp_dir, 'handoffs');
    expect(existsSync(handoffs_dir)).toBe(true);
  });

  it('should save a snapshot as JSON file with correct naming', () => {
    const store = create_handoff_store(temp_dir);
    const snapshot = make_sample_snapshot({
      created_at: '2026-03-21T07:30:00.000Z',
      previous_mode: 'sleep',
      target_mode: 'awake',
    });
    store.save(snapshot);

    const handoffs_dir = join(temp_dir, 'handoffs');
    const files = readdirSync(handoffs_dir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^\d{8}T\d{6}_sleep_to_awake\.json$/);
  });

  it('should load the latest snapshot', () => {
    const store = create_handoff_store(temp_dir);

    const snap1 = make_sample_snapshot({
      snapshot_id: 'snap-1',
      created_at: '2026-03-21T07:30:00.000Z',
    });
    const snap2 = make_sample_snapshot({
      snapshot_id: 'snap-2',
      created_at: '2026-03-21T23:00:00.000Z',
      previous_mode: 'awake',
      target_mode: 'sleep',
    });

    store.save(snap1);
    store.save(snap2);

    const latest = store.load_latest();
    expect(latest).not.toBeNull();
    expect(latest!.snapshot_id).toBe('snap-2');
  });

  it('should return null when no snapshots exist', () => {
    const store = create_handoff_store(temp_dir);
    expect(store.load_latest()).toBeNull();
  });

  it('should load a snapshot by id', () => {
    const store = create_handoff_store(temp_dir);
    const snapshot = make_sample_snapshot({ snapshot_id: 'unique-id-123' });
    store.save(snapshot);

    const loaded = store.load_by_id('unique-id-123');
    expect(loaded).not.toBeNull();
    expect(loaded!.snapshot_id).toBe('unique-id-123');
  });

  it('should return null for non-existent snapshot id', () => {
    const store = create_handoff_store(temp_dir);
    expect(store.load_by_id('no-such-id')).toBeNull();
  });

  it('should list recent snapshots in reverse chronological order', () => {
    const store = create_handoff_store(temp_dir);

    for (let i = 0; i < 5; i++) {
      const hour = String(i + 1).padStart(2, '0');
      store.save(
        make_sample_snapshot({
          snapshot_id: `snap-${i}`,
          created_at: `2026-03-21T${hour}:00:00.000Z`,
        }),
      );
    }

    const recent = store.list_recent(3);
    expect(recent.length).toBe(3);
    // Most recent first
    expect(recent[0].snapshot_id).toBe('snap-4');
    expect(recent[1].snapshot_id).toBe('snap-3');
    expect(recent[2].snapshot_id).toBe('snap-2');
  });

  it('should auto-clean snapshots beyond 30', () => {
    const store = create_handoff_store(temp_dir);

    // Create 35 snapshots
    for (let i = 0; i < 35; i++) {
      const day = String(i + 1).padStart(2, '0');
      const month = i < 28 ? '01' : '02';
      const actual_day = i < 28 ? day : String(i - 27).padStart(2, '0');
      store.save(
        make_sample_snapshot({
          snapshot_id: `snap-${i}`,
          created_at: `2026-${month}-${actual_day}T07:30:00.000Z`,
        }),
      );
    }

    const handoffs_dir = join(temp_dir, 'handoffs');
    const files = readdirSync(handoffs_dir);
    expect(files.length).toBeLessThanOrEqual(30);
  });
});

// === build_snapshot tests ===

describe('build_snapshot', () => {
  let store: TaskStore;
  let mode_manager: ModeManager;

  beforeEach(() => {
    store = make_task_store();
    mode_manager = make_mode_manager('awake');
  });

  afterEach(() => {
    store.close();
  });

  it('should create a snapshot with correct transition modes', () => {
    const snapshot = build_snapshot(
      { store, mode_manager },
      { from: 'sleep', to: 'awake' },
    );

    expect(snapshot.previous_mode).toBe('sleep');
    expect(snapshot.target_mode).toBe('awake');
    expect(snapshot.snapshot_id).toBeTruthy();
    expect(snapshot.created_at).toBeTruthy();
  });

  it('should include active (in_progress) tasks', () => {
    const task = store.create({ title: 'Build feature X', assigned_to: 'captain' });
    store.update_status(task.id, 'in_progress');

    const snapshot = build_snapshot(
      { store, mode_manager },
      { from: 'awake', to: 'sleep' },
    );

    expect(snapshot.active_tasks.length).toBe(1);
    expect(snapshot.active_tasks[0].title).toBe('Build feature X');
    expect(snapshot.active_tasks[0].status).toBe('in_progress');
  });

  it('should include pending tasks as active', () => {
    store.create({ title: 'Pending task', assigned_to: 'captain' });

    const snapshot = build_snapshot(
      { store, mode_manager },
      { from: 'awake', to: 'sleep' },
    );

    // Pending tasks should show up in active_tasks
    const pending = snapshot.active_tasks.filter((t) => t.status === 'pending');
    expect(pending.length).toBe(1);
  });

  it('should include blocked tasks in period summary', () => {
    const task = store.create({ title: 'Blocked task', assigned_to: 'captain' });
    store.block_task(task.id, 'Waiting for API key');

    const snapshot = build_snapshot(
      { store, mode_manager },
      { from: 'awake', to: 'sleep' },
    );

    expect(snapshot.period_summary.tasks_blocked).toBe(1);
  });

  it('should count completed tasks in period summary', () => {
    const t1 = store.create({ title: 'Done task 1', assigned_to: 'captain' });
    const t2 = store.create({ title: 'Done task 2', assigned_to: 'captain' });
    store.complete_task(t1.id, { summary: 'Finished' });
    store.complete_task(t2.id, { summary: 'Finished' });

    const snapshot = build_snapshot(
      { store, mode_manager },
      { from: 'sleep', to: 'awake' },
    );

    expect(snapshot.period_summary.tasks_completed).toBe(2);
  });

  it('should generate recommended actions for SLEEP->AWAKE', () => {
    // Create a blocked task — should recommend reviewing it
    const task = store.create({ title: 'Deploy v2', assigned_to: 'captain' });
    store.block_task(task.id, 'Need credentials');

    const snapshot = build_snapshot(
      { store, mode_manager },
      { from: 'sleep', to: 'awake' },
    );

    expect(snapshot.recommended_actions.length).toBeGreaterThan(0);
  });

  it('should generate recommended actions for AWAKE->SLEEP', () => {
    // Create in_progress task — should recommend continuing it overnight
    const task = store.create({ title: 'Long running crawl', assigned_to: 'hunter' });
    store.update_status(task.id, 'in_progress');

    const snapshot = build_snapshot(
      { store, mode_manager },
      { from: 'awake', to: 'sleep' },
    );

    expect(snapshot.recommended_actions.length).toBeGreaterThan(0);
  });

  it('should handle empty task store gracefully', () => {
    const snapshot = build_snapshot(
      { store, mode_manager },
      { from: 'sleep', to: 'awake' },
    );

    expect(snapshot.active_tasks).toEqual([]);
    expect(snapshot.pending_approvals).toEqual([]);
    expect(snapshot.period_summary.tasks_completed).toBe(0);
    expect(snapshot.period_summary.tasks_created).toBe(0);
    expect(snapshot.period_summary.tasks_blocked).toBe(0);
  });
});

// === format_briefing tests ===

describe('format_briefing', () => {
  it('should format SLEEP->AWAKE briefing in Korean style', () => {
    const snapshot = make_sample_snapshot({
      previous_mode: 'sleep',
      target_mode: 'awake',
    });

    const briefing = format_briefing(snapshot);

    expect(briefing).toContain('SLEEP');
    expect(briefing).toContain('AWAKE');
    expect(briefing).toContain('3'); // tasks_completed
    expect(briefing).toContain('Deploy API');
    expect(briefing).toContain('PR #42');
  });

  it('should format AWAKE->SLEEP briefing', () => {
    const snapshot = make_sample_snapshot({
      previous_mode: 'awake',
      target_mode: 'sleep',
      period_summary: {
        tasks_completed: 5,
        tasks_created: 2,
        tasks_blocked: 1,
        notable_events: ['PR merged'],
      },
      recommended_actions: ['Continue overnight crawl'],
    });

    const briefing = format_briefing(snapshot);

    expect(briefing).toContain('AWAKE');
    expect(briefing).toContain('SLEEP');
    expect(briefing).toContain('5'); // tasks_completed
    expect(briefing).toContain('Continue overnight crawl');
  });

  it('should return a concise briefing (not too long)', () => {
    const snapshot = make_sample_snapshot();
    const briefing = format_briefing(snapshot);

    // Should be reasonable length — under 2000 chars for a normal snapshot
    expect(briefing.length).toBeLessThan(2000);
    expect(briefing.length).toBeGreaterThan(50);
  });

  it('should handle empty snapshot gracefully', () => {
    const snapshot = make_sample_snapshot({
      active_tasks: [],
      pending_approvals: [],
      period_summary: {
        tasks_completed: 0,
        tasks_created: 0,
        tasks_blocked: 0,
        notable_events: [],
      },
      recommended_actions: [],
    });

    const briefing = format_briefing(snapshot);
    expect(briefing).toBeTruthy();
    expect(briefing.length).toBeGreaterThan(20);
  });
});
