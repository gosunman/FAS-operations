// Context handoff module for FAS mode transitions (SLEEP <-> AWAKE)
// Saves current work state on mode switch so the next session can resume seamlessly.
// Called by mode_switch.sh via CLI; briefing output feeds into morning_briefing.ts.

import { mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { v4 as uuid_v4 } from 'uuid';
import type { TaskStore } from '../gateway/task_store.js';
import type { ModeManager } from '../gateway/mode_manager.js';
import type { FasMode } from '../shared/types.js';

// === Types ===

export type HandoffSnapshot = {
  snapshot_id: string;
  created_at: string;
  previous_mode: 'sleep' | 'awake';
  target_mode: 'sleep' | 'awake';

  // Active tasks state (in_progress + pending)
  active_tasks: {
    id: string;
    title: string;
    status: string;
    progress_note?: string;
  }[];

  // Pending approvals (placeholder — currently derived from blocked tasks needing review)
  pending_approvals: {
    id: string;
    description: string;
    requested_at: string;
  }[];

  // Key metrics from the period
  period_summary: {
    tasks_completed: number;
    tasks_created: number;
    tasks_blocked: number;
    notable_events: string[];
  };

  // Next session priorities
  recommended_actions: string[];
};

export type HandoffStore = {
  save(snapshot: HandoffSnapshot): void;
  load_latest(): HandoffSnapshot | null;
  load_by_id(id: string): HandoffSnapshot | null;
  list_recent(count: number): HandoffSnapshot[];
};

// === Constants ===

const MAX_SNAPSHOTS = 30;
const HANDOFFS_SUBDIR = 'handoffs';

// === HandoffStore: file-based JSON persistence ===

/**
 * Create a file-based handoff store.
 * Snapshots are saved as JSON files in `{state_dir}/handoffs/`.
 * File naming: `{timestamp}_{previous_mode}_to_{target_mode}.json`
 * Auto-cleans files beyond MAX_SNAPSHOTS (keeps newest).
 */
export const create_handoff_store = (state_dir: string): HandoffStore => {
  const handoffs_dir = join(state_dir, HANDOFFS_SUBDIR);

  // Ensure the handoffs directory exists
  const ensure_dir = () => {
    if (!existsSync(handoffs_dir)) {
      mkdirSync(handoffs_dir, { recursive: true });
    }
  };

  // Convert ISO timestamp to a compact filename-safe format: 20260321T073000
  const timestamp_to_filename_prefix = (iso: string): string => {
    return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '').replace('Z', '');
  };

  // Build filename from snapshot metadata
  const build_filename = (snapshot: HandoffSnapshot): string => {
    const ts = timestamp_to_filename_prefix(snapshot.created_at);
    return `${ts}_${snapshot.previous_mode}_to_${snapshot.target_mode}.json`;
  };

  // Get all snapshot files sorted by name ascending (oldest first)
  const get_sorted_files = (): string[] => {
    if (!existsSync(handoffs_dir)) return [];
    return readdirSync(handoffs_dir)
      .filter((f) => f.endsWith('.json'))
      .sort(); // lexicographic = chronological for our naming scheme
  };

  // Read and parse a snapshot file, returning null on failure
  const read_snapshot = (filename: string): HandoffSnapshot | null => {
    try {
      const filepath = join(handoffs_dir, filename);
      const raw = readFileSync(filepath, 'utf-8');
      return JSON.parse(raw) as HandoffSnapshot;
    } catch {
      return null;
    }
  };

  // Remove oldest files to keep total at or below MAX_SNAPSHOTS
  const auto_clean = () => {
    const files = get_sorted_files();
    if (files.length <= MAX_SNAPSHOTS) return;

    const to_remove = files.slice(0, files.length - MAX_SNAPSHOTS);
    for (const file of to_remove) {
      try {
        unlinkSync(join(handoffs_dir, file));
      } catch {
        // Best-effort cleanup; ignore errors
      }
    }
  };

  // === Public API ===

  const save = (snapshot: HandoffSnapshot): void => {
    ensure_dir();
    const filename = build_filename(snapshot);
    const filepath = join(handoffs_dir, filename);
    writeFileSync(filepath, JSON.stringify(snapshot, null, 2), 'utf-8');
    auto_clean();
  };

  const load_latest = (): HandoffSnapshot | null => {
    const files = get_sorted_files();
    if (files.length === 0) return null;
    return read_snapshot(files[files.length - 1]);
  };

  const load_by_id = (id: string): HandoffSnapshot | null => {
    const files = get_sorted_files();
    for (const file of files) {
      const snapshot = read_snapshot(file);
      if (snapshot && snapshot.snapshot_id === id) return snapshot;
    }
    return null;
  };

  const list_recent = (count: number): HandoffSnapshot[] => {
    const files = get_sorted_files();
    // Take the last `count` files (most recent), then reverse for newest-first
    const recent_files = files.slice(-count).reverse();
    const snapshots: HandoffSnapshot[] = [];
    for (const file of recent_files) {
      const snap = read_snapshot(file);
      if (snap) snapshots.push(snap);
    }
    return snapshots;
  };

  return { save, load_latest, load_by_id, list_recent };
};

