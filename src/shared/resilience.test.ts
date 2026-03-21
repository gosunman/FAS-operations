// Tests for core resilience utilities
// Pattern: Given-When-Then

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  retry_with_backoff,
  create_deadlock_detector,
  with_timeout,
  create_circuit_breaker,
  RetryExhaustedError,
  TimeoutError,
  CircuitOpenError,
  DeadlockError,
} from './resilience.js';

// === retry_with_backoff ===

describe('retry_with_backoff', () => {
  // Use real timers with very short delays to avoid unhandled rejection issues with fake timers

  describe('happy path', () => {
    it('should return result immediately when operation succeeds on first try', async () => {
      // Given: an operation that succeeds immediately
      const operation = vi.fn().mockResolvedValue('success');

      // When: retry is executed
      const result = await retry_with_backoff(operation);

      // Then: result is returned and operation called once
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });
  });

  describe('retry behavior', () => {
    it('should retry on failure and return result on eventual success', async () => {
      // Given: an operation that fails twice then succeeds
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValueOnce('recovered');

      // When: retry is executed with adequate retries and very short delays
      const result = await retry_with_backoff(operation, {
        max_retries: 3,
        initial_delay_ms: 10,
        max_delay_ms: 50,
      });

      // Then: operation was called 3 times and returned the successful result
      expect(result).toBe('recovered');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should throw RetryExhaustedError when all attempts fail', async () => {
      // Given: an operation that always fails
      const operation = vi.fn().mockRejectedValue(new Error('permanent failure'));

      // When/Then: retry exhausts all attempts
      try {
        await retry_with_backoff(operation, {
          max_retries: 2,
          initial_delay_ms: 10,
          max_delay_ms: 20,
        });
        expect.unreachable('should have thrown');
      } catch (err) {
        // Then: RetryExhaustedError is thrown with correct metadata
        expect(err).toBeInstanceOf(RetryExhaustedError);
        expect((err as RetryExhaustedError).attempts).toBe(3); // initial + 2 retries
      }
    });

    it('should call on_retry callback for each retry', async () => {
      // Given: an operation that fails once then succeeds
      const on_retry = vi.fn();
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValueOnce('ok');

      // When: retry is executed with on_retry callback
      const result = await retry_with_backoff(operation, {
        max_retries: 2,
        initial_delay_ms: 10,
        on_retry,
      });

      // Then: on_retry was called once with attempt number, error, and delay
      expect(result).toBe('ok');
      expect(on_retry).toHaveBeenCalledTimes(1);
      expect(on_retry).toHaveBeenCalledWith(
        1,                          // attempt number
        expect.any(Error),          // error
        expect.any(Number),         // next delay
      );
    });
  });

  describe('abort signal', () => {
    it('should abort immediately when signal is already aborted', async () => {
      // Given: an already-aborted signal
      const controller = new AbortController();
      controller.abort();
      const operation = vi.fn().mockResolvedValue('never');

      // When/Then: retry throws AbortError immediately
      await expect(
        retry_with_backoff(operation, { signal: controller.signal }),
      ).rejects.toThrow('Aborted');

      expect(operation).not.toHaveBeenCalled();
    });

    it('should abort during retry delay when signal fires', async () => {
      // Given: an operation that fails, and a signal that will abort during delay
      const controller = new AbortController();
      const operation = vi.fn().mockRejectedValue(new Error('fail'));

      // When: retry starts with long delay, signal fires quickly
      const promise = retry_with_backoff(operation, {
        max_retries: 5,
        initial_delay_ms: 60_000, // Very long delay — abort should cancel before this
        signal: controller.signal,
      });

      // Abort after a very short time (first attempt fails, then during backoff delay)
      setTimeout(() => controller.abort(), 50);

      // Then: the retry is cancelled
      await expect(promise).rejects.toThrow('Aborted');
    });
  });

  describe('backoff timing', () => {
    it('should not exceed max_delay_ms', async () => {
      // Given: an operation that always fails, with small max_delay
      const on_retry = vi.fn();
      const operation = vi.fn().mockRejectedValue(new Error('fail'));

      // When: retry runs with huge backoff factor but capped max_delay
      try {
        await retry_with_backoff(operation, {
          max_retries: 3,
          initial_delay_ms: 10,
          max_delay_ms: 30,
          backoff_factor: 10,  // huge factor to test cap
          on_retry,
        });
      } catch {
        // Expected to throw RetryExhaustedError
      }

      // Then: all retry delays should be capped at max_delay_ms
      for (const call of on_retry.mock.calls) {
        const delay = call[2] as number;
        expect(delay).toBeLessThanOrEqual(30);
      }
    });
  });
});

