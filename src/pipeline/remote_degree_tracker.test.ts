import { describe, it, expect } from 'vitest';
import {
  get_tracked_programs,
  get_upcoming_deadlines,
  generate_deadline_report,
  check_new_programs,
  calculate_days_until,
  REMOTE_DEGREE_PROGRAMS,
  type RemoteDegreeProgram,
} from './remote_degree_tracker.js';

// === Helper: create a test program with overrides ===
const make_program = (overrides: Partial<RemoteDegreeProgram> = {}): RemoteDegreeProgram => ({
  id: 'test_program',
  name: 'Test Program',
  university: 'Test University',
  url: 'https://test.edu',
  degree_type: 'ms',
  delivery: 'fully_online',
  next_deadline: '2026-06-15',
  application_url: 'https://test.edu/apply',
  requirements: {
    gre_required: false,
    toefl_required: true,
    min_gpa: 3.0,
    letters_of_rec: 3,
    work_experience_years: null,
  },
  tuition_total_usd: 10000,
  duration_months: 24,
  brand_score: 7,
  notes: 'Test notes',
  ...overrides,
});

describe('Remote Degree Tracker', () => {
  // ========================================
  // 1. Program Database
  // ========================================

  describe('Program Database', () => {
    it('should contain Georgia Tech OMSCS', () => {
      // Given: the predefined program database
      const omscs = REMOTE_DEGREE_PROGRAMS.find((p) => p.id === 'gatech_omscs');

      // Then: OMSCS should exist with correct fields
      expect(omscs).toBeDefined();
      expect(omscs!.university).toBe('Georgia Institute of Technology');
      expect(omscs!.degree_type).toBe('ms');
      expect(omscs!.delivery).toBe('fully_online');
      expect(omscs!.brand_score).toBeGreaterThanOrEqual(8);
      expect(omscs!.url).toMatch(/^https?:\/\//);
    });

    it('should contain Seoul National University GSEP', () => {
      // Given: the predefined program database
      const gsep = REMOTE_DEGREE_PROGRAMS.find((p) => p.id === 'snu_gsep');

      // Then: GSEP should exist with correct fields
      expect(gsep).toBeDefined();
      expect(gsep!.university).toBe('Seoul National University');
      expect(gsep!.degree_type).toBe('ms');
      expect(gsep!.delivery).toBe('hybrid');
      expect(gsep!.brand_score).toBe(10);
    });

    it('should contain UT Austin MSCSO', () => {
      // Given: the predefined program database
      const ut = REMOTE_DEGREE_PROGRAMS.find((p) => p.id === 'utaustin_mscso');

      // Then: UT Austin should exist
      expect(ut).toBeDefined();
      expect(ut!.university).toContain('Texas');
      expect(ut!.delivery).toBe('fully_online');
    });

    it('should contain UIUC MCS', () => {
      // Given: the predefined program database
      const uiuc = REMOTE_DEGREE_PROGRAMS.find((p) => p.id === 'uiuc_mcs');

      // Then: UIUC should exist
      expect(uiuc).toBeDefined();
      expect(uiuc!.university).toContain('Illinois');
      expect(uiuc!.delivery).toBe('fully_online');
    });

    it('should contain Stanford SCPD', () => {
      // Given: the predefined program database
      const stanford = REMOTE_DEGREE_PROGRAMS.find((p) => p.id === 'stanford_scpd');

      // Then: Stanford should exist as certificate program
      expect(stanford).toBeDefined();
      expect(stanford!.degree_type).toBe('certificate');
      expect(stanford!.next_deadline).toBeNull(); // Rolling enrollment
    });

    it('should have unique IDs for all programs', () => {
      // Given: all programs
      const ids = REMOTE_DEGREE_PROGRAMS.map((p) => p.id);

      // Then: no duplicate IDs
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('should have valid URLs for all programs', () => {
      // Given: all programs
      for (const p of REMOTE_DEGREE_PROGRAMS) {
        // Then: URLs should be valid
        expect(p.url).toMatch(/^https?:\/\//);
        expect(p.application_url).toMatch(/^https?:\/\//);
      }
    });

    it('should have brand_score between 1 and 10 for all programs', () => {
      // Given: all programs
      for (const p of REMOTE_DEGREE_PROGRAMS) {
        // Then: brand_score should be in valid range
        expect(p.brand_score).toBeGreaterThanOrEqual(1);
        expect(p.brand_score).toBeLessThanOrEqual(10);
      }
    });
  });

  // ========================================
  // 2. calculate_days_until
  // ========================================

  describe('calculate_days_until', () => {
    it('should return positive days for future deadlines', () => {
      // Given: a deadline 30 days from today
      const today = new Date('2026-01-01');

      // When: calculating days until Jan 31
      const days = calculate_days_until('2026-01-31', today);

      // Then: should be 30 days
      expect(days).toBe(30);
    });

    it('should return 0 for same-day deadline', () => {
      // Given: deadline is today
      const today = new Date('2026-06-15');

      // When: calculating days until today
      const days = calculate_days_until('2026-06-15', today);

      // Then: 0 days
      expect(days).toBe(0);
    });

    it('should return negative days for past deadlines', () => {
      // Given: deadline was 10 days ago
      const today = new Date('2026-06-25');

      // When: calculating days until June 15
      const days = calculate_days_until('2026-06-15', today);

      // Then: negative
      expect(days).toBe(-10);
    });
  });

  // ========================================
  // 3. get_tracked_programs
  // ========================================

  describe('get_tracked_programs', () => {
    it('should return all programs from the database', () => {
      // Given: the default database
      // When: getting tracked programs
      const result = get_tracked_programs();

      // Then: should return all programs
      expect(result.length).toBe(REMOTE_DEGREE_PROGRAMS.length);
    });

    it('should sort programs by brand_score descending', () => {
      // Given: custom programs with different brand scores
      const programs: RemoteDegreeProgram[] = [
        make_program({ id: 'low', brand_score: 3, next_deadline: '2026-06-01' }),
        make_program({ id: 'high', brand_score: 9, next_deadline: '2026-06-01' }),
        make_program({ id: 'mid', brand_score: 6, next_deadline: '2026-06-01' }),
      ];

      // When: getting tracked programs
      const result = get_tracked_programs(programs);

      // Then: sorted by brand score descending
      expect(result[0].id).toBe('high');
      expect(result[1].id).toBe('mid');
      expect(result[2].id).toBe('low');
    });

    it('should sort programs with deadline before those without on same brand_score', () => {
      // Given: programs with same brand score but one has no deadline
      const programs: RemoteDegreeProgram[] = [
        make_program({ id: 'no_deadline', brand_score: 8, next_deadline: null }),
        make_program({ id: 'has_deadline', brand_score: 8, next_deadline: '2026-09-01' }),
      ];

      // When: getting tracked programs
      const result = get_tracked_programs(programs);

      // Then: program with deadline comes first
      expect(result[0].id).toBe('has_deadline');
      expect(result[1].id).toBe('no_deadline');
    });

    it('should return a new array (not mutate the original)', () => {
      // Given: default programs
      // When: getting tracked programs
      const result = get_tracked_programs();

      // Then: should be a different array reference
      expect(result).not.toBe(REMOTE_DEGREE_PROGRAMS);
    });

    it('should accept custom programs parameter', () => {
      // Given: a single custom program
      const custom = [make_program({ id: 'custom_only' })];

      // When: getting tracked programs with custom list
      const result = get_tracked_programs(custom);

      // Then: should only contain the custom program
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('custom_only');
    });
  });

  // ========================================
  // 4. get_upcoming_deadlines
  // ========================================

  describe('get_upcoming_deadlines', () => {
    it('should return programs with deadlines within N days', () => {
      // Given: programs with varied deadlines
      const programs: RemoteDegreeProgram[] = [
        make_program({ id: 'soon', next_deadline: '2026-06-20' }),
        make_program({ id: 'later', next_deadline: '2026-09-01' }),
        make_program({ id: 'far', next_deadline: '2027-01-01' }),
      ];
      const today = new Date('2026-06-01');

      // When: getting deadlines within 30 days
      const result = get_upcoming_deadlines(30, today, programs);

      // Then: only the "soon" program should match
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('soon');
    });

    it('should exclude programs with no deadline', () => {
      // Given: a program with no deadline
      const programs: RemoteDegreeProgram[] = [
        make_program({ id: 'no_dl', next_deadline: null }),
        make_program({ id: 'has_dl', next_deadline: '2026-06-10' }),
      ];
      const today = new Date('2026-06-01');

      // When: getting upcoming deadlines within 30 days
      const result = get_upcoming_deadlines(30, today, programs);

      // Then: only program with deadline should appear
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('has_dl');
    });

    it('should exclude past deadlines', () => {
      // Given: a program with a past deadline
      const programs: RemoteDegreeProgram[] = [
        make_program({ id: 'past', next_deadline: '2026-05-01' }),
        make_program({ id: 'future', next_deadline: '2026-06-20' }),
      ];
      const today = new Date('2026-06-01');

      // When: getting upcoming deadlines
      const result = get_upcoming_deadlines(30, today, programs);

      // Then: only future deadline should appear
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('future');
    });

    it('should include same-day deadlines (D-0)', () => {
      // Given: a program with deadline today
      const programs: RemoteDegreeProgram[] = [
        make_program({ id: 'today', next_deadline: '2026-06-01' }),
      ];
      const today = new Date('2026-06-01');

      // When: getting upcoming deadlines within 30 days
      const result = get_upcoming_deadlines(30, today, programs);

      // Then: same-day deadline should be included
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('today');
    });

    it('should sort by urgency (fewer days remaining first)', () => {
      // Given: multiple programs with different deadlines
      const programs: RemoteDegreeProgram[] = [
        make_program({ id: 'later', next_deadline: '2026-06-25' }),
        make_program({ id: 'soon', next_deadline: '2026-06-05' }),
        make_program({ id: 'mid', next_deadline: '2026-06-15' }),
      ];
      const today = new Date('2026-06-01');

      // When: getting upcoming deadlines within 30 days
      const result = get_upcoming_deadlines(30, today, programs);

      // Then: sorted by soonest first
      expect(result[0].id).toBe('soon');
      expect(result[1].id).toBe('mid');
      expect(result[2].id).toBe('later');
    });

    it('should return empty array when no deadlines within range', () => {
      // Given: programs with far-future deadlines
      const programs: RemoteDegreeProgram[] = [
        make_program({ id: 'far', next_deadline: '2027-01-01' }),
      ];
      const today = new Date('2026-06-01');

      // When: getting upcoming deadlines within 30 days
      const result = get_upcoming_deadlines(30, today, programs);

      // Then: empty result
      expect(result).toEqual([]);
    });
  });

  // ========================================
  // 5. generate_deadline_report
  // ========================================

  describe('generate_deadline_report', () => {
    it('should generate a report with all programs', () => {
      // Given: default programs and a reference date
      const today = new Date('2026-02-01');

      // When: generating report
      const report = generate_deadline_report(today);

      // Then: report should contain all programs
      expect(report.programs.length).toBe(REMOTE_DEGREE_PROGRAMS.length);
      expect(report.generated_at).toBeTruthy();
    });

    it('should include report header with date', () => {
      // Given: a reference date
      const today = new Date('2026-02-01');

      // When: generating report
      const report = generate_deadline_report(today);

      // Then: summary should contain header
      expect(report.summary).toContain('Remote Degree Program Report');
      expect(report.summary).toContain(`${REMOTE_DEGREE_PROGRAMS.length} programs tracked`);
    });

    it('should include upcoming deadlines section when deadlines exist within 90 days', () => {
      // Given: programs with a deadline within 90 days
      const programs: RemoteDegreeProgram[] = [
        make_program({ id: 'soon', next_deadline: '2026-06-20', university: 'Soon University' }),
      ];
      const today = new Date('2026-06-01');

      // When: generating report
      const report = generate_deadline_report(today, programs);

      // Then: should have upcoming section
      expect(report.summary).toContain('Upcoming Deadlines');
      expect(report.summary).toContain('Soon University');
      expect(report.summary).toContain('D-19');
    });

    it('should show "no upcoming deadlines" when none within 90 days', () => {
      // Given: program with far-future deadline
      const programs: RemoteDegreeProgram[] = [
        make_program({ id: 'far', next_deadline: '2027-06-01' }),
      ];
      const today = new Date('2026-06-01');

      // When: generating report
      const report = generate_deadline_report(today, programs);

      // Then: should indicate no upcoming deadlines
      expect(report.summary).toContain('No upcoming deadlines within 90 days');
    });

    it('should include all tracked programs section', () => {
      // Given: custom programs
      const programs: RemoteDegreeProgram[] = [
        make_program({ id: 'p1', university: 'Alpha University', brand_score: 9 }),
        make_program({ id: 'p2', university: 'Beta University', brand_score: 7 }),
      ];
      const today = new Date('2026-06-01');

      // When: generating report
      const report = generate_deadline_report(today, programs);

      // Then: should contain both programs
      expect(report.summary).toContain('All Tracked Programs');
      expect(report.summary).toContain('Alpha University');
      expect(report.summary).toContain('Beta University');
    });

    it('should display tuition information', () => {
      // Given: program with tuition
      const programs: RemoteDegreeProgram[] = [
        make_program({ id: 'p1', tuition_total_usd: 7000 }),
      ];
      const today = new Date('2026-06-01');

      // When: generating report
      const report = generate_deadline_report(today, programs);

      // Then: should contain tuition info
      expect(report.summary).toContain('$7,000');
    });

    it('should display TBD for unknown tuition', () => {
      // Given: program with null tuition
      const programs: RemoteDegreeProgram[] = [
        make_program({ id: 'p1', tuition_total_usd: null }),
      ];
      const today = new Date('2026-06-01');

      // When: generating report
      const report = generate_deadline_report(today, programs);

      // Then: should show TBD
      expect(report.summary).toContain('TBD');
    });

    it('should include requirements summary', () => {
      // Given: program with various requirements
      const programs: RemoteDegreeProgram[] = [
        make_program({
          id: 'p1',
          requirements: {
            gre_required: true,
            toefl_required: true,
            min_gpa: 3.5,
            letters_of_rec: 3,
            work_experience_years: 2,
          },
        }),
      ];
      const today = new Date('2026-06-01');

      // When: generating report
      const report = generate_deadline_report(today, programs);

      // Then: should include requirement details
      expect(report.summary).toContain('GRE');
      expect(report.summary).toContain('TOEFL');
      expect(report.summary).toContain('GPA 3.5');
      expect(report.summary).toContain('3 LoR');
      expect(report.summary).toContain('2yr exp');
    });

    it('should show "Rolling / TBD" for programs without deadline', () => {
      // Given: program with no deadline
      const programs: RemoteDegreeProgram[] = [
        make_program({ id: 'rolling', next_deadline: null }),
      ];
      const today = new Date('2026-06-01');

      // When: generating report
      const report = generate_deadline_report(today, programs);

      // Then: should show rolling
      expect(report.summary).toContain('Rolling / TBD');
    });

    it('should fit within Telegram message limit (4096 chars) for a single program', () => {
      // Given: a single program
      const programs: RemoteDegreeProgram[] = [make_program({ id: 'single' })];
      const today = new Date('2026-06-01');

      // When: generating report
      const report = generate_deadline_report(today, programs);

      // Then: should be within Telegram limit
      expect(report.summary.length).toBeLessThan(4096);
    });

    it('should include urgency emoji for close deadlines', () => {
      // Given: program with deadline 5 days away
      const programs: RemoteDegreeProgram[] = [
        make_program({ id: 'urgent', next_deadline: '2026-06-06', university: 'Urgent U' }),
      ];
      const today = new Date('2026-06-01');

      // When: generating report
      const report = generate_deadline_report(today, programs);

      // Then: should have urgent emoji (within 7 days)
      expect(report.summary).toMatch(/🚨/);
    });
  });

  // ========================================
  // 6. check_new_programs (placeholder)
  // ========================================

  describe('check_new_programs', () => {
    it('should return empty discovered list (placeholder)', async () => {
      // Given: the placeholder implementation
      // When: checking for new programs
      const result = await check_new_programs();

      // Then: should return empty list with message
      expect(result.discovered).toEqual([]);
      expect(result.message).toContain('placeholder');
    });

    it('should return a message string', async () => {
      // Given: the placeholder implementation
      // When: checking for new programs
      const result = await check_new_programs();

      // Then: message should be non-empty
      expect(typeof result.message).toBe('string');
      expect(result.message.length).toBeGreaterThan(0);
    });
  });

  // ========================================
  // 7. Integration
  // ========================================

  describe('Integration', () => {
    it('should produce consistent results between get_tracked_programs and generate_deadline_report', () => {
      // Given: the default database
      const today = new Date('2026-04-01');

      // When: getting programs and generating report
      const programs = get_tracked_programs();
      const report = generate_deadline_report(today);

      // Then: same number of programs
      expect(programs.length).toBe(report.programs.length);
    });

    it('should handle an empty program list gracefully', () => {
      // Given: empty program list
      const empty: RemoteDegreeProgram[] = [];
      const today = new Date('2026-06-01');

      // When: calling all functions with empty list
      const tracked = get_tracked_programs(empty);
      const upcoming = get_upcoming_deadlines(30, today, empty);
      const report = generate_deadline_report(today, empty);

      // Then: all should return gracefully
      expect(tracked).toEqual([]);
      expect(upcoming).toEqual([]);
      expect(report.programs).toEqual([]);
      expect(report.summary).toContain('0 programs tracked');
    });

    it('should correctly identify OMSCS as upcoming when within deadline range', () => {
      // Given: today is Feb 1, 2026 (OMSCS deadline is Mar 1, 2026 = 28 days)
      const today = new Date('2026-02-01');

      // When: checking upcoming deadlines within 30 days
      const upcoming = get_upcoming_deadlines(30, today);

      // Then: OMSCS should be in the list
      const omscs = upcoming.find((p) => p.id === 'gatech_omscs');
      expect(omscs).toBeDefined();
    });
  });
});
