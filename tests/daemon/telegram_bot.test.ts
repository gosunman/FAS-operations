// TDD tests for standalone Telegram bot daemon (natural language mode)
// This bot runs independently of Claude Code (Captain),
// allowing the owner to send tasks to Hunter via natural language messages.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { create_telegram_bot, infer_action, type TelegramBotConfig, type BotSanitizer } from '../../src/daemon/telegram_bot.js';

// === Mock fetch globally ===
const mock_fetch = vi.fn();
vi.stubGlobal('fetch', mock_fetch);

// === Mock TaskStore factory ===
const create_mock_store = () => {
  let task_counter = 0;
  const tasks: Record<string, {
    id: string;
    title: string;
    status: string;
    assigned_to: string;
    action?: string;
    description?: string;
    completed_at?: string;
    output?: { summary: string; files_created: string[] };
  }> = {};

  return {
    create: vi.fn((params: Record<string, unknown>) => {
      task_counter++;
      const id = `test-task-${task_counter}`;
      const task = {
        id,
        title: params.title as string,
        description: params.description as string | undefined,
        action: params.action as string | undefined,
        assigned_to: params.assigned_to as string,
        priority: params.priority ?? 'medium',
        mode: 'awake',
        risk_level: params.risk_level ?? 'low',
        requires_personal_info: false,
        status: 'pending',
        created_at: new Date().toISOString(),
        deadline: null,
        depends_on: [],
      };
      tasks[id] = task;
      return task;
    }),
    get_by_id: vi.fn((id: string) => tasks[id] ?? null),
    get_by_status: vi.fn((_status: string) => Object.values(tasks).filter((t) => t.status === _status)),
    get_stats: vi.fn(() => ({ pending: 3, in_progress: 1, done: 5, blocked: 0, quarantined: 0 })),
    block_task: vi.fn((_id: string, _reason: string) => {
      if (tasks[_id]) {
        tasks[_id].status = 'blocked';
        return true;
      }
      return false;
    }),
    complete_task: vi.fn((_id: string, output: { summary: string; files_created?: string[] }) => {
      if (tasks[_id]) {
        tasks[_id].status = 'done';
        tasks[_id].completed_at = new Date().toISOString();
        tasks[_id].output = { summary: output.summary, files_created: output.files_created ?? [] };
        return true;
      }
      return false;
    }),
    get_pending_for_agent: vi.fn(() => []),
    update_status: vi.fn(() => true),
    quarantine_task: vi.fn(() => true),
    get_all: vi.fn(() => []),
    get_stale_in_progress: vi.fn(() => []),
    run_in_transaction: vi.fn((fn: () => unknown) => fn()),
    close: vi.fn(),
    _db: {} as unknown,
  };
};

// Helper: mock successful sendMessage response
const mock_send_ok = () => {
  mock_fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ ok: true, result: { message_id: 1 } }),
    text: async () => '{}',
  });
};

// Helper: get the last sendMessage call body
const get_sent_text = (call_index = 0): string => {
  const body = JSON.parse(mock_fetch.mock.calls[call_index][1].body);
  return body.text;
};