// === create_deadlock_detector ===

describe('create_deadlock_detector', () => {
  it('should not report deadlock before threshold is reached', () => {
    // Given: a detector with threshold 3
    const detector = create_deadlock_detector(3);

    // When: resource is recorded twice
    detector.record('selector-A');
    const info = detector.record('selector-A');

    // Then: no deadlock
    expect(info.is_deadlocked).toBe(false);
    expect(info.repetitions).toBe(2);
  });

  it('should report deadlock when threshold is reached', () => {
    // Given: a detector with threshold 3
    const detector = create_deadlock_detector(3);

    // When: resource is recorded 3 times
    detector.record('selector-A');
    detector.record('selector-A');
    const info = detector.record('selector-A');

    // Then: deadlock is reported
    expect(info.is_deadlocked).toBe(true);
    expect(info.repetitions).toBe(3);
    expect(info.resource).toBe('selector-A');
  });

  it('should track different resources independently', () => {
    // Given: a detector
    const detector = create_deadlock_detector(2);

    // When: different resources are recorded
    detector.record('resource-A');
    detector.record('resource-B');
    const info_a = detector.record('resource-A');
    const info_b = detector.check('resource-B');

    // Then: each resource has its own count
    expect(info_a.is_deadlocked).toBe(true);  // 2 repetitions
    expect(info_b.is_deadlocked).toBe(false);  // 1 repetition
  });

  it('should reset tracking for a specific resource', () => {
    // Given: a detector with recorded operations
    const detector = create_deadlock_detector(3);
    detector.record('resource-A');
    detector.record('resource-A');

    // When: resource is reset
    detector.reset('resource-A');
    const info = detector.check('resource-A');

    // Then: count is back to 0
    expect(info.repetitions).toBe(0);
    expect(info.is_deadlocked).toBe(false);
  });

  it('should reset all tracking', () => {
    // Given: a detector with multiple resources recorded
    const detector = create_deadlock_detector(2);
    detector.record('resource-A');
    detector.record('resource-B');

    // When: all tracking is reset
    detector.reset_all();

    // Then: all counts are 0
    expect(detector.check('resource-A').repetitions).toBe(0);
    expect(detector.check('resource-B').repetitions).toBe(0);
  });

  it('should use default threshold of 3', () => {
    // Given: a detector with default threshold
    const detector = create_deadlock_detector();

    // When: resource is recorded 2 times
    detector.record('x');
    const info2 = detector.record('x');

    // Then: not deadlocked at 2
    expect(info2.is_deadlocked).toBe(false);

    // When: recorded 3rd time
    const info3 = detector.record('x');

    // Then: deadlocked at 3
    expect(info3.is_deadlocked).toBe(true);
  });
});

// === with_timeout ===

