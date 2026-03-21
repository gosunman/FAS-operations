// TDD tests for pending approval queue
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  create_pending_approval_queue,
  match_approval_pattern,
} from './pending_approval_queue.js';

describe('match_approval_pattern', () => {
  describe('approval patterns', () => {
    it.each(['네', 'ㅇㅇ', '승인', 'yes', 'ok', 'ㅇ', '응', '좋아', '허가', 'approve'])(
      'should match "%s" as approve',
      (text) => {
        expect(match_approval_pattern(text)).toBe('approve');
      },
    );

    it('should match case-insensitively', () => {
      expect(match_approval_pattern('YES')).toBe('approve');
      expect(match_approval_pattern('Ok')).toBe('approve');
      expect(match_approval_pattern('APPROVE')).toBe('approve');
    });

    it('should match with surrounding whitespace', () => {
      expect(match_approval_pattern('  네  ')).toBe('approve');
      expect(match_approval_pattern('  yes  ')).toBe('approve');
    });
  });

  describe('rejection patterns', () => {
    it.each(['아니오', 'ㄴㄴ', '거부', 'no', 'ㄴ', '아니', '거절', 'reject', 'deny'])(
      'should match "%s" as reject',
      (text) => {
        expect(match_approval_pattern(text)).toBe('reject');
      },
    );

    it('should match case-insensitively', () => {
      expect(match_approval_pattern('NO')).toBe('reject');
      expect(match_approval_pattern('REJECT')).toBe('reject');
    });
  });

  describe('non-matching patterns', () => {
    it('should return null for unrelated text', () => {
      expect(match_approval_pattern('hello world')).toBeNull();
      expect(match_approval_pattern('태스크 생성해줘')).toBeNull();
      expect(match_approval_pattern('/status')).toBeNull();
    });

    it('should return null for empty/whitespace text', () => {
      expect(match_approval_pattern('')).toBeNull();
      expect(match_approval_pattern('   ')).toBeNull();
    });

    it('should not partial-match longer strings', () => {
      // "네이버" starts with "네" but should NOT match
      expect(match_approval_pattern('네이버')).toBeNull();
      expect(match_approval_pattern('yes please')).toBeNull();
      expect(match_approval_pattern('no thanks')).toBeNull();
    });
  });
});

describe('create_pending_approval_queue', () => {
  let queue: ReturnType<typeof create_pending_approval_queue>;

  beforeEach(() => {
    vi.useFakeTimers();
    queue = create_pending_approval_queue();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('register', () => {
    it('should register a pending approval', () => {
      queue.register('req-1', 'Deploy to production');
      expect(queue.has_pending()).toBe(true);
      expect(queue.pending_count()).toBe(1);
    });

    it('should support multiple pending approvals', () => {
      queue.register('req-1', 'Deploy A');
      queue.register('req-2', 'Deploy B');
      expect(queue.pending_count()).toBe(2);
    });

    it('should clean up expired entries on registration', () => {
      queue.register('req-1', 'Old request', 5000); // 5s timeout
      vi.advanceTimersByTime(6000); // 6s later — expired

      queue.register('req-2', 'New request');
      // req-1 should have been cleaned up
      expect(queue.pending_count()).toBe(1);
    });
  });

  describe('resolve', () => {
    it('should resolve the most recent pending approval as approved', () => {
      queue.register('req-1', 'Deploy to production');
      const result = queue.resolve(true);

      expect(result).not.toBeNull();
      expect(result!.request_id).toBe('req-1');
      expect(result!.description).toBe('Deploy to production');
      expect(result!.approved).toBe(true);
      expect(result!.resolved_at).toBeTruthy();
    });

    it('should resolve the most recent pending approval as rejected', () => {
      queue.register('req-1', 'Deploy to production');
      const result = queue.resolve(false);

      expect(result).not.toBeNull();
      expect(result!.approved).toBe(false);
    });

    it('should return null when no pending approvals exist', () => {
      const result = queue.resolve(true);
      expect(result).toBeNull();
    });

    it('should remove the resolved approval from the queue', () => {
      queue.register('req-1', 'Deploy');
      queue.resolve(true);
      expect(queue.has_pending()).toBe(false);
      expect(queue.pending_count()).toBe(0);
    });

    it('should resolve the most recent approval when multiple exist', () => {
      queue.register('req-1', 'First');
      vi.advanceTimersByTime(1000);
      queue.register('req-2', 'Second');

      const result = queue.resolve(true);
      expect(result!.request_id).toBe('req-2');

      // First one should still be pending
      expect(queue.has_pending()).toBe(true);
      expect(queue.pending_count()).toBe(1);
    });

    it('should not resolve expired approvals', () => {
      queue.register('req-1', 'Old request', 5000); // 5s timeout
      vi.advanceTimersByTime(6000); // 6s later

      const result = queue.resolve(true);
      expect(result).toBeNull();
    });
  });

  describe('has_pending', () => {
    it('should return false when queue is empty', () => {
      expect(queue.has_pending()).toBe(false);
    });

    it('should return true when there are non-expired approvals', () => {
      queue.register('req-1', 'Test');
      expect(queue.has_pending()).toBe(true);
    });

    it('should return false when all approvals have expired', () => {
      queue.register('req-1', 'Test', 5000);
      vi.advanceTimersByTime(6000);
      expect(queue.has_pending()).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all pending approvals', () => {
      queue.register('req-1', 'A');
      queue.register('req-2', 'B');
      queue.clear();
      expect(queue.has_pending()).toBe(false);
      expect(queue.pending_count()).toBe(0);
    });
  });

  describe('default timeout', () => {
    it('should use 10-minute default timeout', () => {
      queue.register('req-1', 'Test'); // default timeout
      vi.advanceTimersByTime(9 * 60 * 1000); // 9 minutes
      expect(queue.has_pending()).toBe(true);

      vi.advanceTimersByTime(2 * 60 * 1000); // 11 minutes total
      expect(queue.has_pending()).toBe(false);
    });
  });
});