describe('telegram_bot (daemon)', () => {
  const config: TelegramBotConfig = {
    bot_token: 'test-bot-token',
    owner_chat_id: '12345',
    poll_interval_ms: 100,
  };

  let store: ReturnType<typeof create_mock_store>;
  let bot: ReturnType<typeof create_telegram_bot>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = create_mock_store();
    bot = create_telegram_bot(config, store as unknown as Parameters<typeof create_telegram_bot>[1]);
  });

  afterEach(() => {
    bot.stop();
  });

  // === Security ===

  describe('security: owner-only access', () => {
    it('should reject messages from unauthorized chat IDs', async () => {
      await bot._handle_message('hello', '99999');
      expect(store.create).not.toHaveBeenCalled();
      expect(mock_fetch).not.toHaveBeenCalled();
    });

    it('should accept messages from configured owner chat ID', async () => {
      mock_send_ok();
      await bot._handle_message('/status', '12345');
      expect(store.get_stats).toHaveBeenCalled();
    });

    it('should ignore empty or whitespace-only messages', async () => {
      await bot._handle_message('', '12345');
      await bot._handle_message('   ', '12345');
      expect(store.create).not.toHaveBeenCalled();
      expect(mock_fetch).not.toHaveBeenCalled();
    });
  });

  // === Action inference ===

  describe('infer_action', () => {
    it('should return web_crawl when URL is present', () => {
      expect(infer_action('https://example.com 이거 크롤링해줘')).toBe('web_crawl');
      expect(infer_action('http://naver.com/news')).toBe('web_crawl');
    });

    it('should return deep_research for research keywords', () => {
      expect(infer_action('AI 트렌드 2026 리서치해줘')).toBe('deep_research');
      expect(infer_action('부동산 시세 조사해줘')).toBe('deep_research');
      expect(infer_action('경쟁사 분석 좀')).toBe('deep_research');
      expect(infer_action('맛집 좀 찾아봐')).toBe('deep_research');
      expect(infer_action('research AI trends')).toBe('deep_research');
    });

    it('should return chatgpt_task as default', () => {
      expect(infer_action('블라인드 인기글 긁어와')).toBe('chatgpt_task');
      expect(infer_action('오늘 날씨 어때')).toBe('chatgpt_task');
    });

    it('should prioritize URL over research keywords', () => {
      // URL takes precedence even if research keywords are present
      expect(infer_action('https://example.com 이거 조사해줘')).toBe('web_crawl');
    });
  });

  // === Natural language → Hunter task ===

  describe('natural language task creation', () => {
    it('should create chatgpt_task for plain text', async () => {
      mock_send_ok();
      await bot._handle_message('블라인드 인기글 긁어와', '12345');
      expect(store.create).toHaveBeenCalledWith(
        expect.objectContaining({
          assigned_to: 'hunter',
          action: 'chatgpt_task',
          description: '블라인드 인기글 긁어와',
        }),
      );
    });

    it('should create web_crawl task when URL is present', async () => {
      mock_send_ok();
      await bot._handle_message('https://example.com 이거 봐줘', '12345');
      expect(store.create).toHaveBeenCalledWith(
        expect.objectContaining({
          assigned_to: 'hunter',
          action: 'web_crawl',
          description: 'https://example.com 이거 봐줘',
        }),
      );
    });

    it('should create deep_research task for research keywords', async () => {
      mock_send_ok();
      await bot._handle_message('AI 트렌드 2026 리서치해줘', '12345');
      expect(store.create).toHaveBeenCalledWith(
        expect.objectContaining({
          assigned_to: 'hunter',
          action: 'deep_research',
          description: 'AI 트렌드 2026 리서치해줘',
        }),
      );
    });

    it('should reply with confirmation including action type and task ID', async () => {
      mock_send_ok();
      await bot._handle_message('블라인드 인기글 긁어와', '12345');
      const text = get_sent_text();
      expect(text).toContain('헌터에게 전달');
      expect(text).toContain('chatgpt_task');
      expect(text).toContain('test-task-1');
    });

    it('should reply with web_crawl confirmation for URL messages', async () => {
      mock_send_ok();
      await bot._handle_message('https://example.com', '12345');
      const text = get_sent_text();
      expect(text).toContain('헌터에게 전달');
      expect(text).toContain('web_crawl');
    });

    it('should reply with deep_research confirmation for research messages', async () => {
      mock_send_ok();
      await bot._handle_message('경쟁사 분석해줘', '12345');
      const text = get_sent_text();
      expect(text).toContain('헌터에게 전달');
      expect(text).toContain('deep_research');
    });
  });

  // === Unknown slash commands → natural language fallback ===

  describe('unknown slash commands', () => {
    it('should treat unknown slash commands as natural language tasks', async () => {
      mock_send_ok();
      await bot._handle_message('/hunter 블라인드 인기글 긁어와', '12345');
      // Should create task (treated as natural language, not rejected)
      expect(store.create).toHaveBeenCalledWith(
        expect.objectContaining({
          assigned_to: 'hunter',
          action: 'chatgpt_task',
          description: '/hunter 블라인드 인기글 긁어와',
        }),
      );
    });
  });

  // === /status command ===

  describe('/status command', () => {
    it('should reply with task statistics', async () => {
      mock_send_ok();
      await bot._handle_message('/status', '12345');
      expect(store.get_stats).toHaveBeenCalled();
      const text = get_sent_text();
      expect(text).toContain('대기: 3');
      expect(text).toContain('진행중: 1');
      expect(text).toContain('완료: 5');
    });
  });

  // === /tasks command ===

  describe('/tasks command', () => {
    it('should reply with pending tasks list', async () => {
      store.create({ title: 'Task A', assigned_to: 'hunter' });
      store.create({ title: 'Task B', assigned_to: 'captain' });
      mock_send_ok();

      await bot._handle_message('/tasks', '12345');
      expect(store.get_by_status).toHaveBeenCalledWith('pending');
    });

    it('should show message when no pending tasks', async () => {
      store.get_by_status.mockReturnValueOnce([]);
      mock_send_ok();

      await bot._handle_message('/tasks', '12345');
      const text = get_sent_text();
      expect(text).toContain('대기중인 태스크가 없습니다');
    });
  });

  // === /cancel command ===

  describe('/cancel command', () => {
    it('should block an existing task', async () => {
      const task = store.create({ title: 'To cancel', assigned_to: 'hunter' });
      mock_send_ok();

      await bot._handle_message(`/cancel ${task.id}`, '12345');
      expect(store.block_task).toHaveBeenCalledWith(task.id, 'Cancelled by owner via Telegram');
    });

    it('should reply with error for non-existent task', async () => {
      store.get_by_id.mockReturnValueOnce(null);
      mock_send_ok();

      await bot._handle_message('/cancel nonexistent-id', '12345');
      const text = get_sent_text();
      expect(text).toContain('찾을 수 없습니다');
    });

    it('should require a task ID after /cancel', async () => {
      mock_send_ok();
      await bot._handle_message('/cancel', '12345');
      const text = get_sent_text();
      expect(text).toContain('task_id');
    });
  });

  // === Error handling ===

  describe('error handling', () => {
    it('should reply with error message when store.create throws', async () => {
      store.create.mockImplementationOnce(() => { throw new Error('DB error'); });
      mock_send_ok();

      await bot._handle_message('블라인드 인기글 긁어와', '12345');
      const text = get_sent_text();
      expect(text).toContain('오류');
    });
  });

  // === Polling lifecycle ===

  describe('start/stop lifecycle', () => {
    it('should set running state on start', () => {
      mock_fetch.mockImplementation(() => new Promise(() => {})); // hang forever
      bot.start();
      // Starting again should be a no-op
      bot.start();
      bot.stop();
    });

    it('should abort polling on stop', () => {
      mock_fetch.mockImplementation(() => new Promise(() => {}));
      bot.start();
      bot.stop();
      // Should not throw
    });
  });

  // === Result notification ===

  describe('notify_task_result', () => {
    it('should send notification when a task completes', async () => {
      mock_send_ok();
      await bot.notify_task_result('task-abc', '크롤링 완료', '블라인드 인기글 3건 수집 완료');
      const text = get_sent_text();
      expect(text).toContain('크롤링 완료');
      expect(text).toContain('블라인드 인기글 3건 수집 완료');
      expect(text).toContain('task-abc');
    });
  });

  // === send_message public API ===

  describe('send_message', () => {
    it('should send arbitrary text to the owner', async () => {
      mock_send_ok();
      await bot.send_message('테스트 메시지입니다');
      const body = JSON.parse(mock_fetch.mock.calls[0][1].body);
      expect(body.text).toBe('테스트 메시지입니다');
      expect(body.chat_id).toBe('12345');
    });
  });

  // === PII Sanitizer integration ===

  describe('PII sanitizer integration', () => {
    // Mock sanitizer that simulates real sanitizer behavior
    const create_mock_sanitizer = (): BotSanitizer => ({
      sanitize_text: vi.fn((text: string) => text.replace(/010-\d{4}-\d{4}/g, '[전화번호 제거됨]')),
      contains_critical_pii: vi.fn((_text: string) => false),
      detect_pii_with_severity: vi.fn((_text: string) => []),
    });

    it('should sanitize title and description before creating task (warning PII)', async () => {
      const sanitizer = create_mock_sanitizer();
      // Return warning-level detection
      (sanitizer.detect_pii_with_severity as ReturnType<typeof vi.fn>).mockReturnValue([
        { name: 'email', severity: 'warning' },
      ]);

      const bot_with_sanitizer = create_telegram_bot(
        config,
        store as unknown as Parameters<typeof create_telegram_bot>[1],
        sanitizer,
      );

      // Two sends: task confirmation + PII warning
      mock_send_ok();
      mock_send_ok();
      await bot_with_sanitizer._handle_message('user@example.com에 연락해줘', '12345');

      // sanitize_text should be called for title and description
      expect(sanitizer.sanitize_text).toHaveBeenCalled();
      // Task should be created (warning = auto-mask, not block)
      expect(store.create).toHaveBeenCalled();
      bot_with_sanitizer.stop();
    });

    it('should block task creation and warn owner when critical PII detected', async () => {
      const sanitizer = create_mock_sanitizer();
      (sanitizer.contains_critical_pii as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (sanitizer.detect_pii_with_severity as ReturnType<typeof vi.fn>).mockReturnValue([
        { name: 'resident_id', severity: 'critical' },
      ]);

      const bot_with_sanitizer = create_telegram_bot(
        config,
        store as unknown as Parameters<typeof create_telegram_bot>[1],
        sanitizer,
      );

      mock_send_ok();
      await bot_with_sanitizer._handle_message('주민번호 900101-1234567 알려줘', '12345');

      // Task should NOT be created
      expect(store.create).not.toHaveBeenCalled();
      // Warning message should be sent
      const text = get_sent_text();
      expect(text).toContain('개인정보');
      bot_with_sanitizer.stop();
    });

    it('should work without sanitizer (backward compatible)', async () => {
      // bot is created without sanitizer in beforeEach
      mock_send_ok();
      await bot._handle_message('주민번호 900101-1234567 알려줘', '12345');

      // Task should be created (no sanitizer = no filtering)
      expect(store.create).toHaveBeenCalled();
    });

    it('should notify owner about auto-masking when warning PII is found', async () => {
      const sanitizer = create_mock_sanitizer();
      (sanitizer.detect_pii_with_severity as ReturnType<typeof vi.fn>).mockReturnValue([
        { name: 'email', severity: 'warning' },
      ]);

      const bot_with_sanitizer = create_telegram_bot(
        config,
        store as unknown as Parameters<typeof create_telegram_bot>[1],
        sanitizer,
      );

      mock_send_ok(); // task confirmation
      mock_send_ok(); // pii warning
      await bot_with_sanitizer._handle_message('user@test.com 확인해줘', '12345');

      // Should have two sendMessage calls: confirmation + masking notice
      const calls = mock_fetch.mock.calls.filter((c: unknown[]) =>
        (c[0] as string).includes('sendMessage'),
      );
      expect(calls.length).toBe(2);

      // One of them should contain the masking notice
      const texts = calls.map((c: unknown[]) => JSON.parse((c[1] as { body: string }).body).text as string);
      expect(texts.some((t: string) => t.includes('마스킹'))).toBe(true);
      bot_with_sanitizer.stop();
    });
  });
});
