// Core resilience utilities for FAS agents
// Provides retry with backoff, deadlock detection, timeout wrapping, and circuit breaker
// Adapted from B.A.P. AutonomousLoop patterns for the FAS functional architecture

// === Custom Error Types ===

export class RetryExhaustedError extends Error {
  readonly attempts: number;
  readonly last_error: unknown;

  constructor(attempts: number, last_error: unknown) {
    const msg = last_error instanceof Error ? last_error.message : String(last_error);
    super(`All ${attempts} retry attempts exhausted. Last error: ${msg}`);
    this.name = 'RetryExhaustedError';
    this.attempts = attempts;
    this.last_error = last_error;
  }
}

export class TimeoutError extends Error {
  readonly timeout_ms: number;
  readonly operation: string;

  constructor(operation: string, timeout_ms: number) {
    super(`Operation "${operation}" timed out after ${timeout_ms}ms`);
    this.name = 'TimeoutError';
    this.timeout_ms = timeout_ms;
    this.operation = operation;
  }
}

export class CircuitOpenError extends Error {
  readonly service: string;
  readonly opens_at: number;

  constructor(service: string, opens_at: number) {
    const remaining_ms = Math.max(0, opens_at - Date.now());
    super(`Circuit breaker open for "${service}". Half-open in ${Math.round(remaining_ms / 1000)}s`);
    this.name = 'CircuitOpenError';
    this.service = service;
    this.opens_at = opens_at;
  }
}

export class DeadlockError extends Error {
  readonly resource: string;
  readonly repetitions: number;

  constructor(resource: string, repetitions: number) {
    super(`Deadlock detected on "${resource}" after ${repetitions} repeated operations`);
    this.name = 'DeadlockError';
    this.resource = resource;
    this.repetitions = repetitions;
  }
}

// === 1. Retry with Exponential Backoff ===

export type RetryConfig = {
  max_retries: number;           // Maximum number of retry attempts (default: 3)
  initial_delay_ms: number;      // Initial delay before first retry (default: 1000)
  max_delay_ms: number;          // Maximum delay cap (default: 30_000)
  backoff_factor: number;        // Multiplier per retry (default: 2)
  signal?: AbortSignal;          // Optional abort signal to cancel retries
  on_retry?: (attempt: number, error: unknown, next_delay_ms: number) => void;
};

const DEFAULT_RETRY_CONFIG: Required<Omit<RetryConfig, 'signal' | 'on_retry'>> = {
  max_retries: 3,
  initial_delay_ms: 1_000,
  max_delay_ms: 30_000,
  backoff_factor: 2,
} as const;

// Sleeps for a given duration, respecting an optional abort signal
const sleep_with_abort = (ms: number, signal?: AbortSignal): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const timer = setTimeout(resolve, ms);

    const on_abort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };

    signal?.addEventListener('abort', on_abort, { once: true });
  });
};

// Calculate delay for a given attempt using exponential backoff with jitter
const calculate_delay = (
  attempt: number,
  initial_delay_ms: number,
  max_delay_ms: number,
  backoff_factor: number,
): number => {
  const base_delay = initial_delay_ms * Math.pow(backoff_factor, attempt);
  const capped = Math.min(base_delay, max_delay_ms);
  // Add jitter: randomize between 50%-100% of calculated delay to avoid thundering herd
  const jitter = 0.5 + Math.random() * 0.5;
  return Math.round(capped * jitter);
};

/**
 * Retry an async operation with exponential backoff.
 * Throws RetryExhaustedError if all attempts fail.
 * Throws immediately if abort signal fires.
 */
export const retry_with_backoff = async <T>(
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {},
): Promise<T> => {
  const {
    max_retries = DEFAULT_RETRY_CONFIG.max_retries,
    initial_delay_ms = DEFAULT_RETRY_CONFIG.initial_delay_ms,
    max_delay_ms = DEFAULT_RETRY_CONFIG.max_delay_ms,
    backoff_factor = DEFAULT_RETRY_CONFIG.backoff_factor,
    signal,
    on_retry,
  } = config;

  let last_error: unknown;

  for (let attempt = 0; attempt <= max_retries; attempt++) {
    // Check abort before each attempt
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    try {
      return await operation();
    } catch (err) {
      last_error = err;

      // Don't retry if this is the last attempt
      if (attempt === max_retries) break;

      const delay = calculate_delay(attempt, initial_delay_ms, max_delay_ms, backoff_factor);
      on_retry?.(attempt + 1, err, delay);

      console.warn(
        `[Retry] Attempt ${attempt + 1}/${max_retries} failed. Retrying in ${delay}ms...`,
      );

      await sleep_with_abort(delay, signal);
    }
  }

  throw new RetryExhaustedError(max_retries + 1, last_error);
};

// === 2. Deadlock Detector ===

export type DeadlockInfo = {
  resource: string;
  repetitions: number;
  is_deadlocked: boolean;
};

export type DeadlockDetector = {
  // Record an operation on a resource. Returns deadlock info.
  record: (resource: string) => DeadlockInfo;
  // Check current state for a resource without recording
  check: (resource: string) => DeadlockInfo;
  // Reset tracking for a resource (e.g., after successful operation)
  reset: (resource: string) => void;
  // Reset all tracking
  reset_all: () => void;
};

// Default threshold before declaring deadlock
const DEFAULT_DEADLOCK_THRESHOLD = 3;

/**
 * Creates a deadlock detector that tracks repeated operations on resources.
 * Declares deadlock after N consecutive repetitions on the same resource.
 */
