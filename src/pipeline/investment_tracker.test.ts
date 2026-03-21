import { describe, it, expect } from 'vitest';
import {
  get_tracked_investments,
  get_upcoming_deadlines,
  generate_investment_report,
  check_eligibility,
  calculate_days_until,
  TRACKED_INVESTMENTS,
  type InvestmentOpportunity,
  type UserProfile,
} from './investment_tracker.js';

// === Helper: create a test investment with overrides ===
const make_investment = (overrides: Partial<InvestmentOpportunity> = {}): InvestmentOpportunity => ({
  id: 'test_investment',
  name: 'Test Program',
  organization: 'Test Org',
  deadline: '2026-06-15',
  amount_range: { min: 1000, max: 5000 },
  eligibility: {
    max_age: null,
    required_experience_years: null,
    requires_incorporation: false,
    team_size_min: null,
    team_size_max: null,
    allowed_sectors: [],
    regional_restriction: null,
    notes: 'Test eligibility',
  },
  url: 'https://test.example.com',
  category: 'government_grant',
  description: 'Test description',
  notes: 'Test notes',
  ...overrides,
});

// === Helper: create a test user profile ===
const make_profile = (overrides: Partial<UserProfile> = {}): UserProfile => ({
  age: 35,
  experience_years: 6,
  has_incorporation: false,
  team_size: 1,
  sectors: ['education', 'social_impact'],
  region: 'seoul',
  ...overrides,
});

