// TDD tests for Phase 2: LLM-based contextual PII filtering
// Tests sanitize_contextual_pii() and sanitize_full() functions
// Mocks node:child_process execFile to avoid actual Gemini CLI calls

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as child_process from 'node:child_process';
import { sanitize_contextual_pii, sanitize_full, sanitize_text } from './sanitizer.js';

// === Mock node:child_process.execFile ===
// We use execFile (not exec) to prevent shell injection — see security policy

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    execFile: vi.fn(),
  };
});

const mock_exec_file = vi.mocked(child_process.execFile);

// === Helper: simulate execFile callback behavior ===

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void;

const simulate_gemini_response = (response_text: string) => {
  mock_exec_file.mockImplementation((_cmd: any, _args: any, _opts: any, callback?: any) => {
    // execFile signature: (cmd, args, opts, callback) or (cmd, args, callback)
    const cb: ExecFileCallback = callback ?? _opts;
    process.nextTick(() => cb(null, response_text, ''));
    return {} as any;
  });
};

const simulate_gemini_error = (error_message: string) => {
  mock_exec_file.mockImplementation((_cmd: any, _args: any, _opts: any, callback?: any) => {
    const cb: ExecFileCallback = callback ?? _opts;
    const err = new Error(error_message);
    process.nextTick(() => cb(err, '', error_message));
    return {} as any;
  });
};

const simulate_gemini_timeout = () => {
  mock_exec_file.mockImplementation((_cmd: any, _args: any, _opts: any, callback?: any) => {
    // Simulate AbortController timeout error
    const cb: ExecFileCallback = callback ?? _opts;
    const err = new Error('The operation was aborted');
    (err as any).code = 'ABORT_ERR';
    process.nextTick(() => cb(err, '', ''));
    return {} as any;
  });
};

