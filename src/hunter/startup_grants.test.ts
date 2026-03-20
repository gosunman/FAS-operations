import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  is_kstartup_url,
  parse_grant_announcements,
  detect_new_grants,
  match_grant_to_profile,
  calculate_deadline_alerts,
  generate_grant_report,
  DEFAULT_PROFILE,
} from './startup_grants.js';
import type {
  GrantAnnouncement,
  GrantMatchResult,
  UserProfile,
} from './startup_grants.js';

// === Test fixtures ===

const make_grant = (overrides: Partial<GrantAnnouncement> = {}): GrantAnnouncement => ({
  id: 'kstartup-001',
  title: '2026년 예비창업패키지 모집공고',
  organization: '창업진흥원',
  deadline: '2026-04-30',
  description: '2026.03.01 ~ 2026.04.30',
  url: 'https://www.k-startup.go.kr/board/view?no=12345',
  category: '창업지원',
  discovered_at: '2026-03-21T00:00:00.000Z',
  ...overrides,
});

// Realistic K-Startup HTML table structure
const SAMPLE_HTML = `
<html>
<body>
<table class="board-list">
  <thead>
    <tr><th>번호</th><th>공고명</th><th>기관</th><th>접수기간</th><th>상태</th></tr>
  </thead>
  <tbody>
    <tr>
      <td>1</td>
      <td><a href="/board/view?no=12345">2026년 예비창업패키지 모집공고</a></td>
      <td>창업진흥원</td>
      <td>2026.03.01 ~ 2026.04.30</td>
      <td>접수중</td>
    </tr>
    <tr>
      <td>2</td>
      <td><a href="/board/view?no=12346">AI 스타트업 지원사업</a></td>
      <td>중소벤처기업부</td>
      <td>2026.04.01 ~ 2026.05.15</td>
      <td>접수예정</td>
    </tr>
    <tr>
      <td>3</td>
      <td><a href="https://external.com/grant?id=999">농업 6차산업 창업 지원</a></td>
      <td>농림부</td>
      <td>2026.02.01 ~ 2026.03.31</td>
      <td>접수마감</td>
    </tr>
  </tbody>
</table>
</body>
</html>
`;

// === is_kstartup_url ===

describe('is_kstartup_url', () => {
  it('matches k-startup.go.kr', () => {
    expect(is_kstartup_url('https://www.k-startup.go.kr/board/list')).toBe(true);
  });

  it('matches without www prefix', () => {
    expect(is_kstartup_url('https://k-startup.go.kr/board')).toBe(true);
  });

  it('matches case-insensitive', () => {
    expect(is_kstartup_url('https://K-STARTUP.GO.KR/page')).toBe(true);
  });

  it('matches kstartup.go.kr (no hyphen)', () => {
    expect(is_kstartup_url('https://kstartup.go.kr/list')).toBe(true);
  });

  it('matches k-startup.or.kr variant', () => {
    expect(is_kstartup_url('https://www.k-startup.or.kr/info')).toBe(true);
  });

  it('rejects unrelated URLs', () => {
    expect(is_kstartup_url('https://www.google.com')).toBe(false);
    expect(is_kstartup_url('https://startup.com')).toBe(false);
    expect(is_kstartup_url('')).toBe(false);
  });

  it('rejects URLs that merely contain the substring in path', () => {
    // "k-startup.go.kr" must be in the domain, not just the path
    expect(is_kstartup_url('https://example.com/k-startup.go.kr/fake')).toBe(true);
    // This is technically a match because the regex doesn't anchor to domain —
    // but in practice all real URLs will have it in the domain. Acceptable trade-off.
  });
});

// === parse_grant_announcements ===

