// In-memory pending approval queue for Telegram approval responses
// When the system sends an approval request via Telegram, it registers here.
// When the user replies "네"/"아니오", the telegram command handler checks this queue
// before creating a new task.

// === Types ===

export type PendingApproval = {
  request_id: string;
  description: string;
  registered_at: number; // Date.now()
  timeout_ms: number;
};

export type ApprovalResolution = {
  request_id: string;
  description: string;
  approved: boolean;
  resolved_at: string; // ISO 8601
};

// === Approval pattern matching ===

const APPROVAL_PATTERNS: readonly string[] = [
  '네', 'ㅇㅇ', '승인', 'yes', 'ok', 'ㅇ', '응', '좋아', '허가', 'approve',
] as const;

const REJECTION_PATTERNS: readonly string[] = [
  '아니오', 'ㄴㄴ', '거부', 'no', 'ㄴ', '아니', '거절', 'reject', 'deny',
] as const;

/**
 * Check if a message matches an approval pattern.
 * Returns 'approve' | 'reject' | null
 */
export const match_approval_pattern = (text: string): 'approve' | 'reject' | null => {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return null;

  // Check approval patterns first
  for (const pattern of APPROVAL_PATTERNS) {
    if (normalized === pattern.toLowerCase()) return 'approve';
  }

  // Check rejection patterns
  for (const pattern of REJECTION_PATTERNS) {
    if (normalized === pattern.toLowerCase()) return 'reject';
  }

  return null;
};

// === Queue factory ===

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export const create_pending_approval_queue = () => {
  const queue: PendingApproval[] = [];

  /**
   * Register a new pending approval request.
   * Old expired entries are cleaned up on each registration.
   */
  const register = (
    request_id: string,
    description: string,
    timeout_ms: number = DEFAULT_TIMEOUT_MS,
  ): void => {
    // Clean up expired entries
    const now = Date.now();
    const expired_indices: number[] = [];
    for (let i = 0; i < queue.length; i++) {
      if (now - queue[i].registered_at > queue[i].timeout_ms) {
        expired_indices.push(i);
      }
    }
    // Remove expired from back to front to preserve indices
    for (let i = expired_indices.length - 1; i >= 0; i--) {
      queue.splice(expired_indices[i], 1);
    }

    queue.push({
      request_id,
      description,
      registered_at: now,
      timeout_ms,
    });
  };

  /**
   * Try to resolve the most recent non-expired pending approval.
   * Returns the resolution if found, null if no pending approval exists.
   */
  const resolve = (approved: boolean): ApprovalResolution | null => {
    const now = Date.now();

    // Find the most recent non-expired approval (search from end)
    for (let i = queue.length - 1; i >= 0; i--) {
      const entry = queue[i];
      if (now - entry.registered_at <= entry.timeout_ms) {
        // Found a valid pending approval — remove it from queue
        queue.splice(i, 1);
        return {
          request_id: entry.request_id,
          description: entry.description,
          approved,
          resolved_at: new Date().toISOString(),
        };
      }
    }

    return null;
  };

  /**
   * Check if there are any non-expired pending approvals.
   */
  const has_pending = (): boolean => {
    const now = Date.now();
    return queue.some((entry) => now - entry.registered_at <= entry.timeout_ms);
  };

  /**
   * Get the count of non-expired pending approvals.
   */
  const pending_count = (): number => {
    const now = Date.now();
    return queue.filter((entry) => now - entry.registered_at <= entry.timeout_ms).length;
  };

  /**
   * Clear all pending approvals (for testing or reset).
   */
  const clear = (): void => {
    queue.length = 0;
  };

  return {
    register,
    resolve,
    has_pending,
    pending_count,
    clear,
  };
};

export type PendingApprovalQueue = ReturnType<typeof create_pending_approval_queue>;
