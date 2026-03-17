import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create_poll_loop } from './poll_loop.js';
import type { ApiClient } from './api_client.js';
import type { Logger } from './logger.js';
import type { HunterConfig } from './config.js';
import type { Task } from '../shared/types.js';

const mock_logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const mock_config: HunterConfig = {
  captain_api_url: 'http://localhost:3100',
  poll_interval_ms: 1000,
  log_dir: './logs',
  device_name: 'hunter',
};

const make_task = (id: string, title: string): Task => ({
  id,
  title,
  priority: 'medium',
  assigned_to: 'openclaw',
  mode: 'awake',
  risk_level: 'low',
  requires_personal_info: false,
  status: 'pending',
  created_at: '2026-03-17T00:00:00Z',
  deadline: null,
  depends_on: [],
});

describe('poll_loop', () => {
  let mock_api: ApiClient;
  let mock_executor: { execute: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.restoreAllMocks();

    mock_api = {
      send_heartbeat: vi.fn().mockResolvedValue({ ok: true, server_time: '2026-03-17T12:00:00Z' }),
      fetch_pending_tasks: vi.fn().mockResolvedValue([]),
      submit_result: vi.fn().mockResolvedValue(true),
    };

    mock_executor = {
      execute: vi.fn().mockResolvedValue({ status: 'success', output: 'done', files: [] }),
    };
  });

  it('should send heartbeat and fetch tasks on each cycle', async () => {
    // Given
    const loop = create_poll_loop({
      api: mock_api,
      executor: mock_executor,
      logger: mock_logger,
      config: mock_config,
    });

    // When
    await loop.run_cycle();

    // Then
    expect(mock_api.send_heartbeat).toHaveBeenCalledOnce();
    expect(mock_api.fetch_pending_tasks).toHaveBeenCalledOnce();
    expect(mock_executor.execute).not.toHaveBeenCalled(); // no tasks
  });

  it('should execute first task and submit result when tasks available', async () => {
    // Given
    const task = make_task('task_1', 'Crawl website');
    (mock_api.fetch_pending_tasks as ReturnType<typeof vi.fn>).mockResolvedValue([task]);

    const loop = create_poll_loop({
      api: mock_api,
      executor: mock_executor,
      logger: mock_logger,
      config: mock_config,
    });

    // When
    await loop.run_cycle();

    // Then
    expect(mock_executor.execute).toHaveBeenCalledWith(task);
    expect(mock_api.submit_result).toHaveBeenCalledWith('task_1', {
      status: 'success',
      output: 'done',
      files: [],
    });
    expect(loop.get_state().total_tasks_processed).toBe(1);
  });

  it('should only execute first task when multiple are pending', async () => {
    // Given
    const tasks = [make_task('task_1', 'First'), make_task('task_2', 'Second')];
    (mock_api.fetch_pending_tasks as ReturnType<typeof vi.fn>).mockResolvedValue(tasks);

    const loop = create_poll_loop({
      api: mock_api,
      executor: mock_executor,
      logger: mock_logger,
      config: mock_config,
    });

    // When
    await loop.run_cycle();

    // Then
    expect(mock_executor.execute).toHaveBeenCalledOnce();
    expect(mock_executor.execute).toHaveBeenCalledWith(tasks[0]);
  });

  it('should increment consecutive_failures on error', async () => {
    // Given
    (mock_api.send_heartbeat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'));

    const loop = create_poll_loop({
      api: mock_api,
      executor: mock_executor,
      logger: mock_logger,
      config: mock_config,
    });

    // When
    await loop.run_cycle();

    // Then
    expect(loop.get_state().consecutive_failures).toBe(1);
  });

  it('should reset consecutive_failures on successful cycle', async () => {
    // Given
    const loop = create_poll_loop({
      api: mock_api,
      executor: mock_executor,
      logger: mock_logger,
      config: mock_config,
    });

    // Simulate a prior failure
    await loop.run_cycle(); // success — should reset
    (mock_api.send_heartbeat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
    await loop.run_cycle(); // failure
    expect(loop.get_state().consecutive_failures).toBe(1);

    // Reset mock to succeed
    (mock_api.send_heartbeat as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, server_time: '' });
    await loop.run_cycle(); // success

    // Then
    expect(loop.get_state().consecutive_failures).toBe(0);
  });

  it('should calculate backoff interval correctly', () => {
    // Given
    const loop = create_poll_loop({
      api: mock_api,
      executor: mock_executor,
      logger: mock_logger,
      config: { ...mock_config, poll_interval_ms: 1000 },
    });

    // When / Then — no failures: normal interval
    expect(loop.get_current_interval()).toBe(1000);
  });
});
