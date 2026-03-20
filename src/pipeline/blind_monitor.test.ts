import { describe, it, expect } from 'vitest';
import {
  parse_blind_results,
  categorize_post,
  detect_keywords,
  format_alert,
  process_blind_results,
  DEFAULT_BLIND_MONITOR_CONFIG,
} from './blind_monitor.js';
import type { BlindPost, BlindMonitorConfig, FormattedAlert } from './blind_monitor.js';

// ============================================================
// Test data fixtures
// ============================================================

const VALID_POST_JSON = JSON.stringify([
  {
    title: '네이버 구조조정 소문 진짜인가요?',
    url: 'https://blind.com/post/123',
    comment_count: 80,
    like_count: 150,
    summary: '네이버 내부에서 구조조정 이야기가 돌고 있다는 소문',
  },
  {
    title: '연봉 인상률 확정',
    url: 'https://blind.com/post/456',
    comment_count: 35,
    like_count: 60,
    summary: '올해 연봉 인상률이 확정되었다는 글',
  },
  {
    title: '오늘 점심 뭐먹지',
    url: 'https://blind.com/post/789',
    comment_count: 5,
    like_count: 3,
    summary: '점심 메뉴 추천 요청',
  },
]);

const MARKDOWN_WRAPPED_JSON = `
Here are the results I found:

\`\`\`json
${VALID_POST_JSON}
\`\`\`

Let me know if you need anything else.
`;

const PARTIAL_POST_JSON = JSON.stringify([
  {
    title: '인사평가 불만',
    comment_count: 60,
    like_count: 200,
    // missing url, summary
  },
  {
    title: '',
    url: 'https://blind.com/post/999',
    comment_count: 'not-a-number',
    like_count: null,
    summary: '잘못된 데이터',
  },
]);

const HTML_POST_JSON = JSON.stringify([
  {
    title: '<b>네이버</b> 레이오프 &amp; 대량해고 논란',
    url: 'https://blind.com/post/111',
    comment_count: '120',
    like_count: '300',
    summary: '<p>레이오프 관련 <a href="#">상세 내용</a></p>',
  },
]);

// ============================================================
// parse_blind_results
// ============================================================

