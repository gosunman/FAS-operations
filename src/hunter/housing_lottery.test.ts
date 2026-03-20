import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  is_housing_url,
  parse_housing_announcements,
  detect_new_housing,
  match_housing_to_profile,
  generate_housing_report,
  DEFAULT_HOUSING_PROFILE,
  COMMUTE_FROM_GANGNAM,
} from './housing_lottery.js';
import type {
  HousingAnnouncement,
  HousingProfile,
  HousingMatchResult,
} from './housing_lottery.js';

// === Test fixtures ===

const make_announcement = (overrides: Partial<HousingAnnouncement> = {}): HousingAnnouncement => ({
  id: 'housing-001',
  title: '2026년 강남구 행복주택 입주자 모집공고',
  location: '강남',
  size_sqm: 59,
  price_estimate: '3억 5천만원',
  announcement_type: 'national',
  deadline: '2026-04-30',
  url: 'https://www.applyhome.co.kr/ai/aia/selectAPTLttotPblancDetail.do?houseManageNo=2026000001',
  discovered_at: '2026-03-21T00:00:00.000Z',
  ...overrides,
});

// Realistic 청약홈 HTML table structure
const SAMPLE_HTML = `
<html>
<body>
<table class="tbl_st tbl_center">
  <thead>
    <tr><th>번호</th><th>공고명</th><th>지역</th><th>공급규모</th><th>접수기간</th><th>상태</th></tr>
  </thead>
  <tbody>
    <tr>
      <td>1</td>
      <td><a href="/ai/aia/selectAPTLttotPblancDetail.do?houseManageNo=2026000001">강남구 행복주택 입주자 모집공고</a></td>
      <td>서울특별시 강남구</td>
      <td>59㎡</td>
      <td>2026.03.01 ~ 2026.04.30</td>
      <td>접수중</td>
    </tr>
    <tr>
      <td>2</td>
      <td><a href="/ai/aia/selectAPTLttotPblancDetail.do?houseManageNo=2026000002">송파구 신혼희망타운 특별공급</a></td>
      <td>서울특별시 송파구</td>
      <td>84㎡</td>
      <td>2026.04.01 ~ 2026.05.15</td>
      <td>접수예정</td>
    </tr>
    <tr>
      <td>3</td>
      <td><a href="/ai/aia/selectAPTLttotPblancDetail.do?houseManageNo=2026000003">수원시 영통구 공공분양</a></td>
      <td>경기도 수원시</td>
      <td>39㎡</td>
      <td>2026.02.01 ~ 2026.03.31</td>
      <td>접수마감</td>
    </tr>
    <tr>
      <td>4</td>
      <td><a href="/ai/aia/selectAPTLttotPblancDetail.do?houseManageNo=2026000004">부산 해운대구 국민임대</a></td>
      <td>부산광역시 해운대구</td>
      <td>74㎡</td>
      <td>2026.04.10 ~ 2026.05.20</td>
      <td>접수예정</td>
    </tr>
  </tbody>
</table>
</body>
</html>
`;

// === is_housing_url ===

describe('is_housing_url', () => {
  it('matches applyhome.co.kr', () => {
    expect(is_housing_url('https://www.applyhome.co.kr/ai/aia/selectAPTLttotPblancDetail.do')).toBe(true);
  });

  it('matches without www prefix', () => {
    expect(is_housing_url('https://applyhome.co.kr/board')).toBe(true);
  });

  it('matches case-insensitive', () => {
    expect(is_housing_url('https://WWW.APPLYHOME.CO.KR/page')).toBe(true);
  });

  it('rejects unrelated URLs', () => {
    expect(is_housing_url('https://www.google.com')).toBe(false);
    expect(is_housing_url('https://www.lh.or.kr')).toBe(false);
    expect(is_housing_url('')).toBe(false);
  });
});

// === parse_housing_announcements ===

