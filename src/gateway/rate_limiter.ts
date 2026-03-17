// Simple in-memory sliding window rate limiter for Hunter API
// No external dependencies — lightweight defense against abuse

export type RateLimiterConfig = {
  window_ms: number;     // Time window in ms (e.g., 60_000 = 1 min)
  max_requests: number;  // Max requests allowed within the window
};

export const create_rate_limiter = (config: RateLimiterConfig) => {
  const timestamps: number[] = [];

  // Check if a new request is allowed within the rate limit
  const is_allowed = (): boolean => {
    const now = Date.now();

    // Evict expired entries outside the sliding window
    while (timestamps.length > 0 && timestamps[0]! <= now - config.window_ms) {
      timestamps.shift();
    }

    // Reject if at capacity
    if (timestamps.length >= config.max_requests) {
      return false;
    }

    // Record this request
    timestamps.push(now);
    return true;
  };

  // Reset all tracked requests (useful for testing)
  const reset = (): void => {
    timestamps.length = 0;
  };

  // Get remaining requests in current window
  const remaining = (): number => {
    const now = Date.now();
    while (timestamps.length > 0 && timestamps[0]! <= now - config.window_ms) {
      timestamps.shift();
    }
    return Math.max(0, config.max_requests - timestamps.length);
  };

  return { is_allowed, reset, remaining };
};

export type RateLimiter = ReturnType<typeof create_rate_limiter>;
