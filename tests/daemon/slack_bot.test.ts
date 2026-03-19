// TDD tests for Slack bot daemon
// Mirrors the Telegram bot pattern but uses Slack Web API polling
// with thread-based context management.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { create_slack_bot, type SlackBotConfig } from '../../src/daemon/slack_bot.js';
import type { BotSanitizer } from '../../src/daemon/telegram_bot.js';

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

// Helper: mock Slack API response for chat.postMessage
const mock_post_message_ok = (ts = '1234567890.123456') => {
  mock_fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ ok: true, ts, channel: 'C_TEST' }),
  });
};

// Helper: mock Slack API response for conversations.history
const mock_conversations_history = (messages: Array<{
  ts: string;
  text: string;
  user?: string;
  thread_ts?: string;
  bot_id?: string;
}>) => {
  mock_fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ ok: true, messages }),
  });
};

// Helper: extract body from fetch call
const get_fetch_body = (call_index = 0): Record<string, unknown> => {
  const call = mock_fetch.mock.calls[call_index];
  if (call[1]?.body) {
    return JSON.parse(call[1].body as string);
  }
  // URL search params
  const url = new URL(call[0] as string);
  const params: Record<string, unknown> = {};
  url.searchParams.forEach((v, k) => { params[k] = v; });
  return params;
};

// Helper: find the chat.postMessage call and return body
const find_post_message_body = (): Record<string, unknown> | null => {
  for (let i = 0; i < mock_fetch.mock.calls.length; i++) {
    const url = mock_fetch.mock.calls[i][0] as string;
    if (url.includes('chat.postMessage')) {
      return JSON.parse(mock_fetch.mock.calls[i][1].body as string);
    }
  }
  return null;
};

