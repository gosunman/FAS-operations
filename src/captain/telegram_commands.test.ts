// TDD tests for Telegram inbound command handler
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create_telegram_commands } from './telegram_commands.js';

// === Mock fetch globally ===
const mock_fetch = vi.fn();
vi.stubGlobal('fetch', mock_fetch);

// === Mock TaskStore factory ===
const create_mock_store = () => {
  let task_counter = 0;
  const tasks: Record<string, { id: string; title: string; status: string; assigned_to: string; action?: string }> = {};

  return {
    create: vi.fn((params: Record<string, unknown>) => {
      task_counter++;
      const id = `test-task-${task_counter}`;
      const task = {
        id,
        title: params.title as string,
        description: params.description as string,
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
    // Unused but required by type
    get_pending_for_agent: vi.fn(() => []),
    update_status: vi.fn(() => true),
    complete_task: vi.fn(() => true),
    quarantine_task: vi.fn(() => true),
    get_all: vi.fn(() => []),
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

describe('telegram_commands', () => {
  const config = {
    bot_token: 'test-bot-token',
    chat_id: '12345',
    poll_interval_ms: 100,
  };

  let store: ReturnType<typeof create_mock_store>;
  let commands: ReturnType<typeof create_telegram_commands>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = create_mock_store();
    commands = create_telegram_commands(config, store as unknown as Parameters<typeof create_telegram_commands>[1]);
  });

  describe('security', () => {
    it('should reject messages from unauthorized chat IDs', async () => {
      mock_send_ok(); // should not be called
      await commands._handle_message('hello', '99999');
      expect(store.create).not.toHaveBeenCalled();
      expect(mock_fetch).not.toHaveBeenCalled();
    });

    it('should accept messages from configured chat ID', async () => {
      mock_send_ok();
      await commands._handle_message('hello world', '12345');
      expect(store.create).toHaveBeenCalled();
    });
  });

  describe('/hunter command', () => {
    it('should create a hunter task with chatgpt_task action', async () => {
      mock_send_ok();
      await commands._handle_message('/hunter 블라인드 인기글 긁어와', '12345');
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
      await commands._handle_message('/hunter test task', '12345');
      expect(mock_fetch).toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('태스크 생성됨'),
        }),
      );
    });
  });

  describe('/captain command', () => {
    it('should create a captain task', async () => {
      mock_send_ok();
      await commands._handle_message('/captain 경쟁사 분석', '12345');
      expect(store.create).toHaveBeenCalledWith(
        expect.objectContaining({
          assigned_to: 'captain',
          description: '경쟁사 분석',
        }),
      );
    });
  });

  describe('/crawl command', () => {
    it('should create a web_crawl task for hunter', async () => {
      mock_send_ok();
      await commands._handle_message('/crawl https://example.com', '12345');
      expect(store.create).toHaveBeenCalledWith(
        expect.objectContaining({
          assigned_to: 'hunter',
          action: 'web_crawl',
          description: 'https://example.com',
        }),
      );
    });
  });

  describe('/research command', () => {
    it('should create a deep_research task for hunter', async () => {
      mock_send_ok();
      await commands._handle_message('/research AI 트렌드 2026', '12345');
      expect(store.create).toHaveBeenCalledWith(
        expect.objectContaining({
          assigned_to: 'hunter',
          action: 'deep_research',
          description: 'AI 트렌드 2026',
        }),
      );
    });
  });

  describe('/status command', () => {
    it('should reply with task statistics', async () => {
      mock_send_ok();
      await commands._handle_message('/status', '12345');
      expect(store.get_stats).toHaveBeenCalled();
      const call_body = JSON.parse(mock_fetch.mock.calls[0][1].body);
      expect(call_body.text).toContain('대기: 3');
      expect(call_body.text).toContain('진행중: 1');
      expect(call_body.text).toContain('완료: 5');
    });
  });

  describe('/tasks command', () => {
    it('should reply with pending tasks list', async () => {
      // Pre-populate some tasks
      store.create({ title: 'Task A', assigned_to: 'hunter' });
      store.create({ title: 'Task B', assigned_to: 'captain' });
      mock_send_ok();

      await commands._handle_message('/tasks', '12345');
      expect(store.get_by_status).toHaveBeenCalledWith('pending');
    });

    it('should show message when no pending tasks', async () => {
      store.get_by_status.mockReturnValueOnce([]);
      mock_send_ok();

      await commands._handle_message('/tasks', '12345');
      const call_body = JSON.parse(mock_fetch.mock.calls[0][1].body);
      expect(call_body.text).toContain('대기중인 태스크가 없습니다');
    });
  });

  describe('/cancel command', () => {
    it('should block an existing task', async () => {
      // Create a task first
      const task = store.create({ title: 'To cancel', assigned_to: 'hunter' });
      mock_send_ok();

      await commands._handle_message(`/cancel ${task.id}`, '12345');
      expect(store.block_task).toHaveBeenCalledWith(task.id, 'Cancelled by user');
    });

    it('should reply with error for non-existent task', async () => {
      store.get_by_id.mockReturnValueOnce(null);
      mock_send_ok();

      await commands._handle_message('/cancel nonexistent-id', '12345');
      const call_body = JSON.parse(mock_fetch.mock.calls[0][1].body);
      expect(call_body.text).toContain('찾을 수 없습니다');
    });
  });

  describe('default (non-command text)', () => {
    it('should create a captain task for plain text (security: captain triages first)', async () => {
      mock_send_ok();
      await commands._handle_message('네이버 부동산 시세 알려줘', '12345');
      expect(store.create).toHaveBeenCalledWith(
        expect.objectContaining({
          assigned_to: 'captain',
        }),
      );
      // Must NOT go directly to hunter — PII leak risk
      expect(store.create).not.toHaveBeenCalledWith(
        expect.objectContaining({
          assigned_to: 'hunter',
        }),
      );
    });
  });

  describe('unknown command', () => {
    it('should reply with unknown command message', async () => {
      mock_send_ok();
      await commands._handle_message('/unknown something', '12345');
      const call_body = JSON.parse(mock_fetch.mock.calls[0][1].body);
      expect(call_body.text).toContain('알 수 없는 명령어');
    });
  });

  describe('error handling', () => {
    it('should reply with error message when store.create throws', async () => {
      store.create.mockImplementationOnce(() => { throw new Error('DB error'); });
      mock_send_ok();

      await commands._handle_message('/hunter test', '12345');
      const call_body = JSON.parse(mock_fetch.mock.calls[0][1].body);
      expect(call_body.text).toContain('오류 발생');
    });
  });

  describe('start/stop lifecycle', () => {
    it('should set running state on start', () => {
      // Mock the getUpdates call that start() will trigger
      mock_fetch.mockImplementation(() => new Promise(() => {})); // hang forever
      commands.start();
      // Starting again should be a no-op
      commands.start();
      commands.stop();
    });

    it('should abort polling on stop', () => {
      mock_fetch.mockImplementation(() => new Promise(() => {}));
      commands.start();
      commands.stop();
      // Should not throw
    });
  });

  describe('empty/whitespace messages', () => {
    it('should ignore empty messages', async () => {
      await commands._handle_message('', '12345');
      expect(store.create).not.toHaveBeenCalled();
      expect(mock_fetch).not.toHaveBeenCalled();
    });

    it('should ignore whitespace-only messages', async () => {
      await commands._handle_message('   ', '12345');
      expect(store.create).not.toHaveBeenCalled();
      expect(mock_fetch).not.toHaveBeenCalled();
    });
  });
});