describe('Investment Tracker', () => {
  // ========================================
  // 1. Investment Database
  // ========================================

  describe('Investment Database', () => {
    it('should contain 예비창업패키지 (KISED)', () => {
      // Given: the predefined investment database
      const kised = TRACKED_INVESTMENTS.find((i) => i.id === 'kised_preliminary');

      // Then: should exist with correct fields
      expect(kised).toBeDefined();
      expect(kised!.name).toBe('예비창업패키지');
      expect(kised!.organization).toContain('KISED');
      expect(kised!.category).toBe('government_grant');
      expect(kised!.url).toMatch(/^https?:\/\//);
    });

    it('should contain 초기창업패키지', () => {
      const early = TRACKED_INVESTMENTS.find((i) => i.id === 'kised_early_stage');
      expect(early).toBeDefined();
      expect(early!.name).toBe('초기창업패키지');
      expect(early!.amount_range.max).toBeGreaterThan(early!.amount_range.min);
    });

    it('should contain 창업도약패키지', () => {
      const growth = TRACKED_INVESTMENTS.find((i) => i.id === 'kised_growth');
      expect(growth).toBeDefined();
      expect(growth!.name).toBe('창업도약패키지');
    });

    it('should contain 소셜벤처 육성사업', () => {
      const social = TRACKED_INVESTMENTS.find((i) => i.id === 'social_venture');
      expect(social).toBeDefined();
      expect(social!.eligibility.allowed_sectors.length).toBeGreaterThan(0);
    });

    it('should contain 청년창업사관학교', () => {
      const youth = TRACKED_INVESTMENTS.find((i) => i.id === 'youth_startup_academy');
      expect(youth).toBeDefined();
      expect(youth!.eligibility.max_age).toBe(39);
      expect(youth!.category).toBe('accelerator');
    });

    it('should have unique IDs for all investments', () => {
      const ids = TRACKED_INVESTMENTS.map((i) => i.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('should have valid URLs for all investments', () => {
      for (const inv of TRACKED_INVESTMENTS) {
        expect(inv.url).toMatch(/^https?:\/\//);
      }
    });

    it('should have valid amount ranges (min <= max)', () => {
      for (const inv of TRACKED_INVESTMENTS) {
        expect(inv.amount_range.min).toBeLessThanOrEqual(inv.amount_range.max);
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
      const today = new Date('2026-06-15');
      const days = calculate_days_until('2026-06-15', today);
      expect(days).toBe(0);
    });

    it('should return negative days for past deadlines', () => {
      const today = new Date('2026-06-25');
      const days = calculate_days_until('2026-06-15', today);
      expect(days).toBe(-10);
    });
  });

  // ========================================
  // 3. get_tracked_investments
  // ========================================

  describe('get_tracked_investments', () => {
    it('should return all investments from the database', () => {
      const result = get_tracked_investments();
      expect(result.length).toBe(TRACKED_INVESTMENTS.length);
    });

    it('should sort investments by category then deadline', () => {
      // Given: investments with different categories and deadlines
      const investments: InvestmentOpportunity[] = [
        make_investment({ id: 'vc_late', category: 'vc_round', deadline: '2026-09-01' }),
        make_investment({ id: 'grant_early', category: 'government_grant', deadline: '2026-03-01' }),
        make_investment({ id: 'grant_late', category: 'government_grant', deadline: '2026-06-01' }),
      ];

      // When: getting tracked investments
      const result = get_tracked_investments(investments);

      // Then: sorted by category first, then deadline
      expect(result[0].id).toBe('grant_early');
      expect(result[1].id).toBe('grant_late');
      expect(result[2].id).toBe('vc_late');
    });

    it('should place investments with deadline before those without', () => {
      const investments: InvestmentOpportunity[] = [
        make_investment({ id: 'no_dl', deadline: null }),
        make_investment({ id: 'has_dl', deadline: '2026-06-01' }),
      ];

      const result = get_tracked_investments(investments);
      expect(result[0].id).toBe('has_dl');
      expect(result[1].id).toBe('no_dl');
    });

    it('should return a new array (not mutate the original)', () => {
      const result = get_tracked_investments();
      expect(result).not.toBe(TRACKED_INVESTMENTS);
    });

    it('should accept custom investments parameter', () => {
      const custom = [make_investment({ id: 'custom_only' })];
      const result = get_tracked_investments(custom);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('custom_only');
    });
  });

  // ========================================
  // 4. get_upcoming_deadlines
  // ========================================

  describe('get_upcoming_deadlines', () => {
    it('should return investments with deadlines within N days', () => {
      const investments: InvestmentOpportunity[] = [
        make_investment({ id: 'soon', deadline: '2026-06-20' }),
        make_investment({ id: 'later', deadline: '2026-09-01' }),
        make_investment({ id: 'far', deadline: '2027-01-01' }),
      ];
      const today = new Date('2026-06-01');

      const result = get_upcoming_deadlines(30, today, investments);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('soon');
    });

    it('should exclude investments with no deadline', () => {
      const investments: InvestmentOpportunity[] = [
        make_investment({ id: 'no_dl', deadline: null }),
        make_investment({ id: 'has_dl', deadline: '2026-06-10' }),
      ];
      const today = new Date('2026-06-01');

      const result = get_upcoming_deadlines(30, today, investments);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('has_dl');
    });

    it('should exclude past deadlines', () => {
      const investments: InvestmentOpportunity[] = [
        make_investment({ id: 'past', deadline: '2026-05-01' }),
        make_investment({ id: 'future', deadline: '2026-06-20' }),
      ];
      const today = new Date('2026-06-01');

      const result = get_upcoming_deadlines(30, today, investments);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('future');
    });

    it('should include same-day deadlines (D-0)', () => {
      const investments: InvestmentOpportunity[] = [
        make_investment({ id: 'today', deadline: '2026-06-01' }),
      ];
      const today = new Date('2026-06-01');

      const result = get_upcoming_deadlines(30, today, investments);
      expect(result.length).toBe(1);
    });

    it('should sort by urgency (fewer days remaining first)', () => {
      const investments: InvestmentOpportunity[] = [
        make_investment({ id: 'later', deadline: '2026-06-25' }),
        make_investment({ id: 'soon', deadline: '2026-06-05' }),
        make_investment({ id: 'mid', deadline: '2026-06-15' }),
      ];
      const today = new Date('2026-06-01');

      const result = get_upcoming_deadlines(30, today, investments);
      expect(result[0].id).toBe('soon');
      expect(result[1].id).toBe('mid');
      expect(result[2].id).toBe('later');
    });

    it('should return empty array when no deadlines within range', () => {
      const investments: InvestmentOpportunity[] = [
        make_investment({ id: 'far', deadline: '2027-01-01' }),
      ];
      const today = new Date('2026-06-01');

      const result = get_upcoming_deadlines(30, today, investments);
      expect(result).toEqual([]);
    });
  });

  // ========================================
  // 5. check_eligibility
  // ========================================

  describe('check_eligibility', () => {
    it('should return all investments when profile matches everything', () => {
      // Given: a profile that matches all criteria
      const profile = make_profile({ age: 30, has_incorporation: true, sectors: ['education', 'social_impact'] });
      const investments: InvestmentOpportunity[] = [
        make_investment({ id: 'open', eligibility: {
          max_age: null,
          required_experience_years: null,
          requires_incorporation: false,
          team_size_min: null,
          team_size_max: null,
          allowed_sectors: [],
          regional_restriction: null,
          notes: 'Open to all',
        }}),
      ];

      const result = check_eligibility(profile, investments);
      expect(result.length).toBe(1);
    });

    it('should filter out investments exceeding max_age', () => {
      const profile = make_profile({ age: 45 });
      const investments: InvestmentOpportunity[] = [
        make_investment({ id: 'youth', eligibility: {
          max_age: 39,
          required_experience_years: null,
          requires_incorporation: false,
          team_size_min: null,
          team_size_max: null,
          allowed_sectors: [],
          regional_restriction: null,
          notes: 'Youth only',
        }}),
        make_investment({ id: 'open', eligibility: {
          max_age: null,
          required_experience_years: null,
          requires_incorporation: false,
          team_size_min: null,
          team_size_max: null,
          allowed_sectors: [],
          regional_restriction: null,
          notes: 'Open',
        }}),
      ];

      const result = check_eligibility(profile, investments);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('open');
    });

    it('should filter out investments requiring incorporation when user has none', () => {
      const profile = make_profile({ has_incorporation: false });
      const investments: InvestmentOpportunity[] = [
        make_investment({ id: 'needs_corp', eligibility: {
          max_age: null,
          required_experience_years: null,
          requires_incorporation: true,
          team_size_min: null,
          team_size_max: null,
          allowed_sectors: [],
          regional_restriction: null,
          notes: 'Needs corp',
        }}),
        make_investment({ id: 'no_corp', eligibility: {
          max_age: null,
          required_experience_years: null,
          requires_incorporation: false,
          team_size_min: null,
          team_size_max: null,
          allowed_sectors: [],
          regional_restriction: null,
          notes: 'No corp needed',
        }}),
      ];

      const result = check_eligibility(profile, investments);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('no_corp');
    });

    it('should filter by sector when allowed_sectors is specified', () => {
      const profile = make_profile({ sectors: ['fintech'] });
      const investments: InvestmentOpportunity[] = [
        make_investment({ id: 'edu_only', eligibility: {
          max_age: null,
          required_experience_years: null,
          requires_incorporation: false,
          team_size_min: null,
          team_size_max: null,
          allowed_sectors: ['education', 'social_impact'],
          regional_restriction: null,
          notes: 'Edu only',
        }}),
        make_investment({ id: 'all_sectors', eligibility: {
          max_age: null,
          required_experience_years: null,
          requires_incorporation: false,
          team_size_min: null,
          team_size_max: null,
          allowed_sectors: [],
          regional_restriction: null,
          notes: 'All sectors',
        }}),
      ];

      const result = check_eligibility(profile, investments);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('all_sectors');
    });

    it('should filter by team size constraints', () => {
      const profile = make_profile({ team_size: 1 });
      const investments: InvestmentOpportunity[] = [
        make_investment({ id: 'team_3plus', eligibility: {
          max_age: null,
          required_experience_years: null,
          requires_incorporation: false,
          team_size_min: 3,
          team_size_max: null,
          allowed_sectors: [],
          regional_restriction: null,
          notes: 'Team 3+',
        }}),
        make_investment({ id: 'solo_ok', eligibility: {
          max_age: null,
          required_experience_years: null,
          requires_incorporation: false,
          team_size_min: null,
          team_size_max: null,
          allowed_sectors: [],
          regional_restriction: null,
          notes: 'Solo OK',
        }}),
      ];

      const result = check_eligibility(profile, investments);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('solo_ok');
    });

    it('should filter by regional restriction', () => {
      const profile = make_profile({ region: 'seoul' });
      const investments: InvestmentOpportunity[] = [
        make_investment({ id: 'busan_only', eligibility: {
          max_age: null,
          required_experience_years: null,
          requires_incorporation: false,
          team_size_min: null,
          team_size_max: null,
          allowed_sectors: [],
          regional_restriction: 'busan',
          notes: 'Busan only',
        }}),
        make_investment({ id: 'nationwide', eligibility: {
          max_age: null,
          required_experience_years: null,
          requires_incorporation: false,
          team_size_min: null,
          team_size_max: null,
          allowed_sectors: [],
          regional_restriction: null,
          notes: 'Nationwide',
        }}),
      ];

      const result = check_eligibility(profile, investments);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('nationwide');
    });

    it('should filter by experience years', () => {
      const profile = make_profile({ experience_years: 1 });
      const investments: InvestmentOpportunity[] = [
        make_investment({ id: 'needs_5yr', eligibility: {
          max_age: null,
          required_experience_years: 5,
          requires_incorporation: false,
          team_size_min: null,
          team_size_max: null,
          allowed_sectors: [],
          regional_restriction: null,
          notes: 'Needs 5yr',
        }}),
        make_investment({ id: 'no_exp', eligibility: {
          max_age: null,
          required_experience_years: null,
          requires_incorporation: false,
          team_size_min: null,
          team_size_max: null,
          allowed_sectors: [],
          regional_restriction: null,
          notes: 'No exp needed',
        }}),
      ];

      const result = check_eligibility(profile, investments);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('no_exp');
    });

    it('should work with the real TRACKED_INVESTMENTS database', () => {
      // Given: a typical user profile (1인 개발자, 35세, 미법인)
      const profile = make_profile({
        age: 35,
        experience_years: 6,
        has_incorporation: false,
        team_size: 1,
        sectors: ['education', 'social_impact'],
      });

      // When: checking eligibility
      const eligible = check_eligibility(profile);

      // Then: should qualify for at least 예비창업패키지 and 소셜벤처
      expect(eligible.length).toBeGreaterThanOrEqual(2);
      const ids = eligible.map((i) => i.id);
      expect(ids).toContain('kised_preliminary');
      expect(ids).toContain('social_venture');
    });
  });

  // ========================================
  // 6. generate_investment_report
  // ========================================

  describe('generate_investment_report', () => {
    it('should generate a report with all investments', () => {
      const today = new Date('2026-02-01');
      const report = generate_investment_report(today);

      expect(report.opportunities.length).toBe(TRACKED_INVESTMENTS.length);
      expect(report.generated_at).toBeTruthy();
    });

    it('should include report header with date', () => {
      const today = new Date('2026-02-01');
      const report = generate_investment_report(today);

      expect(report.summary).toContain('Investment Opportunity Report');
      expect(report.summary).toContain(`${TRACKED_INVESTMENTS.length} opportunities tracked`);
    });

    it('should include upcoming deadlines section when deadlines exist', () => {
      const investments: InvestmentOpportunity[] = [
        make_investment({ id: 'soon', deadline: '2026-06-20', organization: 'Soon Org' }),
      ];
      const today = new Date('2026-06-01');

      const report = generate_investment_report(today, investments);
      expect(report.summary).toContain('Upcoming Deadlines');
      expect(report.summary).toContain('Soon Org');
    });

    it('should show "no upcoming deadlines" when none within 30 days', () => {
      const investments: InvestmentOpportunity[] = [
        make_investment({ id: 'far', deadline: '2027-06-01' }),
      ];
      const today = new Date('2026-06-01');

      const report = generate_investment_report(today, investments);
      expect(report.summary).toContain('No upcoming deadlines within 30 days');
    });

    it('should include amount range information', () => {
      const investments: InvestmentOpportunity[] = [
        make_investment({ id: 'p1', amount_range: { min: 1000, max: 5000 } }),
      ];
      const today = new Date('2026-06-01');

      const report = generate_investment_report(today, investments);
      expect(report.summary).toContain('1,000만');
      expect(report.summary).toContain('5,000만');
    });

    it('should include eligibility notes', () => {
      const investments: InvestmentOpportunity[] = [
        make_investment({
          id: 'p1',
          eligibility: {
            max_age: null,
            required_experience_years: null,
            requires_incorporation: false,
            team_size_min: null,
            team_size_max: null,
            allowed_sectors: [],
            regional_restriction: null,
            notes: 'Special eligibility info here',
          },
        }),
      ];
      const today = new Date('2026-06-01');

      const report = generate_investment_report(today, investments);
      expect(report.summary).toContain('Special eligibility info here');
    });

    it('should show urgency emoji for close deadlines', () => {
      const investments: InvestmentOpportunity[] = [
        make_investment({ id: 'urgent', deadline: '2026-06-03', organization: 'Urgent Org' }),
      ];
      const today = new Date('2026-06-01');

      const report = generate_investment_report(today, investments);
      expect(report.summary).toMatch(/🚨/);
    });

    it('should handle empty investment list gracefully', () => {
      const empty: InvestmentOpportunity[] = [];
      const today = new Date('2026-06-01');

      const report = generate_investment_report(today, empty);
      expect(report.opportunities).toEqual([]);
      expect(report.summary).toContain('0 opportunities tracked');
    });
  });

  // ========================================
  // 7. Integration
  // ========================================

  describe('Integration', () => {
    it('should produce consistent results between get_tracked_investments and generate_investment_report', () => {
      const today = new Date('2026-04-01');
      const investments = get_tracked_investments();
      const report = generate_investment_report(today);

      expect(investments.length).toBe(report.opportunities.length);
    });

    it('should correctly identify 예비창업패키지 as upcoming when within deadline range', () => {
      // Given: today is March 1, 2026 (예비창업패키지 deadline is March 24 = 23 days)
      const today = new Date('2026-03-01');

      // When: checking upcoming deadlines within 30 days
      const upcoming = get_upcoming_deadlines(30, today);

      // Then: 예비창업패키지 should be in the list
      const kised = upcoming.find((i) => i.id === 'kised_preliminary');
      expect(kised).toBeDefined();
    });

    it('should handle an empty list gracefully in all functions', () => {
      const empty: InvestmentOpportunity[] = [];
      const today = new Date('2026-06-01');
      const profile = make_profile();

      const tracked = get_tracked_investments(empty);
      const upcoming = get_upcoming_deadlines(30, today, empty);
      const eligible = check_eligibility(profile, empty);
      const report = generate_investment_report(today, empty);

      expect(tracked).toEqual([]);
      expect(upcoming).toEqual([]);
      expect(eligible).toEqual([]);
      expect(report.opportunities).toEqual([]);
    });
  });
});
