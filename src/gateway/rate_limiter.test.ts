// TDD tests for rate limiter
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { create_rate_limiter } from './rate_limiter.js';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should allow requests within the limit', () => {
    // Given
    const limiter = create_rate_limiter({ window_ms: 60_000, max_requests: 3 });

    // When / Then
    expect(limiter.is_allowed()).toBe(true);
    expect(limiter.is_allowed()).toBe(true);
    expect(limiter.is_allowed()).toBe(true);
  });

  it('should reject requests exceeding the limit', () => {
    // Given
    const limiter = create_rate_limiter({ window_ms: 60_000, max_requests: 2 });

    // When
    limiter.is_allowed(); // 1st
    limiter.is_allowed(); // 2nd

    // Then
    expect(limiter.is_allowed()).toBe(false); // 3rd — rejected
  });

  it('should allow requests again after the window expires', () => {
    // Given
    const limiter = create_rate_limiter({ window_ms: 1_000, max_requests: 1 });
    limiter.is_allowed(); // 1st — allowed

    // When — advance past the window
    vi.advanceTimersByTime(1_001);

    // Then — should allow again
    expect(limiter.is_allowed()).toBe(true);
  });

  it('should track remaining requests', () => {
    // Given
    const limiter = create_rate_limiter({ window_ms: 60_000, max_requests: 3 });

    // When / Then
    expect(limiter.remaining()).toBe(3);
    limiter.is_allowed();
    expect(limiter.remaining()).toBe(2);
    limiter.is_allowed();
    expect(limiter.remaining()).toBe(1);
    limiter.is_allowed();
    expect(limiter.remaining()).toBe(0);
  });

  it('should reset all tracked requests', () => {
    // Given
    const limiter = create_rate_limiter({ window_ms: 60_000, max_requests: 1 });
    limiter.is_allowed();
    expect(limiter.is_allowed()).toBe(false);

    // When
    limiter.reset();

    // Then
    expect(limiter.is_allowed()).toBe(true);
  });
});