describe('parse_housing_announcements', () => {
  it('extracts announcements from realistic HTML', () => {
    const announcements = parse_housing_announcements(SAMPLE_HTML);
    expect(announcements).toHaveLength(4);
  });

  it('parses title correctly', () => {
    const announcements = parse_housing_announcements(SAMPLE_HTML);
    expect(announcements[0].title).toBe('강남구 행복주택 입주자 모집공고');
    expect(announcements[1].title).toBe('송파구 신혼희망타운 특별공급');
  });

  it('parses location correctly', () => {
    const announcements = parse_housing_announcements(SAMPLE_HTML);
    expect(announcements[0].location).toBe('서울특별시 강남구');
    expect(announcements[2].location).toBe('경기도 수원시');
  });

  it('parses size from ㎡ format', () => {
    const announcements = parse_housing_announcements(SAMPLE_HTML);
    expect(announcements[0].size_sqm).toBe(59);
    expect(announcements[1].size_sqm).toBe(84);
    expect(announcements[2].size_sqm).toBe(39);
  });

  it('extracts deadline from period text', () => {
    const announcements = parse_housing_announcements(SAMPLE_HTML);
    expect(announcements[0].deadline).toBe('2026-04-30');
    expect(announcements[1].deadline).toBe('2026-05-15');
  });

  it('builds correct URL from relative href', () => {
    const announcements = parse_housing_announcements(SAMPLE_HTML);
    expect(announcements[0].url).toContain('applyhome.co.kr');
    expect(announcements[0].url).toContain('houseManageNo=2026000001');
  });

  it('generates ID from houseManageNo', () => {
    const announcements = parse_housing_announcements(SAMPLE_HTML);
    expect(announcements[0].id).toBe('housing-2026000001');
    expect(announcements[1].id).toBe('housing-2026000002');
  });

  it('detects announcement_type from title keywords', () => {
    const special_html = `
    <table><tbody>
      <tr><td>1</td><td><a href="/view?houseManageNo=1">특별공급 모집공고</a></td><td>서울 강남</td><td>59㎡</td><td>2026.03.01 ~ 2026.04.30</td><td>접수중</td></tr>
      <tr><td>2</td><td><a href="/view?houseManageNo=2">국민임대 모집공고</a></td><td>서울 서초</td><td>59㎡</td><td>2026.03.01 ~ 2026.04.30</td><td>접수중</td></tr>
      <tr><td>3</td><td><a href="/view?houseManageNo=3">일반분양 모집공고</a></td><td>경기 성남</td><td>59㎡</td><td>2026.03.01 ~ 2026.04.30</td><td>접수중</td></tr>
    </tbody></table>
    `;
    const announcements = parse_housing_announcements(special_html);
    expect(announcements[0].announcement_type).toBe('special');
    expect(announcements[1].announcement_type).toBe('national');
    expect(announcements[2].announcement_type).toBe('regional');
  });

  it('returns empty array for empty HTML', () => {
    expect(parse_housing_announcements('')).toEqual([]);
  });

  it('returns empty array for HTML without tables', () => {
    expect(parse_housing_announcements('<div>No table here</div>')).toEqual([]);
  });

  it('skips header rows with "번호"', () => {
    const html = `
      <table><tbody>
        <tr><td>번호</td><td>공고명</td><td>지역</td><td>규모</td><td>기간</td><td>상태</td></tr>
        <tr><td>1</td><td><a href="/view?houseManageNo=1">Test 공고</a></td><td>서울 강남</td><td>59㎡</td><td>2026.03.01 ~ 2026.04.30</td><td>접수중</td></tr>
      </tbody></table>
    `;
    const announcements = parse_housing_announcements(html);
    expect(announcements).toHaveLength(1);
    expect(announcements[0].title).toBe('Test 공고');
  });

  it('handles HTML entities in text', () => {
    const html = `
      <table><tbody>
        <tr><td>1</td><td><a href="/view?houseManageNo=5">A &amp; B 주택</a></td><td>서울&nbsp;강남</td><td>59㎡</td><td>2026.01.01 ~ 2026.12.31</td><td>접수중</td></tr>
      </tbody></table>
    `;
    const announcements = parse_housing_announcements(html);
    expect(announcements[0].title).toBe('A & B 주택');
  });
});

// === detect_new_housing ===