describe('slack_bot (daemon)', () => {
  const config: SlackBotConfig = {
    bot_token: 'xoxb-test-token',
    channel_id: 'C_TEST_CHANNEL',
    poll_interval_ms: 100,
  };

  let store: ReturnType<typeof create_mock_store>;
  let bot: ReturnType<typeof create_slack_bot>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = create_mock_store();
    bot = create_slack_bot(config, store as unknown as Parameters<typeof create_slack_bot>[1]);
  });

  afterEach(() => {
    bot.stop();
  });

  // === Message handling ===

  describe('message handling', () => {
    it('should ignore messages from bots (bot_id present)', async () => {
      await bot._handle_message({ text: 'hello', ts: '1.1', user: undefined, bot_id: 'B123' });
      expect(store.create).not.toHaveBeenCalled();
      expect(mock_fetch).not.toHaveBeenCalled();
    });

    it('should ignore empty messages', async () => {
      await bot._handle_message({ text: '', ts: '1.1', user: 'U123' });
      expect(store.create).not.toHaveBeenCalled();
      expect(mock_fetch).not.toHaveBeenCalled();
    });

    it('should ignore thread replies (messages with thread_ts different from ts)', async () => {
      await bot._handle_message({ text: 'reply', ts: '2.2', thread_ts: '1.1', user: 'U123' });
      expect(store.create).not.toHaveBeenCalled();
      expect(mock_fetch).not.toHaveBeenCalled();
    });
  });

  // === Natural language task creation ===

  describe('natural language task creation', () => {
    it('should create chatgpt_task for plain text', async () => {
      mock_post_message_ok();
      await bot._handle_message({ text: '블라인드 인기글 긁어와', ts: '1.1', user: 'U123' });
      expect(store.create).toHaveBeenCalledWith(
        expect.objectContaining({
          assigned_to: 'hunter',
          action: 'chatgpt_task',
          description: '블라인드 인기글 긁어와',
        }),
      );
    });

    it('should create web_crawl task when URL is present', async () => {
      mock_post_message_ok();
      await bot._handle_message({ text: 'https://example.com 이거 봐줘', ts: '1.2', user: 'U123' });
      expect(store.create).toHaveBeenCalledWith(
        expect.objectContaining({
          assigned_to: 'hunter',
          action: 'web_crawl',
        }),
      );
    });

    it('should create deep_research task for research keywords', async () => {
      mock_post_message_ok();
      await bot._handle_message({ text: 'AI 트렌드 2026 리서치해줘', ts: '1.3', user: 'U123' });
      expect(store.create).toHaveBeenCalledWith(
        expect.objectContaining({
          assigned_to: 'hunter',
          action: 'deep_research',
        }),
      );
    });

    it('should reply in thread with confirmation including action type and task ID', async () => {
      mock_post_message_ok();
      await bot._handle_message({ text: '블라인드 인기글 긁어와', ts: '1.4', user: 'U123' });
      const body = find_post_message_body();
      expect(body).not.toBeNull();
      expect(body!.thread_ts).toBe('1.4');
      expect(body!.channel).toBe('C_TEST_CHANNEL');
      expect(body!.text).toContain('chatgpt_task');
      expect(body!.text).toContain('test-task-1');
    });
  });

  // === Thread mapping (task_id <-> slack thread_ts) ===

  describe('thread mapping', () => {
    it('should store thread_ts mapping when creating task', async () => {
      mock_post_message_ok();
      await bot._handle_message({ text: '블라인드 인기글 긁어와', ts: '1.5', user: 'U123' });
      const task_id = (store.create.mock.results[0].value as { id: string }).id;
      // Internal mapping should exist
      expect(bot._get_thread_ts(task_id)).toBe('1.5');
    });

    it('should find task_id by thread_ts', async () => {
      mock_post_message_ok();
      await bot._handle_message({ text: '블라인드 인기글 긁어와', ts: '1.6', user: 'U123' });
      const task_id = (store.create.mock.results[0].value as { id: string }).id;
      expect(bot._get_task_id('1.6')).toBe(task_id);
    });
  });

  // === Utility keyword commands ===

  describe('utility keyword commands', () => {
    it('should handle "상태" keyword', async () => {
      mock_post_message_ok();
      await bot._handle_message({ text: '상태', ts: '2.1', user: 'U123' });
      expect(store.get_stats).toHaveBeenCalled();
      const body = find_post_message_body();
      expect(body!.text).toContain('대기: 3');
      expect(body!.text).toContain('진행중: 1');
    });

    it('should handle "status" keyword', async () => {
      mock_post_message_ok();
      await bot._handle_message({ text: 'status', ts: '2.2', user: 'U123' });
      expect(store.get_stats).toHaveBeenCalled();
    });

    it('should handle "목록" keyword', async () => {
      store.get_by_status.mockReturnValueOnce([]);
      mock_post_message_ok();
      await bot._handle_message({ text: '목록', ts: '2.3', user: 'U123' });
      expect(store.get_by_status).toHaveBeenCalledWith('pending');
    });

    it('should handle "tasks" keyword', async () => {
      store.get_by_status.mockReturnValueOnce([]);
      mock_post_message_ok();
      await bot._handle_message({ text: 'tasks', ts: '2.4', user: 'U123' });
      expect(store.get_by_status).toHaveBeenCalledWith('pending');
    });

    it('should handle "취소 <id>" keyword', async () => {
      const task = store.create({ title: 'To cancel', assigned_to: 'hunter' });
      mock_post_message_ok();
      await bot._handle_message({ text: `취소 ${task.id}`, ts: '2.5', user: 'U123' });
      expect(store.block_task).toHaveBeenCalledWith(task.id, 'Cancelled by owner via Slack');
    });

    it('should handle "cancel <id>" keyword', async () => {
      const task = store.create({ title: 'To cancel', assigned_to: 'hunter' });
      mock_post_message_ok();
      await bot._handle_message({ text: `cancel ${task.id}`, ts: '2.6', user: 'U123' });
      expect(store.block_task).toHaveBeenCalledWith(task.id, 'Cancelled by owner via Slack');
    });

    it('should show error for cancel without task ID', async () => {
      mock_post_message_ok();
      await bot._handle_message({ text: '취소', ts: '2.7', user: 'U123' });
      const body = find_post_message_body();
      expect(body!.text).toContain('task_id');
    });

    it('should show error for cancel with non-existent task ID', async () => {
      store.get_by_id.mockReturnValueOnce(null);
      mock_post_message_ok();
      await bot._handle_message({ text: '취소 nonexistent-id', ts: '2.8', user: 'U123' });
      const body = find_post_message_body();
      expect(body!.text).toContain('찾을 수 없습니다');
    });
  });

  // === Result notification via thread ===

  describe('notify_task_result (thread-based)', () => {
    it('should reply in the original thread when task completes', async () => {
      // First, create a task via message
      mock_post_message_ok();
      await bot._handle_message({ text: '크롤링해줘', ts: '3.1', user: 'U123' });
      const task_id = (store.create.mock.results[0].value as { id: string }).id;

      // Now notify result
      vi.clearAllMocks();
      mock_post_message_ok();
      await bot.notify_task_result(task_id, '크롤링 완료', '블라인드 인기글 3건 수집 완료');

      const body = find_post_message_body();
      expect(body).not.toBeNull();
      expect(body!.thread_ts).toBe('3.1'); // Reply in the original thread
      expect(body!.text).toContain('크롤링 완료');
      expect(body!.text).toContain('블라인드 인기글 3건 수집 완료');
    });

    it('should post to channel if no thread mapping exists', async () => {
      mock_post_message_ok();
      await bot.notify_task_result('unknown-task', '완료', '결과 내용');

      const body = find_post_message_body();
      expect(body).not.toBeNull();
      expect(body!.thread_ts).toBeUndefined();
      expect(body!.text).toContain('완료');
    });

    it('should truncate long summaries', async () => {
      mock_post_message_ok();
      const long_summary = 'A'.repeat(4000);
      await bot.notify_task_result('unknown-task', '완료', long_summary);

      const body = find_post_message_body();
      expect(body!.text).toContain('...(생략)');
    });
  });

  // === send_message public API ===

  describe('send_message', () => {
    it('should send message to configured channel', async () => {
      mock_post_message_ok();
      await bot.send_message('테스트 메시지입니다');

      const body = find_post_message_body();
      expect(body!.text).toBe('테스트 메시지입니다');
      expect(body!.channel).toBe('C_TEST_CHANNEL');
    });

    it('should support thread_ts parameter for threaded replies', async () => {
      mock_post_message_ok();
      await bot.send_message('쓰레드 답장', '1.1');

      const body = find_post_message_body();
      expect(body!.thread_ts).toBe('1.1');
    });
  });

  // === Error handling ===

  describe('error handling', () => {
    it('should reply with error message when store.create throws', async () => {
      store.create.mockImplementationOnce(() => { throw new Error('DB error'); });
      mock_post_message_ok();

      await bot._handle_message({ text: '블라인드 인기글 긁어와', ts: '4.1', user: 'U123' });
      const body = find_post_message_body();
      expect(body!.text).toContain('오류');
    });
  });

  // === Lifecycle ===

  describe('start/stop lifecycle', () => {
    it('should set running state on start', () => {
      mock_fetch.mockImplementation(() => new Promise(() => {})); // hang forever
      bot.start();
      // Starting again should be a no-op
      bot.start();
      bot.stop();
    });

    it('should stop cleanly', () => {
      mock_fetch.mockImplementation(() => new Promise(() => {}));
      bot.start();
      bot.stop();
      // Should not throw
    });
  });

  // === PII Sanitizer integration ===

  describe('PII sanitizer integration', () => {
    const create_mock_sanitizer = (): BotSanitizer => ({
      sanitize_text: vi.fn((text: string) => text.replace(/010-\d{4}-\d{4}/g, '[전화번호 제거됨]')),
      contains_critical_pii: vi.fn((_text: string) => false),
      detect_pii_with_severity: vi.fn((_text: string) => []),
    });

    it('should sanitize title and description before creating task (warning PII)', async () => {
      const sanitizer = create_mock_sanitizer();
      (sanitizer.detect_pii_with_severity as ReturnType<typeof vi.fn>).mockReturnValue([
        { name: 'email', severity: 'warning' },
      ]);

      const bot_with_sanitizer = create_slack_bot(
        config,
        store as unknown as Parameters<typeof create_slack_bot>[1],
        sanitizer,
      );

      mock_post_message_ok(); // task confirmation
      mock_post_message_ok(); // pii warning
      await bot_with_sanitizer._handle_message({ text: 'user@example.com에 연락해줘', ts: '5.1', user: 'U123' });

      expect(sanitizer.sanitize_text).toHaveBeenCalled();
      expect(store.create).toHaveBeenCalled();
      bot_with_sanitizer.stop();
    });

    it('should block task creation and warn when critical PII detected', async () => {
      const sanitizer = create_mock_sanitizer();
      (sanitizer.contains_critical_pii as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (sanitizer.detect_pii_with_severity as ReturnType<typeof vi.fn>).mockReturnValue([
        { name: 'resident_id', severity: 'critical' },
      ]);

      const bot_with_sanitizer = create_slack_bot(
        config,
        store as unknown as Parameters<typeof create_slack_bot>[1],
        sanitizer,
      );

      mock_post_message_ok();
      await bot_with_sanitizer._handle_message({ text: '주민번호 900101-1234567 알려줘', ts: '5.2', user: 'U123' });

      expect(store.create).not.toHaveBeenCalled();
      const body = find_post_message_body();
      expect(body!.text).toContain('개인정보');
      bot_with_sanitizer.stop();
    });

    it('should work without sanitizer (backward compatible)', async () => {
      mock_post_message_ok();
      await bot._handle_message({ text: '주민번호 900101-1234567 알려줘', ts: '5.3', user: 'U123' });
      expect(store.create).toHaveBeenCalled();
    });

    it('should notify about auto-masking when warning PII is found', async () => {
      const sanitizer = create_mock_sanitizer();
      (sanitizer.detect_pii_with_severity as ReturnType<typeof vi.fn>).mockReturnValue([
        { name: 'email', severity: 'warning' },
      ]);

      const bot_with_sanitizer = create_slack_bot(
        config,
        store as unknown as Parameters<typeof create_slack_bot>[1],
        sanitizer,
      );

      mock_post_message_ok(); // task confirmation
      mock_post_message_ok(); // pii warning
      await bot_with_sanitizer._handle_message({ text: 'user@test.com 확인해줘', ts: '5.4', user: 'U123' });

      const calls = mock_fetch.mock.calls.filter((c: unknown[]) =>
        (c[0] as string).includes('chat.postMessage'),
      );
      expect(calls.length).toBe(2);

      const texts = calls.map((c: unknown[]) => JSON.parse((c[1] as { body: string }).body).text as string);
      expect(texts.some((t: string) => t.includes('마스킹'))).toBe(true);
      bot_with_sanitizer.stop();
    });
  });
});