// === build_snapshot: gather current state into a HandoffSnapshot ===

/**
 * Build a handoff snapshot from current task store and mode manager state.
 * Reads all tasks, categorizes them, generates a period summary,
 * and suggests recommended actions for the next session.
 */
export const build_snapshot = (
  deps: { store: TaskStore; mode_manager: ModeManager },
  transition: { from: FasMode; to: FasMode },
): HandoffSnapshot => {
  const { store } = deps;
  const now = new Date().toISOString();
  const stats = store.get_stats();

  // Gather active tasks: in_progress + pending
  const in_progress = store.get_by_status('in_progress');
  const pending = store.get_by_status('pending');
  const blocked = store.get_by_status('blocked');
  const done = store.get_by_status('done');

  const active_tasks = [
    ...in_progress.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      progress_note: t.output?.summary,
    })),
    ...pending.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      progress_note: undefined,
    })),
  ];

  // Pending approvals: derive from blocked tasks (they typically need human review)
  const pending_approvals = blocked.map((t) => ({
    id: t.id,
    description: `${t.title}: ${t.output?.summary ?? 'Blocked — needs review'}`,
    requested_at: t.completed_at ?? t.created_at,
  }));

  // Period summary
  const notable_events: string[] = [];
  if (done.length > 0) {
    const recent_done = done.slice(0, 3);
    for (const t of recent_done) {
      if (t.output?.summary) {
        notable_events.push(`${t.title}: ${t.output.summary.slice(0, 80)}`);
      }
    }
  }

  const period_summary = {
    tasks_completed: stats['done'] ?? 0,
    tasks_created: (stats['pending'] ?? 0) + (stats['in_progress'] ?? 0) + (stats['done'] ?? 0) + (stats['blocked'] ?? 0) + (stats['quarantined'] ?? 0),
    tasks_blocked: stats['blocked'] ?? 0,
    notable_events,
  };

  // Recommended actions based on transition direction and current state
  const recommended_actions = generate_recommendations(transition, {
    in_progress,
    pending,
    blocked,
    done,
  });

  return {
    snapshot_id: uuid_v4(),
    created_at: now,
    previous_mode: transition.from,
    target_mode: transition.to,
    active_tasks,
    pending_approvals,
    period_summary,
    recommended_actions,
  };
};

// === generate_recommendations: suggest next actions based on state ===

type TaskLists = {
  in_progress: { id: string; title: string; assigned_to: string }[];
  pending: { id: string; title: string }[];
  blocked: { id: string; title: string; output?: { summary: string } }[];
  done: { id: string; title: string }[];
};