describe('parse_blind_results', () => {
  it('Given valid JSON array, When parsing, Then returns all posts with correct fields', () => {
    const posts = parse_blind_results(VALID_POST_JSON);

    expect(posts).toHaveLength(3);
    expect(posts[0].title).toBe('네이버 구조조정 소문 진짜인가요?');
    expect(posts[0].url).toBe('https://blind.com/post/123');
    expect(posts[0].comment_count).toBe(80);
    expect(posts[0].like_count).toBe(150);
    expect(posts[0].summary).toBe('네이버 내부에서 구조조정 이야기가 돌고 있다는 소문');
  });

  it('Given empty string, When parsing, Then returns empty array', () => {
    const posts = parse_blind_results('');
    expect(posts).toEqual([]);
  });

  it('Given null/undefined-like input, When parsing, Then returns empty array', () => {
    const posts = parse_blind_results(null as unknown as string);
    expect(posts).toEqual([]);
  });

  it('Given completely invalid text, When parsing, Then returns empty array', () => {
    const posts = parse_blind_results('This is not JSON at all, just plain text response');
    expect(posts).toEqual([]);
  });

  it('Given JSON wrapped in markdown code fences, When parsing, Then extracts and parses correctly', () => {
    const posts = parse_blind_results(MARKDOWN_WRAPPED_JSON);
    expect(posts).toHaveLength(3);
    expect(posts[0].title).toBe('네이버 구조조정 소문 진짜인가요?');
  });

  it('Given partial data with missing fields, When parsing, Then fills defaults for missing fields', () => {
    const posts = parse_blind_results(PARTIAL_POST_JSON);

    // First post: has title and counts, missing url and summary
    expect(posts.length).toBeGreaterThanOrEqual(1);
    expect(posts[0].title).toBe('인사평가 불만');
    expect(posts[0].url).toBeUndefined();
    expect(posts[0].summary).toBe('');
    expect(posts[0].comment_count).toBe(60);
    expect(posts[0].like_count).toBe(200);
  });

  it('Given invalid number fields, When parsing, Then coerces to 0', () => {
    const posts = parse_blind_results(PARTIAL_POST_JSON);

    // Second post has invalid numbers and empty title — should be filtered out
    // or have numbers coerced to 0
    const invalid_post = posts.find((p) => p.url === 'https://blind.com/post/999');
    if (invalid_post) {
      expect(invalid_post.comment_count).toBe(0);
      expect(invalid_post.like_count).toBe(0);
    }
  });

  it('Given posts with empty title, When parsing, Then filters them out', () => {
    const posts = parse_blind_results(PARTIAL_POST_JSON);
    const empty_title_posts = posts.filter((p) => p.title === '');
    expect(empty_title_posts).toHaveLength(0);
  });

  it('Given HTML in fields, When parsing, Then strips HTML tags and decodes entities', () => {
    const posts = parse_blind_results(HTML_POST_JSON);

    expect(posts).toHaveLength(1);
    expect(posts[0].title).toBe('네이버 레이오프 & 대량해고 논란');
    expect(posts[0].summary).not.toContain('<p>');
    expect(posts[0].summary).not.toContain('<a');
    expect(posts[0].summary).not.toContain('</a>');
  });

  it('Given string numbers, When parsing, Then converts to actual numbers', () => {
    const posts = parse_blind_results(HTML_POST_JSON);

    expect(posts[0].comment_count).toBe(120);
    expect(posts[0].like_count).toBe(300);
  });

  it('Given a JSON object (not array), When parsing, Then handles gracefully', () => {
    const single_post = JSON.stringify({
      title: '단일 포스트',
      comment_count: 10,
      like_count: 20,
      summary: '테스트',
    });
    const posts = parse_blind_results(single_post);
    // Should wrap single object in array or return empty
    expect(Array.isArray(posts)).toBe(true);
  });

  it('Given JSON with extra unknown fields, When parsing, Then ignores extra fields', () => {
    const extra_fields = JSON.stringify([
      {
        title: '테스트 포스트',
        url: 'https://blind.com/test',
        comment_count: 10,
        like_count: 20,
        summary: '테스트',
        unknown_field: 'should be ignored',
        another: 123,
      },
    ]);
    const posts = parse_blind_results(extra_fields);
    expect(posts).toHaveLength(1);
    expect(posts[0].title).toBe('테스트 포스트');
    // The type should not include unknown fields
    expect((posts[0] as Record<string, unknown>)['unknown_field']).toBeUndefined();
  });
});

// ============================================================
// categorize_post
// ============================================================

describe('categorize_post', () => {
  const default_config = DEFAULT_BLIND_MONITOR_CONFIG;

  it('Given comments >= 50, When categorizing, Then returns hot', () => {
    const post = { title: 'test', comment_count: 50, like_count: 0, summary: '' };
    expect(categorize_post(post, default_config)).toBe('hot');
  });

  it('Given likes >= 100, When categorizing, Then returns hot', () => {
    const post = { title: 'test', comment_count: 0, like_count: 100, summary: '' };
    expect(categorize_post(post, default_config)).toBe('hot');
  });

  it('Given comments >= 50 AND likes >= 100, When categorizing, Then returns hot', () => {
    const post = { title: 'test', comment_count: 80, like_count: 200, summary: '' };
    expect(categorize_post(post, default_config)).toBe('hot');
  });

  it('Given comments >= 30 AND likes >= 50 (but not hot), When categorizing, Then returns trending', () => {
    const post = { title: 'test', comment_count: 35, like_count: 60, summary: '' };
    expect(categorize_post(post, default_config)).toBe('trending');
  });

  it('Given low counts, When categorizing, Then returns normal', () => {
    const post = { title: 'test', comment_count: 5, like_count: 3, summary: '' };
    expect(categorize_post(post, default_config)).toBe('normal');
  });

  it('Given comments >= 30 but likes < 50, When categorizing, Then returns normal (trending requires both)', () => {
    const post = { title: 'test', comment_count: 40, like_count: 30, summary: '' };
    expect(categorize_post(post, default_config)).toBe('normal');
  });

  it('Given custom thresholds, When categorizing, Then uses custom values', () => {
    const custom: BlindMonitorConfig = {
      hot_comment_threshold: 10,
      hot_like_threshold: 20,
      trending_comment_threshold: 5,
      trending_like_threshold: 10,
    };
    const post = { title: 'test', comment_count: 12, like_count: 5, summary: '' };
    expect(categorize_post(post, custom)).toBe('hot'); // comments >= 10
  });
});

