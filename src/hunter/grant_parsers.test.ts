// Tests for SBA, D.CAMP, MSS grant parsers and URL-based router.
// Uses inline HTML fixtures mimicking each site's real structure.

import { describe, it, expect } from 'vitest';
import {
  is_sba_url,
  is_dcamp_url,
  is_mss_url,
  parse_sba_grants,
  parse_dcamp_programs,
  parse_mss_grants,
  route_grant_parser,
} from './grant_parsers.js';

// === HTML Fixtures ===

// SBA table fixture — 5-column layout: No, Category, Title, Org, Period
const SBA_TABLE_HTML = `
<table>
  <thead>
    <tr><th>번호</th><th>분류</th><th>사업명</th><th>기관</th><th>접수기간</th></tr>
  </thead>
  <tbody>
    <tr>
      <td>1</td>
      <td>창업지원</td>
      <td><a href="/support/view?bbs_sn=12345">2026년 서울 예비창업패키지</a></td>
      <td>서울산업진흥원</td>
      <td>2026.03.01 ~ 2026.04.15</td>
    </tr>
    <tr>
      <td>2</td>
      <td>성장지원</td>
      <td><a href="/support/view?bbs_sn=12346">AI 스타트업 성장 프로그램</a></td>
      <td>SBA</td>
      <td>2026.02.15 ~ 2026.03.31</td>
    </tr>
  </tbody>
</table>
`;

// SBA 4-column layout: No, Title, Org, Period
const SBA_TABLE_4COL_HTML = `
<table>
  <tbody>
    <tr>
      <td>1</td>
      <td><a href="https://www.sba.seoul.kr/detail?id=999">소셜벤처 육성사업</a></td>
      <td>SBA</td>
      <td>2026.05.01 ~ 2026.06.30</td>
    </tr>
  </tbody>
</table>
`;

// D.CAMP card-based fixture
const DCAMP_CARD_HTML = `
<div class="program-card">
  <span class="badge category">액셀러레이팅</span>
  <h3><a href="/programs/123">D.CAMP 프론트원 5기 모집</a></h3>
  <span class="date">2026.04.01 ~ 2026.04.30</span>
</div>
<div class="event-card">
  <h3>디캠프 네트워킹 데이</h3>
  <span class="date">2026.05.15</span>
</div>
`;

// D.CAMP table-based fallback fixture
const DCAMP_TABLE_HTML = `
<table>
  <tbody>
    <tr>
      <td>1</td>
      <td><a href="/board/view?idx=456">스타트업 투자 IR 데모데이</a></td>
      <td>2026.06.01 ~ 2026.06.15</td>
    </tr>
  </tbody>
</table>
`;

// MSS table fixture — No, Title, Department, Period, Status
const MSS_TABLE_HTML = `
<table>
  <thead>
    <tr><th>번호</th><th>제목</th><th>담당부서</th><th>접수기간</th><th>상태</th></tr>
  </thead>
  <tbody>
    <tr>
      <td>1</td>
      <td><a href="/site/smba/ex/bbs/View.do?nttSn=10001">2026년 창업사업화 지원사업</a></td>
      <td>창업진흥과</td>
      <td>2026.03.10 ~ 2026.04.10</td>
      <td>접수중</td>
    </tr>
    <tr>
      <td>2</td>
      <td><a href="/site/smba/ex/bbs/View.do?nttSn=10002">소상공인 디지털 전환 지원</a></td>
      <td>소상공인과</td>
      <td>2026.02.01 ~ 2026.03.15</td>
      <td>마감</td>
    </tr>
  </tbody>
</table>
`;

// === URL matcher tests ===

describe('URL matchers', () => {
  it('is_sba_url matches sba.seoul.kr', () => {
    expect(is_sba_url('https://www.sba.seoul.kr/support/list')).toBe(true);
    expect(is_sba_url('https://sba.kr/programs')).toBe(true);
    expect(is_sba_url('https://dcamp.kr/')).toBe(false);
    expect(is_sba_url('https://google.com')).toBe(false);
  });

  it('is_dcamp_url matches dcamp.kr', () => {
    expect(is_dcamp_url('https://dcamp.kr/programs')).toBe(true);
    expect(is_dcamp_url('https://www.d-camp.kr/events')).toBe(true);
    expect(is_dcamp_url('https://sba.seoul.kr/')).toBe(false);
  });

  it('is_mss_url matches mss.go.kr', () => {
    expect(is_mss_url('https://www.mss.go.kr/site/smba/ex/bbs/List.do')).toBe(true);
    expect(is_mss_url('https://mss.go.kr/biz')).toBe(true);
    expect(is_mss_url('https://k-startup.go.kr/')).toBe(false);
  });
});