const generate_recommendations = (
  transition: { from: FasMode; to: FasMode },
  tasks: TaskLists,
): string[] => {
  const actions: string[] = [];

  if (transition.from === 'sleep' && transition.to === 'awake') {
    // Morning: review what happened overnight
    if (tasks.done.length > 0) {
      actions.push(`Review ${tasks.done.length} completed task(s) from overnight`);
    }
    if (tasks.blocked.length > 0) {
      for (const t of tasks.blocked) {
        actions.push(`Unblock: ${t.title} — ${t.output?.summary?.slice(0, 60) ?? 'needs review'}`);
      }
    }
    if (tasks.in_progress.length > 0) {
      actions.push(`Check ${tasks.in_progress.length} in-progress task(s)`);
    }
    if (tasks.pending.length > 0) {
      actions.push(`${tasks.pending.length} pending task(s) waiting for assignment`);
    }
    if (actions.length === 0) {
      actions.push('No pending work — ready for new assignments');
    }
  } else if (transition.from === 'awake' && transition.to === 'sleep') {
    // Evening: prepare for overnight autonomous work
    if (tasks.in_progress.length > 0) {
      actions.push(`${tasks.in_progress.length} task(s) will continue running overnight`);
    }
    if (tasks.blocked.length > 0) {
      actions.push(`${tasks.blocked.length} blocked task(s) — resolve before sleep if possible`);
    }
    if (tasks.pending.length > 0) {
      actions.push(`${tasks.pending.length} pending task(s) queued for overnight execution`);
    }
    if (actions.length === 0) {
      actions.push('All clear — no active work for overnight');
    }
  }

  return actions;
};

// === format_briefing: human-readable summary of a snapshot ===

/**
 * Format a handoff snapshot as a concise briefing message.
 * - SLEEP->AWAKE: overnight results + today's priorities
 * - AWAKE->SLEEP: today's results + overnight plan
 */
export const format_briefing = (snapshot: HandoffSnapshot): string => {
  const lines: string[] = [];

  const direction = `${snapshot.previous_mode.toUpperCase()} → ${snapshot.target_mode.toUpperCase()}`;
  const date_str = snapshot.created_at.slice(0, 10);

  lines.push(`[Mode Transition] ${direction} | ${date_str}`);
  lines.push('');

  // Period summary
  const { period_summary } = snapshot;
  if (snapshot.previous_mode === 'sleep' && snapshot.target_mode === 'awake') {
    lines.push('## Overnight Results');
    lines.push(`Completed: ${period_summary.tasks_completed} | Created: ${period_summary.tasks_created} | Blocked: ${period_summary.tasks_blocked}`);
  } else {
    lines.push('## Today\'s Results');
    lines.push(`Completed: ${period_summary.tasks_completed} | Created: ${period_summary.tasks_created} | Blocked: ${period_summary.tasks_blocked}`);
  }

  if (period_summary.notable_events.length > 0) {
    lines.push('');
    lines.push('Notable:');
    for (const event of period_summary.notable_events) {
      lines.push(`  - ${event}`);
    }
  }
  lines.push('');

  // Active tasks
  if (snapshot.active_tasks.length > 0) {
    lines.push(`## Active Tasks (${snapshot.active_tasks.length})`);
    for (const task of snapshot.active_tasks) {
      const note = task.progress_note ? ` — ${task.progress_note.slice(0, 60)}` : '';
      lines.push(`  - [${task.status}] ${task.title}${note}`);
    }
    lines.push('');
  }

  // Pending approvals
  if (snapshot.pending_approvals.length > 0) {
    lines.push(`## Pending Approvals (${snapshot.pending_approvals.length})`);
    for (const approval of snapshot.pending_approvals) {
      lines.push(`  - ${approval.description}`);
    }
    lines.push('');
  }

  // Recommended actions
  if (snapshot.recommended_actions.length > 0) {
    lines.push('## Recommended Actions');
    for (const action of snapshot.recommended_actions) {
      lines.push(`  - ${action}`);
    }
  } else {
    lines.push('## Recommended Actions');
    lines.push('  - No specific actions recommended');
  }

  return lines.join('\n');
};