// ============================================================
// detect_keywords
// ============================================================

describe('detect_keywords', () => {
  it('Given title with 구조조정, When detecting, Then returns keyword match', () => {
    const result = detect_keywords('네이버 구조조정 소문', '');
    expect(result).toContain('구조조정');
  });

  it('Given summary with 연봉, When detecting, Then returns keyword match', () => {
    const result = detect_keywords('일반 제목', '연봉 인상률 관련 내용');
    expect(result).toContain('연봉');
  });

  it('Given title with multiple keywords, When detecting, Then returns all matches', () => {
    const result = detect_keywords('구조조정으로 인한 대량해고 폭로', '');
    expect(result).toContain('구조조정');
    expect(result).toContain('대량해고');
    expect(result).toContain('폭로');
  });

  it('Given no keywords in text, When detecting, Then returns empty array', () => {
    const result = detect_keywords('오늘 점심 뭐먹지', '점심 메뉴 추천 요청');
    expect(result).toHaveLength(0);
  });

  it('Given custom additional keywords, When detecting, Then includes them', () => {
    const result = detect_keywords('네이버 사내 식당 변경', '', ['식당', '복리후생']);
    expect(result).toContain('식당');
  });

  it('Given keywords appearing in both title and summary, When detecting, Then deduplicates', () => {
    const result = detect_keywords('구조조정 이야기', '구조조정 관련 소문');
    const count = result.filter((k) => k === '구조조정').length;
    expect(count).toBe(1);
  });
});

// ============================================================
// format_alert
// ============================================================

describe('format_alert', () => {
  it('Given a hot post, When formatting, Then includes fire emoji and high severity', () => {
    const post: BlindPost = {
      title: '네이버 구조조정 확정',
      url: 'https://blind.com/post/123',
      comment_count: 80,
      like_count: 200,
      summary: '구조조정이 확정되었다는 내부 소식',
      keywords_matched: ['구조조정'],
      category: 'hot',
    };
    const alert = format_alert(post);

    expect(alert.severity).toBe('high');
    expect(alert.text).toContain('🔥');
    expect(alert.text).toContain('네이버 구조조정 확정');
    expect(alert.text).toContain('https://blind.com/post/123');
    expect(alert.text).toContain('구조조정');
    expect(alert.post).toBe(post);
  });

  it('Given a trending post, When formatting, Then includes chart emoji and medium severity', () => {
    const post: BlindPost = {
      title: '연봉 인상률 확정',
      url: 'https://blind.com/post/456',
      comment_count: 35,
      like_count: 60,
      summary: '올해 연봉 인상률이 확정',
      keywords_matched: ['연봉'],
      category: 'trending',
    };
    const alert = format_alert(post);

    expect(alert.severity).toBe('medium');
    expect(alert.text).toContain('📈');
  });

  it('Given a post without URL, When formatting, Then omits link line', () => {
    const post: BlindPost = {
      title: '테스트 포스트',
      comment_count: 100,
      like_count: 200,
      summary: '테스트',
      keywords_matched: [],
      category: 'hot',
    };
    const alert = format_alert(post);

    expect(alert.text).not.toContain('undefined');
    expect(alert.text).toContain('테스트 포스트');
  });

  it('Given a long summary, When formatting, Then truncates with ellipsis', () => {
    const long_summary = '가'.repeat(300);
    const post: BlindPost = {
      title: '긴 요약 포스트',
      comment_count: 100,
      like_count: 200,
      summary: long_summary,
      keywords_matched: [],
      category: 'hot',
    };
    const alert = format_alert(post);

    // Should be truncated
    expect(alert.text.length).toBeLessThan(long_summary.length + 200);
    expect(alert.text).toContain('...');
  });

  it('Given keywords matched, When formatting, Then includes keyword tags', () => {
    const post: BlindPost = {
      title: '구조조정 연봉 이야기',
      comment_count: 60,
      like_count: 150,
      summary: '테스트',
      keywords_matched: ['구조조정', '연봉'],
      category: 'hot',
    };
    const alert = format_alert(post);

    expect(alert.text).toContain('#구조조정');
    expect(alert.text).toContain('#연봉');
  });

  it('Given no keywords matched, When formatting, Then omits keyword section', () => {
    const post: BlindPost = {
      title: '일반 포스트',
      comment_count: 100,
      like_count: 200,
      summary: '일반 내용',
      keywords_matched: [],
      category: 'hot',
    };
    const alert = format_alert(post);

    // Should not have empty keyword section
    expect(alert.text).not.toContain('#');
  });
});