// === SBA Parser tests ===

describe('parse_sba_grants', () => {
  it('parses 5-column SBA table correctly', () => {
    const grants = parse_sba_grants(SBA_TABLE_HTML);
    expect(grants).toHaveLength(2);

    // First grant
    expect(grants[0].id).toBe('sba-12345');
    expect(grants[0].title).toBe('2026년 서울 예비창업패키지');
    expect(grants[0].organization).toBe('서울산업진흥원');
    expect(grants[0].deadline).toBe('2026-04-15');
    expect(grants[0].category).toBe('창업지원');
    expect(grants[0].url).toContain('sba.seoul.kr');

    // Second grant
    expect(grants[1].id).toBe('sba-12346');
    expect(grants[1].title).toBe('AI 스타트업 성장 프로그램');
    expect(grants[1].deadline).toBe('2026-03-31');
  });

  it('parses 4-column SBA table', () => {
    const grants = parse_sba_grants(SBA_TABLE_4COL_HTML);
    expect(grants).toHaveLength(1);
    expect(grants[0].title).toBe('소셜벤처 육성사업');
    expect(grants[0].url).toBe('https://www.sba.seoul.kr/detail?id=999');
    expect(grants[0].deadline).toBe('2026-06-30');
  });

  it('returns empty for empty HTML', () => {
    expect(parse_sba_grants('')).toEqual([]);
  });

  it('returns empty for HTML with no table', () => {
    expect(parse_sba_grants('<div>No grants here</div>')).toEqual([]);
  });
});

// === D.CAMP Parser tests ===

describe('parse_dcamp_programs', () => {
  it('parses card-based layout', () => {
    const grants = parse_dcamp_programs(DCAMP_CARD_HTML);
    expect(grants.length).toBeGreaterThanOrEqual(1);

    // First card — has link and heading
    const front_one = grants.find((g) => g.title.includes('프론트원'));
    expect(front_one).toBeDefined();
    expect(front_one!.id).toBe('dcamp-123');
    expect(front_one!.url).toContain('dcamp.kr/programs/123');
    expect(front_one!.organization).toBe('D.CAMP');
    expect(front_one!.deadline).toBe('2026-04-30');
  });

  it('falls back to table parsing when no cards found', () => {
    const grants = parse_dcamp_programs(DCAMP_TABLE_HTML);
    expect(grants).toHaveLength(1);
    expect(grants[0].title).toBe('스타트업 투자 IR 데모데이');
    expect(grants[0].organization).toBe('D.CAMP');
    expect(grants[0].deadline).toBe('2026-06-15');
  });

  it('returns empty for empty HTML', () => {
    expect(parse_dcamp_programs('')).toEqual([]);
  });
});

// === MSS Parser tests ===

describe('parse_mss_grants', () => {
  it('parses MSS table correctly', () => {
    const grants = parse_mss_grants(MSS_TABLE_HTML);
    expect(grants).toHaveLength(2);

    // First grant
    expect(grants[0].id).toBe('mss-10001');
    expect(grants[0].title).toBe('2026년 창업사업화 지원사업');
    expect(grants[0].organization).toBe('창업진흥과');
    expect(grants[0].deadline).toBe('2026-04-10');
    expect(grants[0].url).toContain('mss.go.kr');
    // First cell is '1' (numeric) so category should be empty
    expect(grants[0].category).toBe('');

    // Second grant
    expect(grants[1].id).toBe('mss-10002');
    expect(grants[1].title).toBe('소상공인 디지털 전환 지원');
    expect(grants[1].deadline).toBe('2026-03-15');
  });

  it('returns empty for empty HTML', () => {
    expect(parse_mss_grants('')).toEqual([]);
  });

  it('handles malformed rows gracefully', () => {
    const malformed = `
      <table>
        <tr><td>Only one cell</td></tr>
        <tr><td></td><td></td></tr>
        <tr><td>x</td><td>  </td><td>org</td></tr>
      </table>
    `;
    // Should not crash, may return 0 or skip empty titles
    const grants = parse_mss_grants(malformed);
    // All rows either have <2 cells or empty title — expect 0
    expect(grants).toEqual([]);
  });
});