export const create_deadlock_detector = (
  threshold: number = DEFAULT_DEADLOCK_THRESHOLD,
): DeadlockDetector => {
  // Map: resource identifier → consecutive repetition count
  const counts = new Map<string, number>();

  const make_info = (resource: string, repetitions: number): DeadlockInfo => ({
    resource,
    repetitions,
    is_deadlocked: repetitions >= threshold,
  });

  const record = (resource: string): DeadlockInfo => {
    const current = counts.get(resource) ?? 0;
    const next = current + 1;
    counts.set(resource, next);
    return make_info(resource, next);
  };

  const check = (resource: string): DeadlockInfo => {
    const current = counts.get(resource) ?? 0;
    return make_info(resource, current);
  };

  const reset = (resource: string): void => {
    counts.delete(resource);
  };

  const reset_all = (): void => {
    counts.clear();
  };

  return { record, check, reset, reset_all };
};

// === 3. Global Timeout Wrapper ===

export type TimeoutConfig = {
  timeout_ms: number;            // Maximum time allowed for the operation
  operation_name: string;        // Label for logging/errors
  on_timeout?: () => Promise<void> | void;  // Optional checkpoint callback on timeout
};

/**
 * Wraps any async operation with a timeout.
 * On timeout, optionally calls a checkpoint function before throwing TimeoutError.
 * Uses AbortController for clean cancellation.
 */
export const with_timeout = async <T>(
  operation: (signal: AbortSignal) => Promise<T>,
  config: TimeoutConfig,
): Promise<T> => {
  const { timeout_ms, operation_name, on_timeout } = config;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;

  try {
    const result = await Promise.race([
      operation(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(async () => {
          controller.abort();

          // Call checkpoint function if provided
          if (on_timeout) {
            try {
              await on_timeout();
            } catch (checkpoint_err) {
              console.error(
                `[Timeout] Checkpoint callback failed for "${operation_name}":`,
                checkpoint_err,
              );
            }
          }

          reject(new TimeoutError(operation_name, timeout_ms));
        }, timeout_ms);

        // Prevent timer from keeping the process alive
        if (typeof timer === 'object' && 'unref' in timer) {
          (timer as NodeJS.Timeout).unref();
        }
      }),
    ]);

    // Operation completed before timeout — clear the timer
    if (timer !== null) clearTimeout(timer);
    return result;
  } catch (err) {
    // Clear timer on any error (including TimeoutError)
    if (timer !== null) clearTimeout(timer);
    throw err;
  }
};

// === 4. Circuit Breaker ===

export type CircuitState = 'closed' | 'open' | 'half_open';

export type CircuitBreakerConfig = {
  service_name: string;          // Name of the service being protected
  failure_threshold: number;     // Number of failures before opening (default: 5)
  cooldown_ms: number;           // Time to wait before half-open (default: 30_000)
  on_state_change?: (from: CircuitState, to: CircuitState) => void;
};

export type CircuitBreaker = {
  // Execute an operation through the circuit breaker
  execute: <T>(operation: () => Promise<T>) => Promise<T>;
  // Get current circuit state
  get_state: () => CircuitState;
  // Get failure count
  get_failure_count: () => number;
  // Manually reset the circuit breaker
  reset: () => void;
};

const DEFAULT_CIRCUIT_CONFIG = {
  failure_threshold: 5,
  cooldown_ms: 30_000,
} as const;

/**
 * Circuit breaker pattern: prevents repeated calls to a failing service.
 * - Closed: normal operation, counting failures
 * - Open: all calls rejected immediately (circuit is "tripped")
 * - Half-open: allows one test call through after cooldown period
 */
export const create_circuit_breaker = (
  config: Partial<CircuitBreakerConfig> & Pick<CircuitBreakerConfig, 'service_name'>,
): CircuitBreaker => {
  const {
    service_name,
    failure_threshold = DEFAULT_CIRCUIT_CONFIG.failure_threshold,
    cooldown_ms = DEFAULT_CIRCUIT_CONFIG.cooldown_ms,
    on_state_change,
  } = config;

  let state: CircuitState = 'closed';
  let failure_count = 0;
  let last_failure_at = 0;

  const transition = (to: CircuitState): void => {
    if (state === to) return;
    const from = state;
    state = to;
    on_state_change?.(from, to);
    console.log(`[CircuitBreaker:${service_name}] ${from} → ${to}`);
  };

  const on_success = (): void => {
    failure_count = 0;
    transition('closed');
  };

  const on_failure = (): void => {
    failure_count++;
    last_failure_at = Date.now();

    if (failure_count >= failure_threshold) {
      transition('open');
    }
  };

  const execute = async <T>(operation: () => Promise<T>): Promise<T> => {
    // Check if circuit is open
    if (state === 'open') {
      const elapsed = Date.now() - last_failure_at;

      if (elapsed < cooldown_ms) {
        // Still in cooldown — reject immediately
        throw new CircuitOpenError(service_name, last_failure_at + cooldown_ms);
      }

      // Cooldown elapsed — enter half-open state for a test call
      transition('half_open');
    }

    try {
      const result = await operation();
      on_success();
      return result;
    } catch (err) {
      on_failure();
      throw err;
    }
  };

  const get_state = (): CircuitState => state;
  const get_failure_count = (): number => failure_count;

  const reset = (): void => {
    failure_count = 0;
    last_failure_at = 0;
    transition('closed');
  };

  return { execute, get_state, get_failure_count, reset };
};