// ============================================================
// process_blind_results (integration)
// ============================================================

describe('process_blind_results', () => {
  it('Given valid posts with mixed categories, When processing, Then filters and categorizes correctly', () => {
    const result = process_blind_results(VALID_POST_JSON);

    // Post 1: 80 comments, 150 likes → hot
    // Post 2: 35 comments, 60 likes → trending
    // Post 3: 5 comments, 3 likes → normal (filtered out)
    expect(result.stats.total).toBe(3);
    expect(result.stats.hot).toBe(1);
    expect(result.stats.trending).toBe(1);
    expect(result.stats.filtered_out).toBe(1);
    expect(result.alerts).toHaveLength(2);
  });

  it('Given empty input, When processing, Then returns zero stats and empty alerts', () => {
    const result = process_blind_results('');

    expect(result.alerts).toHaveLength(0);
    expect(result.stats.total).toBe(0);
    expect(result.stats.hot).toBe(0);
    expect(result.stats.trending).toBe(0);
    expect(result.stats.filtered_out).toBe(0);
  });

  it('Given malformed input, When processing, Then returns zero stats gracefully', () => {
    const result = process_blind_results('not json at all');

    expect(result.alerts).toHaveLength(0);
    expect(result.stats.total).toBe(0);
  });

  it('Given custom config, When processing, Then uses custom thresholds', () => {
    const config: BlindMonitorConfig = {
      hot_comment_threshold: 5,
      hot_like_threshold: 5,
      trending_comment_threshold: 2,
      trending_like_threshold: 2,
    };
    const result = process_blind_results(VALID_POST_JSON, config);

    // All 3 posts should now qualify (even the low-count one has 5 comments, 3 likes)
    // Post 3: 5 comments >= 5 → hot
    expect(result.stats.hot).toBe(3); // all hot with these thresholds
    expect(result.stats.filtered_out).toBe(0);
  });

  it('Given posts with keywords, When processing, Then keywords are detected in alerts', () => {
    const result = process_blind_results(VALID_POST_JSON);

    // Post 1 contains "구조조정" in title
    const hot_alert = result.alerts.find((a) => a.post.category === 'hot');
    expect(hot_alert).toBeDefined();
    expect(hot_alert!.post.keywords_matched).toContain('구조조정');
  });

  it('Given alerts, When processing, Then sorts by severity (high first)', () => {
    const result = process_blind_results(VALID_POST_JSON);

    if (result.alerts.length >= 2) {
      const severities = result.alerts.map((a) => a.severity);
      const severity_order = { high: 0, medium: 1, low: 2 };
      for (let i = 1; i < severities.length; i++) {
        expect(severity_order[severities[i]]).toBeGreaterThanOrEqual(
          severity_order[severities[i - 1]],
        );
      }
    }
  });

  it('Given markdown-wrapped JSON, When processing, Then extracts and processes correctly', () => {
    const result = process_blind_results(MARKDOWN_WRAPPED_JSON);

    expect(result.stats.total).toBe(3);
    expect(result.alerts.length).toBeGreaterThan(0);
  });

  it('Given HTML-containing posts, When processing, Then strips HTML in alerts', () => {
    const result = process_blind_results(HTML_POST_JSON);

    expect(result.stats.total).toBe(1);
    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0].post.title).not.toContain('<b>');
    expect(result.alerts[0].post.title).toContain('네이버');
  });

  it('Given config with additional keywords, When processing, Then detects custom keywords', () => {
    const posts_json = JSON.stringify([
      {
        title: '네이버 사내 식당 폐쇄',
        comment_count: 60,
        like_count: 120,
        summary: '사내 식당이 폐쇄된다고 합니다',
      },
    ]);
    const config: BlindMonitorConfig = {
      keywords: ['식당', '폐쇄'],
    };
    const result = process_blind_results(posts_json, config);

    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0].post.keywords_matched).toContain('식당');
  });
});