// === Route Grant Parser tests ===

describe('route_grant_parser', () => {
  it('routes SBA URLs to SBA parser', () => {
    const grants = route_grant_parser('https://www.sba.seoul.kr/support/list', SBA_TABLE_HTML);
    expect(grants).toHaveLength(2);
    expect(grants[0].id).toMatch(/^sba-/);
  });

  it('routes D.CAMP URLs to D.CAMP parser', () => {
    const grants = route_grant_parser('https://dcamp.kr/programs', DCAMP_CARD_HTML);
    expect(grants.length).toBeGreaterThanOrEqual(1);
    expect(grants[0].id).toMatch(/^dcamp-/);
  });

  it('routes MSS URLs to MSS parser', () => {
    const grants = route_grant_parser('https://www.mss.go.kr/site/smba/ex/bbs/List.do', MSS_TABLE_HTML);
    expect(grants).toHaveLength(2);
    expect(grants[0].id).toMatch(/^mss-/);
  });

  it('returns empty for unrecognized URLs', () => {
    const grants = route_grant_parser('https://google.com', '<html></html>');
    expect(grants).toEqual([]);
  });

  it('returns empty for empty HTML on valid URL', () => {
    expect(route_grant_parser('https://www.sba.seoul.kr/list', '')).toEqual([]);
    expect(route_grant_parser('https://dcamp.kr/', '')).toEqual([]);
    expect(route_grant_parser('https://mss.go.kr/', '')).toEqual([]);
  });
});

// === Resilience tests ===

describe('resilience', () => {
  it('handles HTML with only header rows', () => {
    const header_only = `
      <table>
        <tr><th>번호</th><th>제목</th><th>기관</th></tr>
      </table>
    `;
    expect(parse_sba_grants(header_only)).toEqual([]);
    expect(parse_mss_grants(header_only)).toEqual([]);
  });

  it('handles deeply nested HTML without crashing', () => {
    const nested = '<div>'.repeat(50) + '<table><tr><td>1</td><td>Test</td><td>Org</td></tr></table>' + '</div>'.repeat(50);
    // Should parse the table row even when deeply nested
    const grants = parse_sba_grants(nested);
    expect(grants).toHaveLength(1);
    expect(grants[0].title).toBe('Test');
  });

  it('handles HTML entities in grant titles', () => {
    const html = `
      <table><tbody>
        <tr>
          <td>1</td>
          <td><a href="/view?id=100">AI &amp; IoT 창업지원 &lt;2026&gt;</a></td>
          <td>SBA</td>
          <td>2026.01.01 ~ 2026.12.31</td>
        </tr>
      </tbody></table>
    `;
    const grants = parse_sba_grants(html);
    expect(grants).toHaveLength(1);
    expect(grants[0].title).toBe('AI & IoT 창업지원 <2026>');
  });

  it('all parsers return GrantAnnouncement with required fields', () => {
    const sba = parse_sba_grants(SBA_TABLE_HTML);
    const dcamp = parse_dcamp_programs(DCAMP_CARD_HTML);
    const mss = parse_mss_grants(MSS_TABLE_HTML);

    const all_grants = [...sba, ...dcamp, ...mss];
    for (const g of all_grants) {
      expect(g).toHaveProperty('id');
      expect(g).toHaveProperty('title');
      expect(g).toHaveProperty('organization');
      expect(g).toHaveProperty('deadline');
      expect(g).toHaveProperty('description');
      expect(g).toHaveProperty('url');
      expect(g).toHaveProperty('category');
      expect(g).toHaveProperty('discovered_at');
      // ID prefix check
      expect(g.id).toMatch(/^(sba|dcamp|mss)-/);
    }
  });
});
