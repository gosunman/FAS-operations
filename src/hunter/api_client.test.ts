import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create_api_client } from './api_client.js';
import type { Logger } from './logger.js';

// Mock logger
const mock_logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const BASE_URL = 'http://100.64.0.1:3100';

describe('api_client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetch_pending_tasks', () => {
    it('should return tasks on successful response', async () => {
      // Given
      const mock_tasks = [
        { id: 'task_1', title: 'Crawl K-Startup', status: 'pending' },
      ];
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tasks: mock_tasks, count: 1 }),
      }));

      const client = create_api_client({ base_url: BASE_URL }, mock_logger);

      // When
      const tasks = await client.fetch_pending_tasks();

      // Then
      expect(tasks).toEqual(mock_tasks);
      expect(fetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/hunter/tasks/pending`,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('should return empty array on HTTP error', async () => {
      // Given
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      }));

      const client = create_api_client({ base_url: BASE_URL }, mock_logger);

      // When
      const tasks = await client.fetch_pending_tasks();

      // Then
      expect(tasks).toEqual([]);
    });

    it('should return empty array on network error', async () => {
      // Given
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

      const client = create_api_client({ base_url: BASE_URL }, mock_logger);

      // When
      const tasks = await client.fetch_pending_tasks();

      // Then
      expect(tasks).toEqual([]);
      expect(mock_logger.error).toHaveBeenCalled();
    });
  });

  describe('submit_result', () => {
    it('should return true on successful submission', async () => {
      // Given
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      }));

      const client = create_api_client({ base_url: BASE_URL }, mock_logger);

      // When
      const result = await client.submit_result('task_1', {
        status: 'success',
        output: 'Done',
        files: [],
      });

      // Then
      expect(result).toBe(true);
    });

    it('should return false on failure', async () => {
      // Given
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));

      const client = create_api_client({ base_url: BASE_URL }, mock_logger);

      // When
      const result = await client.submit_result('task_1', {
        status: 'success',
        output: 'Done',
        files: [],
      });

      // Then
      expect(result).toBe(false);
    });
  });

  describe('send_heartbeat', () => {
    it('should return heartbeat response on success', async () => {
      // Given
      const hb_response = { ok: true, server_time: '2026-03-17T12:00:00Z' };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(hb_response),
      }));

      const client = create_api_client({ base_url: BASE_URL }, mock_logger);

      // When
      const result = await client.send_heartbeat();

      // Then
      expect(result).toEqual(hb_response);
    });

    it('should return null on failure', async () => {
      // Given
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

      const client = create_api_client({ base_url: BASE_URL }, mock_logger);

      // When
      const result = await client.send_heartbeat();

      // Then
      expect(result).toBeNull();
    });
  });
});
