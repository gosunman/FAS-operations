// Cross-AI factcheck pipeline for FAS
// One AI's output is verified by another (Claude ↔ Gemini)
// Uses Gemini CLI to verify content produced by Claude (or vice versa)
// Secure by default: malformed/failed responses → disagree + escalate

import { spawn_gemini } from '../gemini/cli_wrapper.js';
import type { GeminiConfig } from '../gemini/types.js';

// === Types ===

export type FactcheckRequest = {
  original_content: string;
  original_author: 'claude' | 'gemini';
  context?: string;
  strict_mode?: boolean;
};

export type FactcheckResult = {
  agreement: 'agree' | 'partial' | 'disagree';
  reviewer: 'claude' | 'gemini';
  review_summary: string;
  discrepancies: string[];
  confidence: number;
  checked_at: string;
  should_escalate: boolean;
};

// === Constants ===

const VALID_AGREEMENTS = new Set(['agree', 'partial', 'disagree']);
const ESCALATION_CONFIDENCE_THRESHOLD = 0.5;

// === Build the factcheck prompt for Gemini to verify content ===

export const build_factcheck_prompt = (content: string, context?: string, strict_mode?: boolean): string => {
  const context_section = context
    ? `\nAdditional context: ${context}`
    : '';

  const strictness = strict_mode
    ? `\nApply strict verification: flag any claim that is not fully supported by well-established facts. Err on the side of caution — mark as "partial" or "disagree" if uncertain.`
    : '';

  return `You are a factcheck reviewer for the FAS (Fully Automation System).
Your job is to verify the factual accuracy of content produced by another AI.
Respond with ONLY a JSON object (no markdown fences, no surrounding text).
${strictness}
Content to verify:
${content}
${context_section}
Respond in this exact JSON format:
{
  "agreement": "agree" | "partial" | "disagree",
  "review_summary": "brief summary of your review",
  "discrepancies": ["list of specific factual issues found, empty if none"],
  "confidence": 0.0 to 1.0
}

Rules:
- "agree" = all claims are factually correct
- "partial" = mostly correct but some claims are inaccurate or unverifiable
- "disagree" = significant factual errors found
- confidence = how confident you are in YOUR review (not in the original content)`;
};

// === Parse Gemini's factcheck response into structured result ===

export const parse_factcheck_response = (raw: string): FactcheckResult => {
  const now = new Date().toISOString();

  // Try to extract JSON from the response (Gemini may add surrounding text)
  const json_match = raw.match(/\{[\s\S]*\}/);
  if (!json_match) {
    return make_error_result(now, `Failed to parse factcheck response: no JSON found in "${raw.slice(0, 100)}"`);
  }

  try {
    const parsed = JSON.parse(json_match[0]) as Record<string, unknown>;

    // Validate agreement field
    const agreement_raw = parsed.agreement;
    const agreement = VALID_AGREEMENTS.has(agreement_raw as string)
      ? (agreement_raw as FactcheckResult['agreement'])
      : 'disagree'; // invalid value → treat as disagree (secure by default)

    const confidence = typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0;

    const review_summary = typeof parsed.review_summary === 'string'
      ? parsed.review_summary
      : '';

    const discrepancies = Array.isArray(parsed.discrepancies)
      ? parsed.discrepancies.filter((d): d is string => typeof d === 'string')
      : [];

    const escalate = agreement === 'disagree' || confidence < ESCALATION_CONFIDENCE_THRESHOLD;

    return {
      agreement,
      reviewer: 'gemini',
      review_summary,
      discrepancies,
      confidence,
      checked_at: now,
      should_escalate: escalate,
    };
  } catch {
    return make_error_result(now, `Failed to parse factcheck response: invalid JSON in "${raw.slice(0, 100)}"`);
  }
};

// === Determine if a factcheck result should be escalated to human review ===

export const should_escalate = (result: FactcheckResult): boolean =>
  result.agreement === 'disagree' || result.confidence < ESCALATION_CONFIDENCE_THRESHOLD;

// === Factory: create factchecker with bound Gemini config ===

export const create_factchecker = (gemini_config: GeminiConfig) => {
  // Full pipeline: build prompt → call Gemini → parse response
  const check = async (request: FactcheckRequest): Promise<FactcheckResult> => {
    const prompt = build_factcheck_prompt(
      request.original_content,
      request.context,
      request.strict_mode,
    );

    const response = await spawn_gemini(gemini_config, prompt);

    if (!response.success) {
      const now = new Date().toISOString();
      return make_error_result(now, `Gemini CLI failed: ${response.error ?? 'unknown error'}`);
    }

    return parse_factcheck_response(response.content);
  };

  return {
    check,
    parse_response: parse_factcheck_response,
    should_escalate,
  };
};

// === Helper: create an error/fallback result (secure by default) ===

const make_error_result = (checked_at: string, message: string): FactcheckResult => ({
  agreement: 'disagree',
  reviewer: 'gemini',
  review_summary: message,
  discrepancies: [],
  confidence: 0,
  checked_at,
  should_escalate: true,
});