describe('with_timeout', () => {
  it('should return result when operation completes before timeout', async () => {
    // Given: an operation that resolves quickly
    const operation = vi.fn().mockImplementation(async () => 'fast result');

    // When: wrapped with a generous timeout
    const result = await with_timeout(operation, {
      timeout_ms: 10_000,
      operation_name: 'test_op',
    });

    // Then: result is returned normally
    expect(result).toBe('fast result');
  });

  it('should throw TimeoutError when operation exceeds timeout', async () => {
    // Given: an operation that never resolves (waits on a signal)
    const operation = (signal: AbortSignal) =>
      new Promise<string>((_, reject) => {
        signal.addEventListener('abort', () => {
          // Do nothing — let the timeout reject instead
        });
      });

    // When/Then: wrapped with a short timeout, it should reject with TimeoutError
    // Use real timers since the timeout is short enough
    await expect(
      with_timeout(operation, {
        timeout_ms: 50,
        operation_name: 'slow_op',
      }),
    ).rejects.toThrow(TimeoutError);
  });

  it('should include operation name and timeout_ms in TimeoutError', async () => {
    // Given: a never-resolving operation
    const operation = () => new Promise<string>(() => {});

    // When: timeout fires
    try {
      await with_timeout(operation, {
        timeout_ms: 50,
        operation_name: 'metadata_test',
      });
      expect.unreachable('should have thrown');
    } catch (err) {
      // Then: error has correct metadata
      expect(err).toBeInstanceOf(TimeoutError);
      expect((err as TimeoutError).timeout_ms).toBe(50);
      expect((err as TimeoutError).operation).toBe('metadata_test');
    }
  });

  it('should call on_timeout callback when timeout occurs', async () => {
    // Given: a checkpoint callback and a never-resolving operation
    const on_timeout = vi.fn();
    const operation = () => new Promise<string>(() => {});

    // When: timeout fires
    try {
      await with_timeout(operation, {
        timeout_ms: 50,
        operation_name: 'checkpoint_op',
        on_timeout,
      });
    } catch {
      // Expected
    }

    // Then: checkpoint callback was invoked
    expect(on_timeout).toHaveBeenCalledTimes(1);
  });

  it('should provide abort signal to the operation', async () => {
    // Given: an operation that checks the signal
    let received_signal: AbortSignal | null = null;
    const operation = async (signal: AbortSignal) => {
      received_signal = signal;
      return 'done';
    };

    // When: with_timeout wraps the operation
    await with_timeout(operation, {
      timeout_ms: 10_000,
      operation_name: 'signal_test',
    });

    // Then: signal was provided
    expect(received_signal).not.toBeNull();
    expect(received_signal!.aborted).toBe(false);
  });

  it('should propagate operation errors (not mask them as TimeoutError)', async () => {
    // Given: an operation that throws a non-timeout error
    const operation = async () => {
      throw new Error('operation failed');
    };

    // When/Then: the original error propagates
    await expect(
      with_timeout(operation, {
        timeout_ms: 10_000,
        operation_name: 'error_test',
      }),
    ).rejects.toThrow('operation failed');
  });
});

// === create_circuit_breaker ===

