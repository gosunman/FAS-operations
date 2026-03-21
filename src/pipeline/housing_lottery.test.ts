// TDD tests for Housing Lottery Scanner
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FILTER,
  INVESTMENT_FILTER,
  GANGNAM_ACCESSIBLE_REGIONS,
  ALL_REGIONS,
  is_expired,
  matches_filter,
  filter_announcements,
  sort_by_deadline,
  generate_scan_report,
  generate_hunter_prompt,
  type Announcement,
  type FilterConfig,
} from './housing_lottery.js';

// === Test fixtures ===

const make_announcement = (overrides: Partial<Announcement> = {}): Announcement => ({
  id: 'test-001',
  title: '테스트 아파트 분양공고',
  housing_type: 'public_sale',
  region: 'seoul',
  area_m2: 59,
  announcement_date: '2026-03-01',
  deadline: '2026-04-15',
  url: 'https://www.applyhome.co.kr/ai/aia/selectAPTLttotPblancDetail.do?houseManageNo=test',
  complex_name: '테스트 아파트',
  total_units: 500,
  ...overrides,
});

// === Tests ===

describe('Housing Lottery Scanner', () => {
  // ========================================
  // 1. Constants
  // ========================================

  describe('Constants', () => {
    it('should define Gangnam accessible regions as Seoul, Gyeonggi, Incheon', () => {
      expect(GANGNAM_ACCESSIBLE_REGIONS).toContain('seoul');
      expect(GANGNAM_ACCESSIBLE_REGIONS).toContain('gyeonggi');
      expect(GANGNAM_ACCESSIBLE_REGIONS).toContain('incheon');
      expect(GANGNAM_ACCESSIBLE_REGIONS).toHaveLength(3);
    });

    it('should define ALL_REGIONS with 17 regions', () => {
      expect(ALL_REGIONS).toHaveLength(17);
      expect(ALL_REGIONS).toContain('seoul');
      expect(ALL_REGIONS).toContain('jeju');
    });
  });

  // ========================================
  // 2. Default Filter Config
  // ========================================

  describe('Default Filter', () => {
    it('should set minimum area to 50m2', () => {
      expect(DEFAULT_FILTER.min_area_m2).toBe(50);
    });

    it('should limit regions to capital area (Gangnam accessible)', () => {
      expect(DEFAULT_FILTER.regions).toEqual(GANGNAM_ACCESSIBLE_REGIONS);
    });

    it('should include major housing types', () => {
      expect(DEFAULT_FILTER.housing_types).toContain('public_sale');
      expect(DEFAULT_FILTER.housing_types).toContain('private_sale');
      expect(DEFAULT_FILTER.housing_types).toContain('newlywed');
    });

    it('should exclude expired announcements by default', () => {
      expect(DEFAULT_FILTER.exclude_expired).toBe(true);
    });
  });

  // ========================================
  // 3. Investment Filter
  // ========================================

  describe('Investment Filter', () => {
    it('should accept any region', () => {
      expect(INVESTMENT_FILTER.regions).toEqual(ALL_REGIONS);
    });

    it('should accept any area size', () => {
      expect(INVESTMENT_FILTER.min_area_m2).toBe(0);
    });
  });

  // ========================================
  // 4. Expiration Check
  // ========================================

  describe('is_expired', () => {
    it('should return false for future deadline', () => {
      expect(is_expired('2026-12-31', new Date('2026-03-22'))).toBe(false);
    });

    it('should return true for past deadline', () => {
      expect(is_expired('2026-01-01', new Date('2026-03-22'))).toBe(true);
    });

    it('should return false for today (deadline day is still valid)', () => {
      // Deadline day itself should not be expired (valid until end of day)
      expect(is_expired('2026-03-22', new Date('2026-03-22T10:00:00'))).toBe(false);
    });
  });

  // ========================================
  // 5. Filter Matching
  // ========================================

  describe('matches_filter', () => {
    it('should match announcement meeting all criteria', () => {
      // Given: Seoul, 59m2, public_sale, not expired
      const ann = make_announcement();
      expect(matches_filter(ann, DEFAULT_FILTER, new Date('2026-03-22'))).toBe(true);
    });

    it('should reject announcement below minimum area', () => {
      // Given: only 30m2
      const ann = make_announcement({ area_m2: 30 });
      expect(matches_filter(ann, DEFAULT_FILTER, new Date('2026-03-22'))).toBe(false);
    });

    it('should reject announcement in wrong region', () => {
      // Given: Jeju is not in Gangnam accessible regions
      const ann = make_announcement({ region: 'jeju' });
      expect(matches_filter(ann, DEFAULT_FILTER, new Date('2026-03-22'))).toBe(false);
    });

    it('should reject expired announcement', () => {
      // Given: deadline is past
      const ann = make_announcement({ deadline: '2026-01-01' });

      // Default filter excludes expired, so expired announcement should NOT match
      expect(matches_filter(ann, DEFAULT_FILTER, new Date('2026-03-22'))).toBe(false);

      // Explicitly allowing expired should match
      expect(matches_filter(ann, { ...DEFAULT_FILTER, exclude_expired: false }, new Date('2026-03-22'))).toBe(true);
    });

    it('should match any region with investment filter', () => {
      // Given: Jeju with investment filter
      const ann = make_announcement({ region: 'jeju', area_m2: 20 });
      expect(matches_filter(ann, INVESTMENT_FILTER, new Date('2026-03-22'))).toBe(true);
    });

    it('should reject unknown housing type', () => {
      // Given: 'other' type is not in default filter
      const ann = make_announcement({ housing_type: 'other' });
      expect(matches_filter(ann, DEFAULT_FILTER, new Date('2026-03-22'))).toBe(false);
    });
  });

  // ========================================
  // 6. Filter Announcements (batch)
  // ========================================

  describe('filter_announcements', () => {
    it('should return only matching announcements', () => {
      // Given: mix of matching and non-matching
      const announcements = [
        make_announcement({ id: '1', region: 'seoul', area_m2: 59 }),
        make_announcement({ id: '2', region: 'jeju', area_m2: 85 }),
        make_announcement({ id: '3', region: 'gyeonggi', area_m2: 84 }),
        make_announcement({ id: '4', region: 'seoul', area_m2: 30 }),
      ];

      // When: filtering with default config
      const result = filter_announcements(announcements, DEFAULT_FILTER, new Date('2026-03-22'));

      // Then: only Seoul 59m2 and Gyeonggi 84m2 should pass
      expect(result).toHaveLength(2);
      expect(result.map((a) => a.id)).toEqual(['1', '3']);
    });

    it('should return empty array when nothing matches', () => {
      const announcements = [
        make_announcement({ region: 'jeju' }),
      ];
      const result = filter_announcements(announcements, DEFAULT_FILTER, new Date('2026-03-22'));
      expect(result).toHaveLength(0);
    });
  });

  // ========================================
  // 7. Sort by Deadline
  // ========================================

  describe('sort_by_deadline', () => {
    it('should sort by deadline ascending', () => {
      const announcements = [
        make_announcement({ id: '3', deadline: '2026-06-01' }),
        make_announcement({ id: '1', deadline: '2026-04-01' }),
        make_announcement({ id: '2', deadline: '2026-05-01' }),
      ];

      const sorted = sort_by_deadline(announcements);
      expect(sorted.map((a) => a.id)).toEqual(['1', '2', '3']);
    });

    it('should not mutate original array', () => {
      const original = [
        make_announcement({ id: '2', deadline: '2026-06-01' }),
        make_announcement({ id: '1', deadline: '2026-04-01' }),
      ];
      const sorted = sort_by_deadline(original);
      expect(original[0].id).toBe('2'); // Original unchanged
      expect(sorted[0].id).toBe('1');
    });
  });

  // ========================================
  // 8. Report Generator
  // ========================================

  describe('generate_scan_report', () => {
    it('should generate empty report when no announcements match', () => {
      const report = generate_scan_report([], DEFAULT_FILTER, new Date('2026-03-22'));
      expect(report.announcements).toHaveLength(0);
      expect(report.summary).toContain('조건에 맞는 공고가 없습니다');
    });

    it('should include region and area info in summary', () => {
      const ann = make_announcement();
      const report = generate_scan_report([ann], DEFAULT_FILTER, new Date('2026-03-22'));
      expect(report.summary).toContain('서울');
      expect(report.summary).toContain('테스트 아파트');
      expect(report.summary).toContain('59m2');
    });

    it('should include deadline in report', () => {
      const ann = make_announcement({ deadline: '2026-04-15' });
      const report = generate_scan_report([ann], DEFAULT_FILTER, new Date('2026-03-22'));
      expect(report.summary).toContain('2026-04-15');
    });

    it('should include notes when present', () => {
      const ann = make_announcement({ notes: '특별공급 가능' });
      const report = generate_scan_report([ann], DEFAULT_FILTER, new Date('2026-03-22'));
      expect(report.summary).toContain('특별공급 가능');
    });

    it('should have generated_at timestamp', () => {
      const report = generate_scan_report([], DEFAULT_FILTER);
      expect(report.generated_at).toBeTruthy();
      expect(() => new Date(report.generated_at)).not.toThrow();
    });
  });

  // ========================================
  // 9. Hunter Prompt Generator
  // ========================================

  describe('generate_hunter_prompt', () => {
    it('should include applyhome.co.kr URL', () => {
      const prompt = generate_hunter_prompt();
      expect(prompt).toContain('applyhome.co.kr');
    });

    it('should mention minimum area', () => {
      const prompt = generate_hunter_prompt();
      expect(prompt).toContain('50m2');
    });

    it('should mention 무주택 condition', () => {
      const prompt = generate_hunter_prompt();
      expect(prompt).toContain('무주택');
    });

    it('should include capital region names', () => {
      const prompt = generate_hunter_prompt();
      expect(prompt).toContain('서울');
      expect(prompt).toContain('경기');
      expect(prompt).toContain('인천');
    });

    it('should include output format specification', () => {
      const prompt = generate_hunter_prompt();
      expect(prompt).toContain('단지명');
      expect(prompt).toContain('마감일');
    });
  });
});
