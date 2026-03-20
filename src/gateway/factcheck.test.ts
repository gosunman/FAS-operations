// Factcheck pipeline tests
// Verifies Cross-AI factcheck: Claude ↔ Gemini verification

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  create_factchecker,
  build_factcheck_prompt,
  parse_factcheck_response,
  should_escalate,
} from './factcheck.js';
import type { GeminiConfig } from '../gemini/types.js';

// === Mock spawn_gemini ===
vi.mock('../gemini/cli_wrapper.js', () => ({
  spawn_gemini: vi.fn(),
}));

import { spawn_gemini } from '../gemini/cli_wrapper.js';

const mock_spawn = vi.mocked(spawn_gemini);

const test_config: GeminiConfig = {
  account: 'a',
  timeout_ms: 30_000,
};

// === build_factcheck_prompt ===

describe('build_factcheck_prompt', () => {
  it('should include original content in prompt', () => {
    const prompt = build_factcheck_prompt('The sky is blue.');
    expect(prompt).toContain('The sky is blue.');
    expect(prompt).toContain('JSON');
  });

  it('should include context when provided', () => {
    const prompt = build_factcheck_prompt('Water boils at 100C', 'at sea level');
    expect(prompt).toContain('Water boils at 100C');
    expect(prompt).toContain('at sea level');
  });

  it('should request structured JSON response fields', () => {
    const prompt = build_factcheck_prompt('test');
    expect(prompt).toContain('agreement');
    expect(prompt).toContain('review_summary');
    expect(prompt).toContain('discrepancies');
    expect(prompt).toContain('confidence');
  });
});

// === parse_factcheck_response ===

describe('parse_factcheck_response', () => {
  it('should parse a valid agree response', () => {
    const raw = JSON.stringify({
      agreement: 'agree',
      review_summary: 'All facts verified.',
      discrepancies: [],
      confidence: 0.95,
    });
    const result = parse_factcheck_response(raw);
    expect(result.agreement).toBe('agree');
    expect(result.reviewer).toBe('gemini');
    expect(result.review_summary).toBe('All facts verified.');
    expect(result.discrepancies).toEqual([]);
    expect(result.confidence).toBe(0.95);
    expect(result.should_escalate).toBe(false);
    expect(result.checked_at).toBeTruthy();
  });

  it('should parse a partial agreement response', () => {
    const raw = JSON.stringify({
      agreement: 'partial',
      review_summary: 'Mostly correct but one issue.',
      discrepancies: ['Temperature is approximate'],
      confidence: 0.7,
    });
    const result = parse_factcheck_response(raw);
    expect(result.agreement).toBe('partial');
    expect(result.discrepancies).toEqual(['Temperature is approximate']);
    expect(result.should_escalate).toBe(false);
  });

  it('should parse a disagree response', () => {
    const raw = JSON.stringify({
      agreement: 'disagree',
      review_summary: 'Factually incorrect.',
      discrepancies: ['Wrong date', 'Wrong location'],
      confidence: 0.9,
    });
    const result = parse_factcheck_response(raw);
    expect(result.agreement).toBe('disagree');
    expect(result.should_escalate).toBe(true);
  });

  it('should handle JSON embedded in surrounding text', () => {
    const raw = `Here is my review:\n${JSON.stringify({
      agreement: 'agree',
      review_summary: 'Correct.',
      discrepancies: [],
      confidence: 0.85,
    })}\nEnd of review.`;
    const result = parse_factcheck_response(raw);
    expect(result.agreement).toBe('agree');
    expect(result.confidence).toBe(0.85);
  });

  it('should handle malformed response gracefully', () => {
    const raw = 'This is not JSON at all, just random text.';
    const result = parse_factcheck_response(raw);
    expect(result.agreement).toBe('disagree');
    expect(result.reviewer).toBe('gemini');
    expect(result.confidence).toBe(0);
    expect(result.should_escalate).toBe(true);
    expect(result.review_summary).toContain('Failed to parse');
  });

  it('should handle missing fields with safe defaults', () => {
    const raw = JSON.stringify({ agreement: 'agree' });
    const result = parse_factcheck_response(raw);
    expect(result.agreement).toBe('agree');
    expect(result.review_summary).toBe('');
    expect(result.discrepancies).toEqual([]);
    expect(result.confidence).toBe(0);
  });

  it('should handle invalid agreement value as disagree', () => {
    const raw = JSON.stringify({
      agreement: 'maybe',
      review_summary: 'Not sure.',
      discrepancies: [],
      confidence: 0.5,
    });
    const result = parse_factcheck_response(raw);
    expect(result.agreement).toBe('disagree');
    expect(result.should_escalate).toBe(true);
  });

  it('should handle low confidence as escalation', () => {
    const raw = JSON.stringify({
      agreement: 'agree',
      review_summary: 'Seems right but not sure.',
      discrepancies: [],
      confidence: 0.3,
    });
    const result = parse_factcheck_response(raw);
    expect(result.agreement).toBe('agree');
    expect(result.should_escalate).toBe(true);
  });
});

