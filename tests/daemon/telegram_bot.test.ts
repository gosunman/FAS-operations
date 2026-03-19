// TDD tests for standalone Telegram bot daemon
// This bot runs independently of Claude Code (Captain),
// allowing the owner to send tasks to Hunter even when Captain is down.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { create_telegram_bot, type TelegramBotConfig } from '../../src/daemon/telegram_bot.js';

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

  // === /hunter command ===

  describe('/hunter command', () => {
    it('should create a hunter task with chatgpt_task action', async () => {
      mock_send_ok();
      await bot._handle_message('/hunter 블라인드 인기글 긁어와', '12345');
      expect(store.create).toHaveBeenCalledWith(
        expect.objectContaining({
          assigned_to: 'hunter',
          action: 'chatgpt_task',
          description: '블라인드 인기글 긁어와',
        }),
      );
    });

    it('should reply with confirmation including task ID', async () => {
      mock_send_ok();
      await bot._handle_message('/hunter test task', '12345');
      const text = get_sent_text();
      expect(text).toContain('태스크 생성');
      expect(text).toContain('test-task-1');
    });

    it('should require a description after /hunter', async () => {
      mock_send_ok();
      await bot._handle_message('/hunter', '12345');
      const text = get_sent_text();
      expect(text).toContain('설명');
    });
  });

  // === /crawl command ===

  describe('/crawl command', () => {
    it('should create a web_crawl task for hunter', async () => {
      mock_send_ok();
      await bot._handle_message('/crawl https://example.com', '12345');
      expect(store.create).toHaveBeenCalledWith(
        expect.objectContaining({
          assigned_to: 'hunter',
          action: 'web_crawl',
          description: 'https://example.com',
        }),
      );
    });

    it('should reply with crawl task confirmation', async () => {
      mock_send_ok();
      await bot._handle_message('/crawl https://example.com', '12345');
      const text = get_sent_text();
      expect(text).toContain('크롤링');
      expect(text).toContain('https://example.com');
    });

    it('should require a URL after /crawl', async () => {
      mock_send_ok();
      await bot._handle_message('/crawl', '12345');
      const text = get_sent_text();
      expect(text).toContain('URL');
    });
  });

  // === /research command ===

  describe('/research command', () => {
    it('should create a deep_research task for hunter', async () => {
      mock_send_ok();
      await bot._handle_message('/research AI 트렌드 2026', '12345');
      expect(store.create).toHaveBeenCalledWith(
        expect.objectContaining({
          assigned_to: 'hunter',
          action: 'deep_research',
          description: 'AI 트렌드 2026',
        }),
      );
    });

    it('should require a topic after /research', async () => {
      mock_send_ok();
      await bot._handle_message('/research', '12345');
      const text = get_sent_text();
      expect(text).toContain('주제');
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

  // === Unknown commands ===

  describe('unknown commands', () => {
    it('should reply with help text for unknown commands', async () => {
      mock_send_ok();
      await bot._handle_message('/unknown something', '12345');
      const text = get_sent_text();
      expect(text).toContain('알 수 없는 명령어');
    });
  });

  // === Non-command text (security: no default routing to hunter) ===

  describe('non-command text', () => {
    it('should NOT route plain text to hunter (PII leak risk)', async () => {
      mock_send_ok();
      await bot._handle_message('네이버 부동산 시세 알려줘', '12345');
      // Daemon does NOT have captain — plain text should show help message
      expect(store.create).not.toHaveBeenCalled();
    });

    it('should suggest using commands for plain text', async () => {
      mock_send_ok();
      await bot._handle_message('네이버 부동산 시세 알려줘', '12345');
      const text = get_sent_text();
      expect(text).toContain('/hunter');
    });
  });

  // === Error handling ===

  describe('error handling', () => {
    it('should reply with error message when store.create throws', async () => {
      store.create.mockImplementationOnce(() => { throw new Error('DB error'); });
      mock_send_ok();

      await bot._handle_message('/hunter test', '12345');
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
});
