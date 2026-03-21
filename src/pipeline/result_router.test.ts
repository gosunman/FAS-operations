// Result Router tests — verifies task result dispatch to appropriate handlers

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create_result_router, match_handler, detect_high_value, type TaskInfo } from './result_router.js';
import type { NotificationRouter } from '../notification/router.js';
import type { ResearchStore } from '../captain/research_store.js';
import type { SmartEscalator } from '../notification/smart_escalation.js';

// === Helpers ===

const make_mock_router = (): NotificationRouter => ({
  route: vi.fn().mockResolvedValue(undefined),
  get_queue_sizes: vi.fn().mockReturnValue({ telegram: 0, slack: 0, notion: 0 }),
  stop: vi.fn(),
});

const make_mock_research_store = (): ResearchStore => ({
  save_research: vi.fn().mockReturnValue({ id: 'test', topic: 't', query: 'q', result_text: '', source: 's', created_at: '', tags: [] }),
  list_research: vi.fn().mockReturnValue([]),
  get_research: vi.fn().mockReturnValue(null),
  get_index: vi.fn().mockReturnValue({ version: 1, entries: [], updated_at: '' }),
  cleanup_old_research: vi.fn().mockReturnValue({ deleted_count: 0, deleted_dirs: [] }),
});

const make_task = (title: string, overrides?: Partial<TaskInfo>): TaskInfo => ({
  id: 'task-001',
  title,
  ...overrides,
});

// === match_handler tests ===

describe('match_handler', () => {
  it('matches grant tasks', () => {
    expect(match_handler('창업지원사업 신규 공고 수집')).toBe('grant');
  });

  it('matches housing tasks', () => {
    expect(match_handler('청약홈 로또 청약 심층 필터링')).toBe('housing');
  });

  it('matches blind naver tasks', () => {
    expect(match_handler('블라인드 네이버 인기글 모니터링')).toBe('blind');
  });

  it('matches blind NVC tasks', () => {
    expect(match_handler('블라인드 NVC 수요 검증 모니터링')).toBe('blind_nvc');
  });

  it('matches AI trend tasks', () => {
    expect(match_handler('AI 트렌드 리서치')).toBe('ai_trends');
  });

  it('matches bigtech job tasks', () => {
    expect(match_handler('글로벌 빅테크 원격 커리어 스캐닝')).toBe('bigtech_jobs');
  });

  it('matches edutech competitor tasks', () => {
    expect(match_handler('에듀테크 경쟁사 딥 리서치')).toBe('edutech_competitors');
  });

  it('matches grad school tasks', () => {
    expect(match_handler('대학원 지원 일정 체크')).toBe('grad_school');
    expect(match_handler('OMSCS deadline')).toBe('grad_school');
    expect(match_handler('GSEP Spring 2027')).toBe('grad_school');
  });

  it('matches lighthouse tasks', () => {
    expect(match_handler('Lighthouse SEO audit')).toBe('lighthouse');
  });

  it('matches B2B intent tasks', () => {
    expect(match_handler('글로벌 B2B 타겟 인텐트 크롤링 및 Clay 적재')).toBe('b2b_intent');
  });

  it('matches deep research tasks', () => {
    expect(match_handler('Deep Research: Local LLM deployment')).toBe('deep_research');
    expect(match_handler('딥리서치: NVC 시장 분석')).toBe('deep_research');
  });

  it('returns generic for unknown tasks', () => {
    expect(match_handler('Some random task')).toBe('generic');
  });
});

// === create_result_router tests ===

