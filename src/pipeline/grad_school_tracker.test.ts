import { describe, it, expect } from 'vitest';
import {
  check_deadlines,
  calculate_days_until,
  generate_checklist,
  format_alert_message,
  GRAD_SCHOOL_PROGRAMS,
  ALERT_STAGES,
  type GradSchoolProgram,
  type DeadlineAlert,
} from './grad_school_tracker.js';

// === Helper: create a date string in YYYY-MM-DD format ===
const date_str = (year: number, month: number, day: number): string =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

describe('Grad School Tracker', () => {
  // ========================================
  // 1. Deadline Database Structure
  // ========================================

  describe('Deadline Database', () => {
    it('should have OMSCS program with required fields', () => {
      // Given: the predefined program database
      const omscs = GRAD_SCHOOL_PROGRAMS.find((p) => p.id === 'omscs_fall_2026');

      // Then: OMSCS should exist with all required fields
      expect(omscs).toBeDefined();
      expect(omscs!.name).toContain('OMSCS');
      expect(omscs!.deadline).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(omscs!.requirements).toBeInstanceOf(Array);
      expect(omscs!.requirements.length).toBeGreaterThan(0);
      expect(omscs!.url).toMatch(/^https?:\/\//);
      expect(omscs!.institution).toBe('Georgia Tech');
    });

    it('should have GSEP program with required fields', () => {
      // Given: the predefined program database
      const gsep = GRAD_SCHOOL_PROGRAMS.find((p) => p.id.startsWith('gsep_'));

      // Then: GSEP should exist with all required fields
      expect(gsep).toBeDefined();
      expect(gsep!.name).toContain('GSEP');
      expect(gsep!.deadline).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(gsep!.requirements).toBeInstanceOf(Array);
      expect(gsep!.requirements.length).toBeGreaterThan(0);
      expect(gsep!.url).toMatch(/^https?:\/\//);
      expect(gsep!.institution).toBe('Seoul National University');
    });

    it('should have unique IDs for all programs', () => {
      // Given: all programs
      const ids = GRAD_SCHOOL_PROGRAMS.map((p) => p.id);

      // Then: no duplicate IDs
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  // ========================================
  // 2. Days-Until Calculator
  // ========================================

  describe('calculate_days_until', () => {
    it('should return positive days for future deadlines', () => {
      // Given: a deadline 30 days from today
      const today = new Date('2026-01-01');
      const deadline = '2026-01-31';

      // When: calculating days until
      const days = calculate_days_until(deadline, today);

      // Then: should be 30 days
      expect(days).toBe(30);
    });

    it('should return 0 for same-day deadline', () => {
      // Given: deadline is today
      const today = new Date('2026-03-01');
      const deadline = '2026-03-01';

      // When: calculating days until
      const days = calculate_days_until(deadline, today);

      // Then: 0 days remaining
      expect(days).toBe(0);
    });

    it('should return negative days for past deadlines', () => {
      // Given: deadline was 5 days ago
      const today = new Date('2026-03-10');
      const deadline = '2026-03-05';

      // When: calculating days until
      const days = calculate_days_until(deadline, today);

      // Then: negative days
      expect(days).toBe(-5);
    });
  });

  // ========================================
  // 3. Staged Alert Calculator
  // ========================================

  describe('Alert Stages', () => {
    it('should define 4 alert stages: D-30, D-14, D-7, D-3', () => {
      // Then: exactly 4 stages
      expect(ALERT_STAGES).toHaveLength(4);
      expect(ALERT_STAGES.map((s) => s.days_before)).toEqual([30, 14, 7, 3]);
    });

    it('should have Korean label for each stage', () => {
      // Then: every stage has a label
      ALERT_STAGES.forEach((stage) => {
        expect(stage.label).toBeTruthy();
        expect(typeof stage.label).toBe('string');
      });
    });
  });

  describe('check_deadlines', () => {
    it('should fire D-30 alert exactly 30 days before deadline', () => {
      // Given: OMSCS deadline is 2026-03-01 (typical), today is 30 days before
      const omscs = GRAD_SCHOOL_PROGRAMS.find((p) => p.id === 'omscs_fall_2026')!;
      const deadline_date = new Date(omscs.deadline);
      const thirty_days_before = new Date(deadline_date);
      thirty_days_before.setDate(deadline_date.getDate() - 30);

      // When: checking deadlines on D-30
      const alerts = check_deadlines(thirty_days_before);

      // Then: should contain a D-30 alert for OMSCS
      const omscs_alerts = alerts.filter((a) => a.program.id === omscs.id);
      expect(omscs_alerts.length).toBe(1);
      expect(omscs_alerts[0].stage.days_before).toBe(30);
    });

    it('should fire D-7 alert exactly 7 days before deadline', () => {
      // Given: a known program deadline
      const omscs = GRAD_SCHOOL_PROGRAMS.find((p) => p.id === 'omscs_fall_2026')!;
      const deadline_date = new Date(omscs.deadline);
      const seven_days_before = new Date(deadline_date);
      seven_days_before.setDate(deadline_date.getDate() - 7);

      // When: checking deadlines on D-7
      const alerts = check_deadlines(seven_days_before);

      // Then: should contain a D-7 alert
      const omscs_alerts = alerts.filter((a) => a.program.id === omscs.id);
      expect(omscs_alerts.length).toBe(1);
      expect(omscs_alerts[0].stage.days_before).toBe(7);
    });

    it('should fire D-14 alert exactly 14 days before deadline', () => {
      // Given: a known program deadline
      const omscs = GRAD_SCHOOL_PROGRAMS.find((p) => p.id === 'omscs_fall_2026')!;
      const deadline_date = new Date(omscs.deadline);
      const fourteen_days_before = new Date(deadline_date);
      fourteen_days_before.setDate(deadline_date.getDate() - 14);

      // When: checking deadlines on D-14
      const alerts = check_deadlines(fourteen_days_before);

      // Then: should contain a D-14 alert
      const omscs_alerts = alerts.filter((a) => a.program.id === omscs.id);
      expect(omscs_alerts.length).toBe(1);
      expect(omscs_alerts[0].stage.days_before).toBe(14);
    });

    it('should fire D-3 alert exactly 3 days before deadline', () => {
      // Given: a known program deadline
      const omscs = GRAD_SCHOOL_PROGRAMS.find((p) => p.id === 'omscs_fall_2026')!;
      const deadline_date = new Date(omscs.deadline);
      const three_days_before = new Date(deadline_date);
      three_days_before.setDate(deadline_date.getDate() - 3);

      // When: checking deadlines on D-3
      const alerts = check_deadlines(three_days_before);

      // Then: should contain a D-3 alert
      const omscs_alerts = alerts.filter((a) => a.program.id === omscs.id);
      expect(omscs_alerts.length).toBe(1);
      expect(omscs_alerts[0].stage.days_before).toBe(3);
    });

    it('should return empty array when no alerts should fire', () => {
      // Given: a date far from any deadline (e.g., 2025-06-15 — no program deadline nearby)
      const far_away_date = new Date('2025-06-15');

      // When: checking deadlines
      const alerts = check_deadlines(far_away_date);

      // Then: no alerts
      expect(alerts).toEqual([]);
    });

    it('should not fire alerts for past deadlines', () => {
      // Given: a date well after all 2026 deadlines
      const past_date = new Date('2027-01-01');

      // When: checking deadlines
      const alerts = check_deadlines(past_date);

      // Then: no alerts (all deadlines passed)
      expect(alerts).toEqual([]);
    });

    it('should handle multiple programs with same alert date', () => {
      // Given: custom programs with deadlines 30 days apart to force overlap
      const custom_programs: GradSchoolProgram[] = [
        {
          id: 'test_a',
          name: 'Test A',
          institution: 'Uni A',
          deadline: '2026-06-01',
          requirements: ['item_a'],
          url: 'https://a.com',
        },
        {
          id: 'test_b',
          name: 'Test B',
          institution: 'Uni B',
          deadline: '2026-06-01',
          requirements: ['item_b'],
          url: 'https://b.com',
        },
      ];

      // When: checking on D-30 for both
      const alerts = check_deadlines(new Date('2026-05-02'), custom_programs);

      // Then: both programs should have D-30 alerts
      expect(alerts).toHaveLength(2);
      expect(alerts.every((a) => a.stage.days_before === 30)).toBe(true);
    });

    it('should accept custom programs parameter to override defaults', () => {
      // Given: a single custom program
      const custom: GradSchoolProgram[] = [
        {
          id: 'custom_test',
          name: 'Custom Program',
          institution: 'Test University',
          deadline: '2026-08-15',
          requirements: ['requirement_1'],
          url: 'https://test.edu',
        },
      ];

      // When: checking 30 days before custom deadline
      const alerts = check_deadlines(new Date('2026-07-16'), custom);

      // Then: should fire D-30 for custom program
      expect(alerts).toHaveLength(1);
      expect(alerts[0].program.id).toBe('custom_test');
      expect(alerts[0].stage.days_before).toBe(30);
    });
  });

  // ========================================
  // 4. Checklist Generator
  // ========================================

  describe('generate_checklist', () => {
    it('should generate OMSCS checklist with all required items', () => {
      // Given: OMSCS program
      const omscs = GRAD_SCHOOL_PROGRAMS.find((p) => p.id === 'omscs_fall_2026')!;

      // When: generating checklist
      const checklist = generate_checklist(omscs);

      // Then: should include core OMSCS items
      expect(checklist).toContain('TOEFL');
      expect(checklist).toContain('transcript');
      expect(checklist).toContain('Statement of Purpose');
      expect(checklist).toContain('recommendation');
      expect(checklist).toContain('Resume');
    });

    it('should generate GSEP checklist with Korean items', () => {
      // Given: GSEP program
      const gsep = GRAD_SCHOOL_PROGRAMS.find((p) => p.id.startsWith('gsep_'))!;

      // When: generating checklist
      const checklist = generate_checklist(gsep);

      // Then: should include GSEP-specific items in Korean
      expect(checklist).toContain('학업계획서');
      expect(checklist).toContain('성적증명서');
      expect(checklist).toContain('추천서');
    });

    it('should return formatted string with checkbox markers', () => {
      // Given: any program
      const program = GRAD_SCHOOL_PROGRAMS[0];

      // When: generating checklist
      const checklist = generate_checklist(program);

      // Then: should use checkbox format
      const lines = checklist.split('\n').filter((l) => l.trim());
      lines.forEach((line) => {
        expect(line).toMatch(/^[☐□\-\*\[]/);
      });
    });
  });

  // ========================================
  // 5. Alert Formatter
  // ========================================

  describe('format_alert_message', () => {
    it('should include program name in formatted message', () => {
      // Given: an alert for OMSCS D-30
      const omscs = GRAD_SCHOOL_PROGRAMS.find((p) => p.id === 'omscs_fall_2026')!;
      const alert: DeadlineAlert = {
        program: omscs,
        stage: ALERT_STAGES[0], // D-30
        days_remaining: 30,
        checklist: generate_checklist(omscs),
      };

      // When: formatting
      const message = format_alert_message(alert);

      // Then: should contain program name
      expect(message).toContain('OMSCS');
    });

    it('should include deadline date in formatted message', () => {
      // Given: an alert
      const omscs = GRAD_SCHOOL_PROGRAMS.find((p) => p.id === 'omscs_fall_2026')!;
      const alert: DeadlineAlert = {
        program: omscs,
        stage: ALERT_STAGES[0],
        days_remaining: 30,
        checklist: generate_checklist(omscs),
      };

      // When: formatting
      const message = format_alert_message(alert);

      // Then: should contain the deadline date
      expect(message).toContain(omscs.deadline);
    });

    it('should include days remaining label', () => {
      // Given: a D-7 alert
      const omscs = GRAD_SCHOOL_PROGRAMS.find((p) => p.id === 'omscs_fall_2026')!;
      const alert: DeadlineAlert = {
        program: omscs,
        stage: ALERT_STAGES[2], // D-7
        days_remaining: 7,
        checklist: generate_checklist(omscs),
      };

      // When: formatting
      const message = format_alert_message(alert);

      // Then: should contain stage label and days info
      expect(message).toContain(ALERT_STAGES[2].label);
    });

    it('should include checklist in formatted message', () => {
      // Given: a D-14 alert
      const omscs = GRAD_SCHOOL_PROGRAMS.find((p) => p.id === 'omscs_fall_2026')!;
      const checklist = generate_checklist(omscs);
      const alert: DeadlineAlert = {
        program: omscs,
        stage: ALERT_STAGES[1], // D-14
        days_remaining: 14,
        checklist,
      };

      // When: formatting
      const message = format_alert_message(alert);

      // Then: should contain checklist content
      expect(message).toContain('TOEFL');
      expect(message).toContain('transcript');
    });

    it('should include URL in formatted message', () => {
      // Given: an alert
      const omscs = GRAD_SCHOOL_PROGRAMS.find((p) => p.id === 'omscs_fall_2026')!;
      const alert: DeadlineAlert = {
        program: omscs,
        stage: ALERT_STAGES[0],
        days_remaining: 30,
        checklist: generate_checklist(omscs),
      };

      // When: formatting
      const message = format_alert_message(alert);

      // Then: should contain application URL
      expect(message).toContain(omscs.url);
    });
  });

  // ========================================
  // 6. Integration: check_deadlines returns full alerts
  // ========================================

  describe('Integration', () => {
    it('should return DeadlineAlert objects with all fields populated', () => {
      // Given: a date exactly D-30 before OMSCS deadline
      const omscs = GRAD_SCHOOL_PROGRAMS.find((p) => p.id === 'omscs_fall_2026')!;
      const deadline_date = new Date(omscs.deadline);
      const d30 = new Date(deadline_date);
      d30.setDate(deadline_date.getDate() - 30);

      // When: checking deadlines
      const alerts = check_deadlines(d30);

      // Then: alert should have all fields
      const alert = alerts.find((a) => a.program.id === omscs.id);
      expect(alert).toBeDefined();
      expect(alert!.program).toBe(omscs);
      expect(alert!.stage).toBe(ALERT_STAGES[0]); // D-30
      expect(alert!.days_remaining).toBe(30);
      expect(alert!.checklist).toBeTruthy();
      expect(typeof alert!.checklist).toBe('string');
    });

    it('should return formatted messages that are Telegram-ready', () => {
      // Given: D-3 alert for any program
      const program = GRAD_SCHOOL_PROGRAMS[0];
      const deadline_date = new Date(program.deadline);
      const d3 = new Date(deadline_date);
      d3.setDate(deadline_date.getDate() - 3);

      // When: checking and formatting
      const alerts = check_deadlines(d3);
      const relevant = alerts.find((a) => a.program.id === program.id);
      expect(relevant).toBeDefined();

      const message = format_alert_message(relevant!);

      // Then: message should be non-empty, reasonably sized for Telegram
      expect(message.length).toBeGreaterThan(50);
      expect(message.length).toBeLessThan(4096); // Telegram message limit
    });
  });
});
