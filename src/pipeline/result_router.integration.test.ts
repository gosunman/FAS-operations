// Integration test: result_router vs schedules.yml
// Ensures every hunter schedule title is routed to a specific handler (not 'generic').
// This catches "silent drift" — if a schedule title changes and the router stops matching.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as yaml_parse } from 'yaml';
import { match_handler } from './result_router.js';

// === Load schedules.yml ===

type ScheduleEntry = {
  title: string;
  agent?: string;
  type?: string;
  mode?: string;
  action?: string;
  [key: string]: unknown;
};

type SchedulesFile = {
  schedules: Record<string, ScheduleEntry>;
};

const SCHEDULES_PATH = join(import.meta.dirname, '..', '..', 'config', 'schedules.yml');

const load_schedules = (): SchedulesFile => {
  const raw = readFileSync(SCHEDULES_PATH, 'utf-8');
  return yaml_parse(raw) as SchedulesFile;
};

// === Tests ===

describe('result_router vs schedules.yml integration', () => {
  const schedules = load_schedules();
  const entries = Object.entries(schedules.schedules);

  // Filter to only hunter-agent schedules (these produce results routed back to captain)
  const hunter_entries = entries.filter(([, entry]) => entry.agent === 'hunter');

  it('schedules.yml should have at least one hunter schedule', () => {
    expect(hunter_entries.length).toBeGreaterThan(0);
  });

  // Create a dynamic test for EVERY hunter schedule entry
  describe('every hunter schedule title must match a specific handler', () => {
    for (const [key, entry] of hunter_entries) {
      it(`"${key}" (title: "${entry.title}") should NOT route to 'generic'`, () => {
        const handler = match_handler(entry.title);
        expect(
          handler,
          `Schedule "${key}" with title "${entry.title}" routes to 'generic' — ` +
          `add a pattern to ROUTE_MAP in result_router.ts`,
        ).not.toBe('generic');
      });
    }
  });

  // Verify the handler names are meaningful (not empty/undefined)
  describe('matched handlers should be non-empty strings', () => {
    for (const [key, entry] of hunter_entries) {
      it(`"${key}" handler should be a non-empty string`, () => {
        const handler = match_handler(entry.title);
        expect(handler).toBeTruthy();
        expect(typeof handler).toBe('string');
        expect(handler.length).toBeGreaterThan(0);
      });
    }
  });

  // Snapshot: list all schedule->handler mappings for review
  it('should produce a complete schedule->handler mapping', () => {
    const mapping: Record<string, string> = {};
    for (const [key, entry] of hunter_entries) {
      mapping[key] = match_handler(entry.title);
    }

    // Expected mapping based on current schedules.yml + ROUTE_MAP
    expect(mapping).toEqual({
      startup_grants: 'grant',
      lotto_housing: 'housing',
      blind_naver: 'blind',
      blind_nvc_monitor: 'blind_nvc',
      ai_trends: 'ai_trends',
      bigtech_jobs: 'bigtech_jobs',
      edutech_competitors: 'edutech_competitors',
      grad_school_deadlines: 'grad_school',
      b2b_intent_crawl: 'b2b_intent',
    });
  });
});