describe('create_result_router', () => {
  let mock_router: NotificationRouter;
  let mock_research_store: ResearchStore;

  beforeEach(() => {
    mock_router = make_mock_router();
    mock_research_store = make_mock_research_store();
  });

  describe('route — blind handler', () => {
    it('processes blind naver results with hot posts', async () => {
      const result_router = create_result_router({ router: mock_router });
      // Simulate ChatGPT output with post data
      const output = JSON.stringify([
        { title: '네이버 구조조정 확정', url: 'https://blind.com/1', comment_count: 80, like_count: 200, summary: '대규모 구조조정' },
      ]);
      const task = make_task('블라인드 네이버 인기글 모니터링');

      const result = await result_router.route(task, output);

      expect(result.handled).toBe(true);
      expect(result.handler).toBe('blind');
    });

    it('handles blind results with no hot/trending posts silently', async () => {
      const result_router = create_result_router({ router: mock_router });
      const output = 'No trending posts found today.';
      const task = make_task('블라인드 네이버 인기글 모니터링');

      const result = await result_router.route(task, output);

      expect(result.handled).toBe(true);
      expect(result.handler).toBe('blind');
      // No notification sent when no alerts
      expect(mock_router.route).not.toHaveBeenCalled();
    });
  });

  describe('route — ai_trends handler', () => {
    it('routes AI trend results to Notion + Slack', async () => {
      const result_router = create_result_router({ router: mock_router });
      const output = '## HN Top Stories\n1. New LLM breakthrough\n2. Local AI deployment';
      const task = make_task('AI 트렌드 리서치');

      const result = await result_router.route(task, output);

      expect(result.handled).toBe(true);
      expect(result.handler).toBe('ai_trends');
      expect(mock_router.route).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'crawl_result',
          message: expect.stringContaining('AI Trend Research'),
        }),
      );
    });
  });

  describe('route — bigtech_jobs handler', () => {
    it('routes bigtech job results with header', async () => {
      const result_router = create_result_router({ router: mock_router });
      const output = 'Google: Senior SWE, Remote Korea | Meta: Staff Engineer';
      const task = make_task('글로벌 빅테크 원격 커리어 스캐닝');

      const result = await result_router.route(task, output);

      expect(result.handled).toBe(true);
      expect(result.handler).toBe('bigtech_jobs');
      expect(mock_router.route).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Bigtech Career Scan'),
        }),
      );
    });
  });

  describe('route — deep_research handler', () => {
    it('saves to research store and notifies', async () => {
      const result_router = create_result_router({
        router: mock_router,
        research_store: mock_research_store,
      });
      const output = 'Deep analysis of local LLM deployment trends...';
      const task = make_task('Deep Research: Local LLM', { id: 'dr-001', description: 'Research local LLM deployment' });

      const result = await result_router.route(task, output);

      expect(result.handled).toBe(true);
      expect(result.handler).toBe('deep_research');
      expect(mock_research_store.save_research).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'dr-001',
          source: 'gemini_deep_research',
          tags: ['deep_research', 'auto'],
        }),
      );
      expect(mock_router.route).toHaveBeenCalled();
    });

    it('works without research store', async () => {
      const result_router = create_result_router({ router: mock_router });
      const task = make_task('Deep Research: test');

      const result = await result_router.route(task, 'some result');

      expect(result.handled).toBe(true);
      expect(result.handler).toBe('deep_research');
    });
  });

  describe('route — generic fallback', () => {
    it('uses generic handler for unmatched tasks', async () => {
      const result_router = create_result_router({ router: mock_router });
      const task = make_task('Unknown custom task');
      const output = 'Task completed successfully';

      const result = await result_router.route(task, output);

      expect(result.handled).toBe(true);
      expect(result.handler).toBe('generic');
      expect(mock_router.route).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'crawl_result',
          message: expect.stringContaining('Unknown custom task'),
        }),
      );
    });
  });

  describe('route — error handling', () => {
    it('falls back to generic on handler error', async () => {
      // Force router to fail on first call then succeed on fallback
      const failing_router = make_mock_router();
      let call_count = 0;
      (failing_router.route as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        call_count++;
        if (call_count === 1) throw new Error('handler error');
        // second call (generic fallback) succeeds
      });

      const result_router = create_result_router({ router: failing_router });
      const task = make_task('AI 트렌드 리서치');

      const result = await result_router.route(task, 'some output');

      expect(result.handled).toBe(false);
      expect(result.error).toBe('handler error');
    });
  });

  describe('route — grant handler', () => {
    it('falls back to formatted result on parse error', async () => {
      const result_router = create_result_router({ router: mock_router });
      // Non-HTML output that grant parser can't handle
      const output = 'ChatGPT: Found 3 new grants matching your profile...';
      const task = make_task('창업지원사업 신규 공고 수집');

      const result = await result_router.route(task, output);

      // Should fall back to formatted result, not crash
      expect(result.handled).toBe(true);
      expect(mock_router.route).toHaveBeenCalled();
    });
  });

  describe('route — housing handler', () => {
    it('falls back to formatted result on parse error', async () => {
      const result_router = create_result_router({ router: mock_router });
      const output = 'ChatGPT: 강남 근처 신규 청약 2건 발견...';
      const task = make_task('청약홈 로또 청약 심층 필터링');

      const result = await result_router.route(task, output);

      expect(result.handled).toBe(true);
      expect(mock_router.route).toHaveBeenCalled();
    });
  });

  describe('route — grad_school handler', () => {
    it('routes grad school results with header', async () => {
      const result_router = create_result_router({ router: mock_router });
      const output = 'OMSCS Fall 2026: Application deadline May 1';
      const task = make_task('대학원 지원 일정 체크');

      const result = await result_router.route(task, output);

      expect(result.handled).toBe(true);
      expect(result.handler).toBe('grad_school');
      expect(mock_router.route).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Grad School Deadline'),
        }),
      );
    });
  });

  describe('route — escalation wiring', () => {
    const make_mock_escalator = (): SmartEscalator => ({
      escalate: vi.fn().mockResolvedValue(undefined),
      flush_morning_briefing: vi.fn().mockResolvedValue({ flushed_count: 0 }),
      get_queued_count: vi.fn().mockReturnValue(0),
      get_queued_items: vi.fn().mockReturnValue([]),
    });

    it('calls escalator for high-value grant results', async () => {
      const escalator = make_mock_escalator();
      const result_router = create_result_router({ router: mock_router, escalator });
      // Output containing "priority: high" triggers grant escalation
      const output = 'ChatGPT: priority: high — 예비창업패키지 2차 모집';
      const task = make_task('창업지원사업 신규 공고 수집');

      await result_router.route(task, output);

      // Wait for fire-and-forget escalation
      await new Promise((r) => setTimeout(r, 10));
      expect(escalator.escalate).toHaveBeenCalledWith(
        expect.stringContaining('Grant'),
        expect.any(String),
        'high',
      );
    });

    it('calls escalator for bigtech S-tier job results', async () => {
      const escalator = make_mock_escalator();
      const result_router = create_result_router({ router: mock_router, escalator });
      const output = 'Google Senior SWE Remote — brand_tier: S';
      const task = make_task('글로벌 빅테크 원격 커리어 스캐닝');

      await result_router.route(task, output);

      await new Promise((r) => setTimeout(r, 10));
      expect(escalator.escalate).toHaveBeenCalledWith(
        expect.stringContaining('Bigtech'),
        expect.any(String),
        'high',
      );
    });

    it('does NOT call escalator for low-value results', async () => {
      const escalator = make_mock_escalator();
      const result_router = create_result_router({ router: mock_router, escalator });
      const output = 'OMSCS Fall 2026: Application deadline May 1';
      const task = make_task('대학원 지원 일정 체크');

      await result_router.route(task, output);

      await new Promise((r) => setTimeout(r, 10));
      expect(escalator.escalate).not.toHaveBeenCalled();
    });

    it('works without escalator (backward compatible)', async () => {
      const result_router = create_result_router({ router: mock_router });
      const output = 'priority: high — grant found';
      const task = make_task('창업지원사업 신규 공고 수집');

      // Should not throw even with high-value output and no escalator
      const result = await result_router.route(task, output);
      expect(result.handled).toBe(true);
    });
  });
});