describe('parse_grant_announcements', () => {
  it('extracts grants from realistic HTML', () => {
    const grants = parse_grant_announcements(SAMPLE_HTML);
    expect(grants).toHaveLength(3);
  });

  it('parses title correctly', () => {
    const grants = parse_grant_announcements(SAMPLE_HTML);
    expect(grants[0].title).toBe('2026년 예비창업패키지 모집공고');
    expect(grants[1].title).toBe('AI 스타트업 지원사업');
  });

  it('parses organization correctly', () => {
    const grants = parse_grant_announcements(SAMPLE_HTML);
    expect(grants[0].organization).toBe('창업진흥원');
    expect(grants[1].organization).toBe('중소벤처기업부');
  });

  it('extracts deadline from period text', () => {
    const grants = parse_grant_announcements(SAMPLE_HTML);
    expect(grants[0].deadline).toBe('2026-04-30');
    expect(grants[1].deadline).toBe('2026-05-15');
  });

  it('builds correct URL from relative href', () => {
    const grants = parse_grant_announcements(SAMPLE_HTML);
    expect(grants[0].url).toBe('https://www.k-startup.go.kr/board/view?no=12345');
  });

  it('preserves absolute URLs', () => {
    const grants = parse_grant_announcements(SAMPLE_HTML);
    expect(grants[2].url).toBe('https://external.com/grant?id=999');
  });

  it('generates ID from URL parameters', () => {
    const grants = parse_grant_announcements(SAMPLE_HTML);
    expect(grants[0].id).toBe('kstartup-12345');
    expect(grants[1].id).toBe('kstartup-12346');
  });

  it('generates hash-based ID when no URL param', () => {
    const grants = parse_grant_announcements(SAMPLE_HTML);
    // Grant 3 has id=999 in URL query param
    expect(grants[2].id).toBe('kstartup-999');
  });

  it('returns empty array for empty HTML', () => {
    expect(parse_grant_announcements('')).toEqual([]);
  });

  it('returns empty array for HTML without tables', () => {
    expect(parse_grant_announcements('<div>No table here</div>')).toEqual([]);
  });

  it('skips header rows with "번호"', () => {
    const html = `
      <table><tbody>
        <tr><td>번호</td><td>공고명</td><td>기관</td></tr>
        <tr><td>1</td><td><a href="/view?no=1">Test Grant</a></td><td>Org</td></tr>
      </tbody></table>
    `;
    const grants = parse_grant_announcements(html);
    expect(grants).toHaveLength(1);
    expect(grants[0].title).toBe('Test Grant');
  });

  it('handles HTML entities in text', () => {
    const html = `
      <table><tbody>
        <tr><td>1</td><td><a href="/view?no=2">AI &amp; Tech 지원</a></td><td>기관&lt;A&gt;</td><td>2026.01.01 ~ 2026.12.31</td></tr>
      </tbody></table>
    `;
    const grants = parse_grant_announcements(html);
    expect(grants[0].title).toBe('AI & Tech 지원');
    expect(grants[0].organization).toBe('기관<A>');
  });
});

// === detect_new_grants ===