describe('detect_new_housing', () => {
  const seen_path = join(tmpdir(), `seen_housing_test_${Date.now()}.json`);

  afterEach(() => {
    if (existsSync(seen_path)) unlinkSync(seen_path);
  });

  it('returns all announcements when seen file does not exist', () => {
    const announcements = [make_announcement({ id: 'a' }), make_announcement({ id: 'b' })];
    const result = detect_new_housing(announcements, seen_path);
    expect(result).toHaveLength(2);
  });

  it('creates seen file after first call', () => {
    detect_new_housing([make_announcement({ id: 'x' })], seen_path);
    expect(existsSync(seen_path)).toBe(true);
  });

  it('filters out previously seen announcements', () => {
    const announcements = [make_announcement({ id: 'a' }), make_announcement({ id: 'b' })];
    detect_new_housing(announcements, seen_path);
    const result = detect_new_housing(announcements, seen_path);
    expect(result).toHaveLength(0);
  });

  it('returns only new announcements on subsequent calls', () => {
    detect_new_housing([make_announcement({ id: 'a' })], seen_path);
    const result = detect_new_housing(
      [make_announcement({ id: 'a' }), make_announcement({ id: 'b' })],
      seen_path,
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('b');
  });

  it('preserves old IDs when adding new ones', () => {
    detect_new_housing([make_announcement({ id: 'a' })], seen_path);
    detect_new_housing([make_announcement({ id: 'b' })], seen_path);
    const raw = JSON.parse(readFileSync(seen_path, 'utf-8')) as string[];
    expect(raw).toContain('a');
    expect(raw).toContain('b');
  });

  it('handles corrupted seen file gracefully', () => {
    writeFileSync(seen_path, 'not valid json!!!', 'utf-8');
    const announcements = [make_announcement({ id: 'c' })];
    const result = detect_new_housing(announcements, seen_path);
    expect(result).toHaveLength(1);
  });
});

// === match_housing_to_profile ===

describe('match_housing_to_profile', () => {
  const profile: HousingProfile = DEFAULT_HOUSING_PROFILE;

  it('returns residence for nearby + large enough apartment', () => {
    const announcement = make_announcement({
      location: '서울특별시 강남구',
      size_sqm: 59,
    });
    const result = match_housing_to_profile(announcement, profile);
    expect(result.priority).toBe('residence');
    expect(result.match_reasons.length).toBeGreaterThan(0);
  });

  it('returns investment for distant location with good size', () => {
    const announcement = make_announcement({
      location: '부산광역시 해운대구',
      size_sqm: 74,
    });
    const result = match_housing_to_profile(announcement, profile);
    expect(result.priority).toBe('investment');
    expect(result.match_reasons.some((r) => r.includes('investment'))).toBe(true);
  });

  it('returns skip for too small apartment', () => {
    const announcement = make_announcement({
      location: '서울특별시 강남구',
      size_sqm: 30,
    });
    const result = match_housing_to_profile(announcement, profile);
    // Small but nearby could still be investment
    // The key is that it shouldn't be 'residence' if under min_size_sqm
    expect(result.priority).not.toBe('residence');
  });

  it('returns residence for commutable location with adequate size', () => {
    const announcement = make_announcement({
      location: '서울특별시 송파구',
      size_sqm: 84,
    });
    const result = match_housing_to_profile(announcement, profile);
    expect(result.priority).toBe('residence');
    expect(result.match_reasons.some((r) => r.includes('commute'))).toBe(true);
  });

  it('handles unknown location gracefully', () => {
    const announcement = make_announcement({
      location: '세종특별자치시',
      size_sqm: 59,
    });
    const result = match_housing_to_profile(announcement, profile);
    // Unknown location = can't verify commute = investment or skip
    expect(['investment', 'skip']).toContain(result.priority);
  });

  it('considers homeless status as positive match reason', () => {
    const announcement = make_announcement({
      location: '서울특별시 서초구',
      size_sqm: 59,
    });
    const result = match_housing_to_profile(announcement, profile);
    expect(result.match_reasons.some((r) => r.includes('무주택'))).toBe(true);
  });

  it('marks non-homeless as disqualified for homeless-only', () => {
    const non_homeless_profile: HousingProfile = { ...profile, is_homeless: false };
    const announcement = make_announcement();
    const result = match_housing_to_profile(announcement, non_homeless_profile);
    expect(result.disqualify_reasons.some((r) => r.includes('무주택'))).toBe(true);
  });

  it('commute map has expected entries', () => {
    expect(COMMUTE_FROM_GANGNAM['강남']).toBe(0);
    expect(COMMUTE_FROM_GANGNAM['송파']).toBe(15);
    expect(COMMUTE_FROM_GANGNAM['수원']).toBe(55);
    expect(COMMUTE_FROM_GANGNAM['분당']).toBe(25);
  });
});

// === generate_housing_report ===

describe('generate_housing_report', () => {
  it('generates report with correct counts', () => {
    const matches: HousingMatchResult[] = [
      { announcement: make_announcement({ id: 'a' }), priority: 'residence', match_reasons: ['r1'], disqualify_reasons: [] },
      { announcement: make_announcement({ id: 'b' }), priority: 'investment', match_reasons: ['r2'], disqualify_reasons: [] },
      { announcement: make_announcement({ id: 'c' }), priority: 'skip', match_reasons: [], disqualify_reasons: ['d1'] },
    ];
    const report = generate_housing_report(matches);
    expect(report.total_announcements).toBe(3);
    expect(report.new_announcements).toBe(2); // non-skip
  });

  it('includes summary with priority breakdown', () => {
    const matches: HousingMatchResult[] = [
      { announcement: make_announcement({ id: 'a' }), priority: 'residence', match_reasons: ['r1'], disqualify_reasons: [] },
      { announcement: make_announcement({ id: 'b' }), priority: 'investment', match_reasons: ['r2'], disqualify_reasons: [] },
    ];
    const report = generate_housing_report(matches);
    expect(report.summary).toContain('Total: 2');
    expect(report.summary).toContain('Residence: 1');
    expect(report.summary).toContain('Investment: 1');
  });

  it('includes deadline alerts in report', () => {
    const matches: HousingMatchResult[] = [
      { announcement: make_announcement({ id: 'a', deadline: '2026-03-22' }), priority: 'residence', match_reasons: ['r1'], disqualify_reasons: [] },
    ];
    const report = generate_housing_report(matches, new Date('2026-03-21T12:00:00Z'));
    expect(report.deadline_alerts).toHaveLength(1);
    // 2026-03-22 23:59:59 - 2026-03-21 12:00:00 = ~36h, ceil = 2 days
    expect(report.deadline_alerts[0].days_remaining).toBeLessThanOrEqual(2);
    expect(report.deadline_alerts[0].alert_level).toBe('D-3');
  });

  it('sets generated_at timestamp', () => {
    const report = generate_housing_report([]);
    expect(report.generated_at).toBeTruthy();
    expect(() => new Date(report.generated_at)).not.toThrow();
  });

  it('handles empty matches', () => {
    const report = generate_housing_report([]);
    expect(report.total_announcements).toBe(0);
    expect(report.new_announcements).toBe(0);
    expect(report.summary).toContain('Total: 0');
  });

  it('calculates deadline alerts for D-3 and D-7', () => {
    const matches: HousingMatchResult[] = [
      { announcement: make_announcement({ id: 'a', deadline: '2026-03-24' }), priority: 'residence', match_reasons: ['r1'], disqualify_reasons: [] },
      { announcement: make_announcement({ id: 'b', deadline: '2026-03-27' }), priority: 'investment', match_reasons: ['r2'], disqualify_reasons: [] },
      { announcement: make_announcement({ id: 'c', deadline: '2026-04-30' }), priority: 'residence', match_reasons: ['r3'], disqualify_reasons: [] },
    ];
    const report = generate_housing_report(matches, new Date('2026-03-21T12:00:00Z'));
    // Only a (D-3) and b (D-7) should have alerts; c is too far out
    expect(report.deadline_alerts).toHaveLength(2);
  });

  it('skips deadline alerts for skip-priority matches', () => {
    const matches: HousingMatchResult[] = [
      { announcement: make_announcement({ id: 'a', deadline: '2026-03-22' }), priority: 'skip', match_reasons: [], disqualify_reasons: ['d1'] },
    ];
    const report = generate_housing_report(matches, new Date('2026-03-21T12:00:00Z'));
    expect(report.deadline_alerts).toHaveLength(0);
  });
});