// === detect_high_value tests ===

describe('detect_high_value', () => {
  describe('grant handler', () => {
    it('detects high-priority grants', () => {
      expect(detect_high_value('grant', 'priority: high — 예비창업패키지')).not.toBeNull();
      expect(detect_high_value('grant', '우선순위: 높음')).not.toBeNull();
      expect(detect_high_value('grant', '긴급 공고 발견')).not.toBeNull();
    });

    it('returns null for normal grants', () => {
      expect(detect_high_value('grant', 'priority: low — 일반 공고')).toBeNull();
    });
  });

  describe('housing handler', () => {
    it('detects residence-priority housing', () => {
      expect(detect_high_value('housing', 'priority: residence — 강남 아파트')).not.toBeNull();
      expect(detect_high_value('housing', '거주용 우선')).not.toBeNull();
      expect(detect_high_value('housing', '강남 1시간 이내 매칭')).not.toBeNull();
    });

    it('returns null for investment-only housing', () => {
      expect(detect_high_value('housing', '수익형 — 지방 소형')).toBeNull();
    });
  });

  describe('blind handler', () => {
    it('detects hot posts by comment count', () => {
      expect(detect_high_value('blind', 'comment_count: 80')).not.toBeNull();
    });

    it('detects hot posts by like count', () => {
      expect(detect_high_value('blind', 'like_count: 150')).not.toBeNull();
    });

    it('detects hot category marker', () => {
      expect(detect_high_value('blind', 'category: hot — 대박 글')).not.toBeNull();
    });

    it('returns null for low-engagement posts', () => {
      expect(detect_high_value('blind', 'comment_count: 10, like_count: 20')).toBeNull();
    });
  });

  describe('bigtech_jobs handler', () => {
    it('detects S-tier brands', () => {
      expect(detect_high_value('bigtech_jobs', 'brand_tier: S — Google')).not.toBeNull();
    });

    it('detects A-tier brands', () => {
      expect(detect_high_value('bigtech_jobs', 'brand_tier: A — Netflix')).not.toBeNull();
    });

    it('detects by company name', () => {
      expect(detect_high_value('bigtech_jobs', 'Google Senior SWE Remote')).not.toBeNull();
      expect(detect_high_value('bigtech_jobs', 'OpenAI Research Engineer')).not.toBeNull();
    });

    it('returns null for unknown companies', () => {
      expect(detect_high_value('bigtech_jobs', 'SmallStartup: Junior Dev')).toBeNull();
    });
  });

  describe('ai_trends handler', () => {
    it('detects multiple keyword matches via matched_keywords array', () => {
      expect(detect_high_value('ai_trends', 'matched_keywords: [LLM, RAG, agent]')).not.toBeNull();
    });

    it('detects multiple keyword mentions in text', () => {
      expect(detect_high_value('ai_trends', 'New LLM and RAG breakthroughs')).not.toBeNull();
    });

    it('returns null for single keyword', () => {
      expect(detect_high_value('ai_trends', 'Some article about cooking')).toBeNull();
    });
  });

  describe('other handlers', () => {
    it('returns null for generic handler', () => {
      expect(detect_high_value('generic', 'anything')).toBeNull();
    });

    it('returns null for grad_school handler', () => {
      expect(detect_high_value('grad_school', 'OMSCS deadline')).toBeNull();
    });

    it('returns null for lighthouse handler', () => {
      expect(detect_high_value('lighthouse', 'score: 95')).toBeNull();
    });

    it('returns null for edutech_competitors handler', () => {
      expect(detect_high_value('edutech_competitors', 'competitor found')).toBeNull();
    });
  });
});