describe('create_circuit_breaker', () => {
  it('should start in closed state', () => {
    // Given: a new circuit breaker
    const cb = create_circuit_breaker({ service_name: 'test-api' });

    // Then: state is closed
    expect(cb.get_state()).toBe('closed');
    expect(cb.get_failure_count()).toBe(0);
  });

  it('should pass through successful calls in closed state', async () => {
    // Given: a circuit breaker
    const cb = create_circuit_breaker({ service_name: 'test-api' });

    // When: a successful operation is executed
    const result = await cb.execute(async () => 'success');

    // Then: result is returned and state remains closed
    expect(result).toBe('success');
    expect(cb.get_state()).toBe('closed');
    expect(cb.get_failure_count()).toBe(0);
  });

  it('should open after failure_threshold consecutive failures', async () => {
    // Given: a circuit breaker with threshold 3
    const cb = create_circuit_breaker({
      service_name: 'test-api',
      failure_threshold: 3,
    });

    // When: 3 consecutive failures occur
    for (let i = 0; i < 3; i++) {
      try {
        await cb.execute(async () => { throw new Error(`fail ${i}`); });
      } catch { /* expected */ }
    }

    // Then: circuit is open
    expect(cb.get_state()).toBe('open');
    expect(cb.get_failure_count()).toBe(3);
  });

  it('should reject calls immediately when circuit is open', async () => {
    // Given: an open circuit breaker
    const cb = create_circuit_breaker({
      service_name: 'test-api',
      failure_threshold: 1,
      cooldown_ms: 30_000,
    });

    // Trip the circuit
    try {
      await cb.execute(async () => { throw new Error('trip'); });
    } catch { /* expected */ }

    // When: another call is made while open
    // Then: CircuitOpenError is thrown without calling the operation
    const operation = vi.fn().mockResolvedValue('blocked');
    await expect(cb.execute(operation)).rejects.toThrow(CircuitOpenError);
    expect(operation).not.toHaveBeenCalled();
  });

  it('should transition to half-open after cooldown period', async () => {
    // Given: an open circuit breaker with short cooldown
    vi.useFakeTimers();

    const cb = create_circuit_breaker({
      service_name: 'test-api',
      failure_threshold: 1,
      cooldown_ms: 5_000,
    });

    // Trip the circuit
    try {
      await cb.execute(async () => { throw new Error('trip'); });
    } catch { /* expected */ }
    expect(cb.get_state()).toBe('open');

    // When: cooldown elapses and a call is made
    vi.advanceTimersByTime(5_001);

    // The next call should go through (half-open state)
    const result = await cb.execute(async () => 'recovered');

    // Then: circuit closes on success
    expect(result).toBe('recovered');
    expect(cb.get_state()).toBe('closed');

    vi.useRealTimers();
  });

  it('should re-open if half-open test call fails', async () => {
    // Given: an open circuit breaker with short cooldown
    vi.useFakeTimers();

    const cb = create_circuit_breaker({
      service_name: 'test-api',
      failure_threshold: 1,
      cooldown_ms: 5_000,
    });

    // Trip the circuit
    try {
      await cb.execute(async () => { throw new Error('trip'); });
    } catch { /* expected */ }

    // When: cooldown elapses but test call also fails
    vi.advanceTimersByTime(5_001);

    try {
      await cb.execute(async () => { throw new Error('still failing'); });
    } catch { /* expected */ }

    // Then: circuit goes back to open
    expect(cb.get_state()).toBe('open');

    vi.useRealTimers();
  });

  it('should reset failure count on success in closed state', async () => {
    // Given: a circuit breaker with some failures
    const cb = create_circuit_breaker({
      service_name: 'test-api',
      failure_threshold: 5,
    });

    try {
      await cb.execute(async () => { throw new Error('fail'); });
    } catch { /* expected */ }
    try {
      await cb.execute(async () => { throw new Error('fail'); });
    } catch { /* expected */ }
    expect(cb.get_failure_count()).toBe(2);

    // When: a successful call occurs
    await cb.execute(async () => 'success');

    // Then: failure count is reset
    expect(cb.get_failure_count()).toBe(0);
    expect(cb.get_state()).toBe('closed');
  });

  it('should manually reset the circuit', async () => {
    // Given: an open circuit breaker
    const cb = create_circuit_breaker({
      service_name: 'test-api',
      failure_threshold: 1,
    });

    try {
      await cb.execute(async () => { throw new Error('trip'); });
    } catch { /* expected */ }
    expect(cb.get_state()).toBe('open');

    // When: circuit is manually reset
    cb.reset();

    // Then: circuit is closed with zero failures
    expect(cb.get_state()).toBe('closed');
    expect(cb.get_failure_count()).toBe(0);
  });

  it('should call on_state_change callback on transitions', async () => {
    // Given: a circuit breaker with state change callback
    const on_state_change = vi.fn();
    const cb = create_circuit_breaker({
      service_name: 'test-api',
      failure_threshold: 1,
      on_state_change,
    });

    // When: circuit trips
    try {
      await cb.execute(async () => { throw new Error('trip'); });
    } catch { /* expected */ }

    // Then: callback was called with transition
    expect(on_state_change).toHaveBeenCalledWith('closed', 'open');
  });
});

// === Error type checks ===

describe('custom error types', () => {
  it('RetryExhaustedError has correct properties', () => {
    const err = new RetryExhaustedError(3, new Error('base'));
    expect(err.name).toBe('RetryExhaustedError');
    expect(err.attempts).toBe(3);
    expect(err.last_error).toBeInstanceOf(Error);
    expect(err.message).toContain('3 retry attempts');
    expect(err).toBeInstanceOf(Error);
  });

  it('TimeoutError has correct properties', () => {
    const err = new TimeoutError('my_op', 5000);
    expect(err.name).toBe('TimeoutError');
    expect(err.operation).toBe('my_op');
    expect(err.timeout_ms).toBe(5000);
    expect(err.message).toContain('5000ms');
    expect(err).toBeInstanceOf(Error);
  });

  it('CircuitOpenError has correct properties', () => {
    const err = new CircuitOpenError('api-service', Date.now() + 10_000);
    expect(err.name).toBe('CircuitOpenError');
    expect(err.service).toBe('api-service');
    expect(err.opens_at).toBeGreaterThan(0);
    expect(err.message).toContain('api-service');
    expect(err).toBeInstanceOf(Error);
  });

  it('DeadlockError has correct properties', () => {
    const err = new DeadlockError('selector-X', 5);
    expect(err.name).toBe('DeadlockError');
    expect(err.resource).toBe('selector-X');
    expect(err.repetitions).toBe(5);
    expect(err.message).toContain('selector-X');
    expect(err).toBeInstanceOf(Error);
  });
});