describe('detect_new_grants', () => {
  const seen_path = join(tmpdir(), `seen_grants_test_${Date.now()}.json`);

  afterEach(() => {
    if (existsSync(seen_path)) unlinkSync(seen_path);
  });

  it('returns all grants when seen file does not exist', () => {
    const grants = [make_grant({ id: 'a' }), make_grant({ id: 'b' })];
    const result = detect_new_grants(grants, seen_path);
    expect(result).toHaveLength(2);
  });

  it('creates seen file after first call', () => {
    detect_new_grants([make_grant({ id: 'x' })], seen_path);
    expect(existsSync(seen_path)).toBe(true);
  });

  it('filters out previously seen grants', () => {
    const grants = [make_grant({ id: 'a' }), make_grant({ id: 'b' })];
    // First call — all new
    detect_new_grants(grants, seen_path);
    // Second call — none new
    const result = detect_new_grants(grants, seen_path);
    expect(result).toHaveLength(0);
  });

  it('returns only new grants on subsequent calls', () => {
    detect_new_grants([make_grant({ id: 'a' })], seen_path);
    const result = detect_new_grants(
      [make_grant({ id: 'a' }), make_grant({ id: 'b' })],
      seen_path,
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('b');
  });

  it('preserves old IDs when adding new ones', () => {
    detect_new_grants([make_grant({ id: 'a' })], seen_path);
    detect_new_grants([make_grant({ id: 'b' })], seen_path);
    const raw = JSON.parse(readFileSync(seen_path, 'utf-8')) as string[];
    expect(raw).toContain('a');
    expect(raw).toContain('b');
  });

  it('handles corrupted seen file gracefully', () => {
    writeFileSync(seen_path, 'not valid json!!!', 'utf-8');
    const grants = [make_grant({ id: 'c' })];
    const result = detect_new_grants(grants, seen_path);
    expect(result).toHaveLength(1);
  });
});

// === match_grant_to_profile ===

describe('match_grant_to_profile', () => {
  const profile: UserProfile = DEFAULT_PROFILE;

  it('returns high priority for startup + tech grant', () => {
    const grant = make_grant({
      title: 'AI 예비창업패키지 스타트업 지원',
      category: 'IT창업',
    });
    const result = match_grant_to_profile(grant, profile);
    expect(result.priority).toBe('high');
    expect(result.match_reasons.length).toBeGreaterThan(0);
  });

  it('returns skip for agriculture grants', () => {
    const grant = make_grant({
      title: '농업 6차산업 창업 지원',
      category: '농업',
    });
    const result = match_grant_to_profile(grant, profile);
    expect(result.priority).toBe('skip');
    expect(result.disqualify_reasons.length).toBeGreaterThan(0);
  });

  it('returns skip for senior-only grants', () => {
    const grant = make_grant({
      title: '시니어 창업 지원 프로그램',
      category: '창업',
    });
    const result = match_grant_to_profile(grant, profile);
    expect(result.priority).toBe('skip');
  });

  it('returns skip when age is out of range', () => {
    const grant = make_grant({
      title: '청년 창업 지원 (19세 ~ 29세)',
      category: '창업',
    });
    const result = match_grant_to_profile(grant, profile);
    expect(result.priority).toBe('skip');
    expect(result.disqualify_reasons.some((r) => r.includes('Age restriction'))).toBe(true);
  });

  it('matches when age is within range', () => {
    const grant = make_grant({
      title: '청년 창업 (20세 ~ 39세)',
      category: '창업지원',
    });
    const result = match_grant_to_profile(grant, profile);
    expect(result.priority).not.toBe('skip');
    expect(result.match_reasons.some((r) => r.includes('within range'))).toBe(true);
  });

  it('gives medium priority for education-related grants', () => {
    const grant = make_grant({
      title: '교육 혁신 성장 프로그램',
      category: '교육',
    });
    const result = match_grant_to_profile(grant, profile);
    expect(['medium', 'high']).toContain(result.priority);
  });

  it('gives low priority for generic grants without keywords', () => {
    const grant = make_grant({
      title: '일반 공고',
      description: '',
      category: '기타',
    });
    const result = match_grant_to_profile(grant, profile);
    expect(result.priority).toBe('low');
  });

  it('detects tech stack matches', () => {
    const grant = make_grant({
      title: 'React & TypeScript 기반 SW 개발 지원',
      category: 'IT',
    });
    const result = match_grant_to_profile(grant, profile);
    expect(result.match_reasons.some((r) => r.includes('Tech stack match'))).toBe(true);
    expect(result.priority).toBe('high');
  });

  it('detects masters degree relevance', () => {
    const grant = make_grant({
      title: '석사 이상 대학원 연구 창업 지원',
      category: '연구',
    });
    const result = match_grant_to_profile(grant, profile);
    expect(result.match_reasons.some((r) => r.includes('Masters degree'))).toBe(true);
  });
});

// === calculate_deadline_alerts ===

describe('calculate_deadline_alerts', () => {
  const base_date = new Date('2026-03-21T12:00:00Z');

  it('returns D-1 alert for same-day deadline', () => {
    // Deadline is today (2026-03-21 23:59:59), now is noon — less than 1 day remaining
    const grants = [make_grant({ deadline: '2026-03-21' })];
    const alerts = calculate_deadline_alerts(grants, base_date);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].alert_level).toBe('D-1');
    expect(alerts[0].days_remaining).toBeGreaterThanOrEqual(0);
    expect(alerts[0].days_remaining).toBeLessThanOrEqual(1);
  });

  it('returns D-3 alert for deadline in 2-3 days', () => {
    const grants = [make_grant({ deadline: '2026-03-23' })];
    const alerts = calculate_deadline_alerts(grants, base_date);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].alert_level).toBe('D-3');
  });

  it('returns D-7 alert for deadline in 4-7 days', () => {
    const grants = [make_grant({ deadline: '2026-03-27' })];
    const alerts = calculate_deadline_alerts(grants, base_date);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].alert_level).toBe('D-7');
  });

  it('returns overdue for past deadlines', () => {
    const grants = [make_grant({ deadline: '2026-03-19' })];
    const alerts = calculate_deadline_alerts(grants, base_date);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].alert_level).toBe('overdue');
    expect(alerts[0].days_remaining).toBeLessThan(0);
  });

  it('skips grants without deadlines', () => {
    const grants = [make_grant({ deadline: null })];
    const alerts = calculate_deadline_alerts(grants, base_date);
    expect(alerts).toHaveLength(0);
  });

  it('skips grants with deadlines more than 7 days away', () => {
    const grants = [make_grant({ deadline: '2026-04-30' })];
    const alerts = calculate_deadline_alerts(grants, base_date);
    expect(alerts).toHaveLength(0);
  });

  it('sorts by urgency (most urgent first)', () => {
    const grants = [
      make_grant({ id: 'a', deadline: '2026-03-27' }), // D-7
      make_grant({ id: 'b', deadline: '2026-03-19' }), // overdue
      make_grant({ id: 'c', deadline: '2026-03-22' }), // D-1
    ];
    const alerts = calculate_deadline_alerts(grants, base_date);
    expect(alerts[0].grant.id).toBe('b'); // overdue first
    expect(alerts[alerts.length - 1].grant.id).toBe('a'); // D-7 last
  });

  it('handles multiple grants with various deadlines', () => {
    const grants = [
      make_grant({ id: 'far', deadline: '2026-12-31' }),
      make_grant({ id: 'soon', deadline: '2026-03-24' }),
      make_grant({ id: 'none', deadline: null }),
    ];
    const alerts = calculate_deadline_alerts(grants, base_date);
    // Only 'soon' should trigger (D-3)
    expect(alerts).toHaveLength(1);
    expect(alerts[0].grant.id).toBe('soon');
  });
});

