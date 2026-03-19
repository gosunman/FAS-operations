// TDD tests for gateway logger with ISO timestamps
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { create_logger, type Logger } from './logger.js';

describe('Logger', () => {
  let original_console_log: typeof console.log;
  let original_console_error: typeof console.error;
  let original_console_warn: typeof console.warn;
  let mock_log: ReturnType<typeof vi.fn>;
  let mock_error: ReturnType<typeof vi.fn>;
  let mock_warn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T10:30:45.123Z'));

    // Capture original console methods and replace with mocks
    original_console_log = console.log;
    original_console_error = console.error;
    original_console_warn = console.warn;
    mock_log = vi.fn();
    mock_error = vi.fn();
    mock_warn = vi.fn();
    console.log = mock_log;
    console.error = mock_error;
    console.warn = mock_warn;
  });

  afterEach(() => {
    // Restore originals
    console.log = original_console_log;
    console.error = original_console_error;
    console.warn = original_console_warn;
    vi.useRealTimers();
  });

  describe('create_logger', () => {
    it('should create a logger with info, warn, and error methods', () => {
      // Given / When
      const logger = create_logger();

      // Then
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
    });
  });

  describe('logger.info', () => {
    it('should output message with ISO timestamp and INFO level', () => {
      // Given
      const logger = create_logger();

      // When
      logger.info('Server started');

      // Then
      expect(mock_log).toHaveBeenCalledWith(
        '[2026-03-19T10:30:45.123Z] [INFO] Server started'
      );
    });

    it('should handle multiple arguments by joining them', () => {
      // Given
      const logger = create_logger();

      // When
      logger.info('Listening on', 'port', 3100);

      // Then
      expect(mock_log).toHaveBeenCalledWith(
        '[2026-03-19T10:30:45.123Z] [INFO] Listening on port 3100'
      );
    });
  });

  describe('logger.warn', () => {
    it('should output message with ISO timestamp and WARN level', () => {
      // Given
      const logger = create_logger();

      // When
      logger.warn('Rate limit approaching');

      // Then
      expect(mock_warn).toHaveBeenCalledWith(
        '[2026-03-19T10:30:45.123Z] [WARN] Rate limit approaching'
      );
    });
  });

  describe('logger.error', () => {
    it('should output message with ISO timestamp and ERROR level', () => {
      // Given
      const logger = create_logger();

      // When
      logger.error('Connection failed');

      // Then
      expect(mock_error).toHaveBeenCalledWith(
        '[2026-03-19T10:30:45.123Z] [ERROR] Connection failed'
      );
    });

    it('should handle Error objects in arguments', () => {
      // Given
      const logger = create_logger();
      const err = new Error('timeout');

      // When
      logger.error('Request failed:', err);

      // Then
      expect(mock_error).toHaveBeenCalledWith(
        expect.stringContaining('[2026-03-19T10:30:45.123Z] [ERROR] Request failed: Error: timeout')
      );
    });
  });

  describe('timestamp accuracy', () => {
    it('should use current time for each log call', () => {
      // Given
      const logger = create_logger();

      // When
      logger.info('first');
      vi.setSystemTime(new Date('2026-03-19T11:00:00.000Z'));
      logger.info('second');

      // Then
      expect(mock_log).toHaveBeenNthCalledWith(1,
        '[2026-03-19T10:30:45.123Z] [INFO] first'
      );
      expect(mock_log).toHaveBeenNthCalledWith(2,
        '[2026-03-19T11:00:00.000Z] [INFO] second'
      );
    });
  });

  describe('prefix option', () => {
    it('should prepend prefix to messages when configured', () => {
      // Given
      const logger = create_logger({ prefix: 'Gateway' });

      // When
      logger.info('Server started');

      // Then
      expect(mock_log).toHaveBeenCalledWith(
        '[2026-03-19T10:30:45.123Z] [INFO] [Gateway] Server started'
      );
    });
  });
});