describe('Sanitizer Phase 2: Contextual PII (LLM-based)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // === sanitize_contextual_pii() ===

  describe('sanitize_contextual_pii()', () => {
    it('should detect and mask contextual PII via Gemini', async () => {
      const input = '서울대 91년생 물리 석사 출신 개발자가 강남에서 일하고 있습니다';
      const gemini_output = '[학력정보 제거됨] [나이정보 제거됨] [학력정보 제거됨] 개발자가 [지역정보 제거됨]에서 일하고 있습니다';

      simulate_gemini_response(gemini_output);

      const result = await sanitize_contextual_pii(input);

      expect(result).toBe(gemini_output);
      expect(mock_exec_file).toHaveBeenCalledTimes(1);
    });

    it('should pass the correct prompt to Gemini CLI', async () => {
      const input = 'GIST 물리학과 석사 출신';
      simulate_gemini_response('[학력정보 제거됨]');

      await sanitize_contextual_pii(input);

      // Verify the first argument is 'gemini' command
      const call_args = mock_exec_file.mock.calls[0];
      expect(call_args[0]).toBe('gemini');
      // Verify args array contains the prompt with the input text
      const args_array = call_args[1] as string[];
      expect(args_array).toBeDefined();
      const full_prompt = args_array.join(' ');
      expect(full_prompt).toContain(input);
    });

    it('should return original text when no contextual PII found', async () => {
      const input = 'K-Startup 창업지원사업 검색 결과 3건';
      simulate_gemini_response(input);

      const result = await sanitize_contextual_pii(input);

      expect(result).toBe(input);
    });

    it('should handle empty text without calling Gemini', async () => {
      const result = await sanitize_contextual_pii('');

      expect(result).toBe('');
      expect(mock_exec_file).not.toHaveBeenCalled();
    });

    it('should handle whitespace-only text without calling Gemini', async () => {
      const result = await sanitize_contextual_pii('   ');

      expect(result).toBe('   ');
      expect(mock_exec_file).not.toHaveBeenCalled();
    });

    it('should fall back to original text when Gemini is unavailable', async () => {
      const input = '서울대 91년생 물리 석사 출신';
      simulate_gemini_error('command not found: gemini');

      const result = await sanitize_contextual_pii(input);

      // Graceful fallback: return original text, do not crash
      expect(result).toBe(input);
    });

    it('should fall back to original text when Gemini returns empty output', async () => {
      const input = 'GIST 물리학과 석사';
      simulate_gemini_response('');

      const result = await sanitize_contextual_pii(input);

      // Empty response is unreliable — keep original
      expect(result).toBe(input);
    });

    it('should fall back to original text on Gemini CLI crash', async () => {
      const input = '서울대 91년생';
      simulate_gemini_error('Segmentation fault');

      const result = await sanitize_contextual_pii(input);

      expect(result).toBe(input);
    });

    it('should handle timeout gracefully', async () => {
      const input = '서울대 91년생 물리 석사 출신';
      simulate_gemini_timeout();

      const result = await sanitize_contextual_pii(input);

      // Timeout should not crash — return original text
      expect(result).toBe(input);
    });

    it('should strip ANSI escape codes from Gemini output', async () => {
      const input = 'GIST 물리학과';
      const ansi_output = '\x1B[32m[학력정보 제거됨]\x1B[0m';
      simulate_gemini_response(ansi_output);

      const result = await sanitize_contextual_pii(input);

      expect(result).toBe('[학력정보 제거됨]');
      expect(result).not.toContain('\x1B');
    });

    it('should handle multi-line input', async () => {
      const input = '학력: 서울대 물리학과 석사\n직장: 강남 IT기업\n나이: 91년생';
      const sanitized = '학력: [학력정보 제거됨]\n직장: [직장정보 제거됨]\n나이: [나이정보 제거됨]';
      simulate_gemini_response(sanitized);

      const result = await sanitize_contextual_pii(input);

      expect(result).toBe(sanitized);
    });
  });

  // === sanitize_full() ===

  describe('sanitize_full()', () => {
    it('should chain regex sanitize + contextual LLM sanitize', async () => {
      const input = '이름: 홍길동, 서울대 91년생 물리 석사, 010-1234-5678';

      // After regex: "이름: [이름 제거됨], 서울대 91년생 물리 석사, [전화번호 제거됨]"
      // Gemini then handles the remaining contextual PII
      const regex_sanitized = sanitize_text(input);
      const gemini_output = regex_sanitized.replace(
        '서울대 91년생 물리 석사',
        '[학력정보 제거됨] [나이정보 제거됨] [학력정보 제거됨]',
      );

      simulate_gemini_response(gemini_output);

      const result = await sanitize_full(input);

      expect(result).not.toContain('홍길동');
      expect(result).not.toContain('010-1234-5678');
      expect(result).toContain('[이름 제거됨]');
      expect(result).toContain('[전화번호 제거됨]');
    });

    it('should still apply regex sanitization even if Gemini fails', async () => {
      const input = '이름: 홍길동, 서울대 91년생 물리 석사, 010-1234-5678';
      simulate_gemini_error('command not found: gemini');

      const result = await sanitize_full(input);

      // Regex PII must still be removed
      expect(result).not.toContain('홍길동');
      expect(result).not.toContain('010-1234-5678');
      expect(result).toContain('[이름 제거됨]');
      expect(result).toContain('[전화번호 제거됨]');
      // Contextual PII remains (Gemini fallback = pass-through)
      expect(result).toContain('서울대 91년생 물리 석사');
    });

    it('should handle text with only regex PII (no contextual)', async () => {
      const input = '연락처: 010-1234-5678, 이메일: test@test.com';
      const regex_result = sanitize_text(input);
      simulate_gemini_response(regex_result);

      const result = await sanitize_full(input);

      expect(result).toContain('[전화번호 제거됨]');
      expect(result).toContain('[이메일 제거됨]');
    });

    it('should handle text with only contextual PII (no regex)', async () => {
      const input = 'KAIST 전산학과 박사 출신 30대 개발자';
      simulate_gemini_response('[학력정보 제거됨] [나이정보 제거됨] 개발자');

      const result = await sanitize_full(input);

      expect(result).toBe('[학력정보 제거됨] [나이정보 제거됨] 개발자');
    });

    it('should handle clean text (no PII at all)', async () => {
      const input = 'K-Startup 창업지원사업 검색 결과 3건';
      simulate_gemini_response(input);

      const result = await sanitize_full(input);

      expect(result).toBe(input);
    });

    it('should handle empty text without calling Gemini', async () => {
      const result = await sanitize_full('');

      expect(result).toBe('');
      expect(mock_exec_file).not.toHaveBeenCalled();
    });
  });
});