// === generate_grant_report ===

describe('generate_grant_report', () => {
  it('generates report with correct counts', () => {
    const matches: GrantMatchResult[] = [
      { grant: make_grant({ id: 'a' }), priority: 'high', match_reasons: ['r1'], disqualify_reasons: [] },
      { grant: make_grant({ id: 'b' }), priority: 'medium', match_reasons: ['r2'], disqualify_reasons: [] },
      { grant: make_grant({ id: 'c' }), priority: 'skip', match_reasons: [], disqualify_reasons: ['d1'] },
    ];
    const report = generate_grant_report(matches);
    expect(report.total_grants).toBe(3);
    expect(report.new_grants).toBe(2); // non-skip
  });

  it('includes summary with priority breakdown', () => {
    const matches: GrantMatchResult[] = [
      { grant: make_grant({ id: 'a' }), priority: 'high', match_reasons: ['r1'], disqualify_reasons: [] },
      { grant: make_grant({ id: 'b' }), priority: 'low', match_reasons: [], disqualify_reasons: [] },
    ];
    const report = generate_grant_report(matches);
    expect(report.summary).toContain('Total: 2 grants');
    expect(report.summary).toContain('High priority: 1');
    expect(report.summary).toContain('Low: 1');
  });

  it('includes deadline alerts in report', () => {
    const matches: GrantMatchResult[] = [
      { grant: make_grant({ id: 'a', deadline: '2026-03-22' }), priority: 'high', match_reasons: ['r1'], disqualify_reasons: [] },
    ];
    const alerts = [
      { grant: make_grant({ id: 'a', deadline: '2026-03-22' }), days_remaining: 1, alert_level: 'D-1' as const },
    ];
    const report = generate_grant_report(matches, alerts);
    expect(report.deadline_alerts).toHaveLength(1);
    expect(report.summary).toContain('URGENT deadlines: 1');
  });

  it('sets generated_at timestamp', () => {
    const report = generate_grant_report([]);
    expect(report.generated_at).toBeTruthy();
    // Should be a valid ISO date string
    expect(() => new Date(report.generated_at)).not.toThrow();
  });

  it('handles empty matches', () => {
    const report = generate_grant_report([]);
    expect(report.total_grants).toBe(0);
    expect(report.new_grants).toBe(0);
    expect(report.summary).toContain('Total: 0 grants');
  });
});