// === should_escalate ===

describe('should_escalate', () => {
  it('should return true for disagree', () => {
    expect(should_escalate({
      agreement: 'disagree',
      reviewer: 'gemini',
      review_summary: 'Wrong.',
      discrepancies: ['error'],
      confidence: 0.9,
      checked_at: new Date().toISOString(),
      should_escalate: true,
    })).toBe(true);
  });

  it('should return true for low confidence', () => {
    expect(should_escalate({
      agreement: 'agree',
      reviewer: 'gemini',
      review_summary: 'OK.',
      discrepancies: [],
      confidence: 0.4,
      checked_at: new Date().toISOString(),
      should_escalate: true,
    })).toBe(true);
  });

  it('should return false for agree with high confidence', () => {
    expect(should_escalate({
      agreement: 'agree',
      reviewer: 'gemini',
      review_summary: 'Verified.',
      discrepancies: [],
      confidence: 0.9,
      checked_at: new Date().toISOString(),
      should_escalate: false,
    })).toBe(false);
  });

  it('should return false for partial with decent confidence', () => {
    expect(should_escalate({
      agreement: 'partial',
      reviewer: 'gemini',
      review_summary: 'Mostly OK.',
      discrepancies: ['minor issue'],
      confidence: 0.6,
      checked_at: new Date().toISOString(),
      should_escalate: false,
    })).toBe(false);
  });
});

// === create_factchecker (integration) ===

describe('create_factchecker', () => {
  beforeEach(() => {
    mock_spawn.mockReset();
  });

  it('should return agree result for verified content', async () => {
    mock_spawn.mockResolvedValue({
      content: JSON.stringify({
        agreement: 'agree',
        review_summary: 'All facts are correct.',
        discrepancies: [],
        confidence: 0.95,
      }),
      raw_output: '',
      success: true,
      duration_ms: 1000,
    });

    const factchecker = create_factchecker(test_config);
    const result = await factchecker.check({
      original_content: 'Water boils at 100C at sea level.',
      original_author: 'claude',
    });

    expect(result.agreement).toBe('agree');
    expect(result.confidence).toBe(0.95);
    expect(result.should_escalate).toBe(false);
    expect(mock_spawn).toHaveBeenCalledOnce();
  });

  it('should return disagree and escalate for incorrect content', async () => {
    mock_spawn.mockResolvedValue({
      content: JSON.stringify({
        agreement: 'disagree',
        review_summary: 'The claim is factually wrong.',
        discrepancies: ['Earth is not flat'],
        confidence: 0.99,
      }),
      raw_output: '',
      success: true,
      duration_ms: 1500,
    });

    const factchecker = create_factchecker(test_config);
    const result = await factchecker.check({
      original_content: 'The earth is flat.',
      original_author: 'claude',
    });

    expect(result.agreement).toBe('disagree');
    expect(result.should_escalate).toBe(true);
    expect(result.discrepancies).toContain('Earth is not flat');
  });

  it('should handle Gemini CLI failure gracefully', async () => {
    mock_spawn.mockResolvedValue({
      content: '',
      raw_output: '',
      success: false,
      error: 'Gemini CLI exited with code 1',
      duration_ms: 500,
    });

    const factchecker = create_factchecker(test_config);
    const result = await factchecker.check({
      original_content: 'Some claim.',
      original_author: 'claude',
    });

    // CLI failure → treated as malformed → disagree + escalate
    expect(result.agreement).toBe('disagree');
    expect(result.should_escalate).toBe(true);
    expect(result.confidence).toBe(0);
  });

  it('should pass context to the prompt', async () => {
    mock_spawn.mockResolvedValue({
      content: JSON.stringify({
        agreement: 'agree',
        review_summary: 'Correct in context.',
        discrepancies: [],
        confidence: 0.8,
      }),
      raw_output: '',
      success: true,
      duration_ms: 800,
    });

    const factchecker = create_factchecker(test_config);
    await factchecker.check({
      original_content: 'Boiling point varies with altitude.',
      original_author: 'claude',
      context: 'Physics discussion about thermodynamics',
    });

    const called_prompt = mock_spawn.mock.calls[0][1];
    expect(called_prompt).toContain('Physics discussion about thermodynamics');
  });

  it('should use strict_mode wording when enabled', async () => {
    mock_spawn.mockResolvedValue({
      content: JSON.stringify({
        agreement: 'partial',
        review_summary: 'Partially correct.',
        discrepancies: ['Minor inaccuracy'],
        confidence: 0.7,
      }),
      raw_output: '',
      success: true,
      duration_ms: 900,
    });

    const factchecker = create_factchecker(test_config);
    await factchecker.check({
      original_content: 'Some scientific claim.',
      original_author: 'claude',
      strict_mode: true,
    });

    const called_prompt = mock_spawn.mock.calls[0][1];
    expect(called_prompt).toContain('strict');
  });
});
