// Cross-approval module for FAS
// Requests approval from Gemini CLI for MID-risk actions
// Auto-rejects on timeout or parse failure (secure by default)

import { spawn } from 'node:child_process';
import type { CrossApprovalResult, CrossApprovalConfig } from '../shared/types.js';

const DEFAULT_TIMEOUT_MS = 600_000; // 10 minutes
const DEFAULT_GEMINI_COMMAND = 'gemini';

// === Build the prompt for Gemini to evaluate an action ===

const build_prompt = (action: string, context: string): string =>
  `You are a security reviewer for the FAS (Fully Automation System).
Evaluate the following action and respond with ONLY a JSON object (no markdown, no explanation).

Action: ${action}
Context: ${context}

Respond in this exact JSON format:
{"decision": "approved" | "rejected", "reason": "one sentence explanation"}`;

// === Execute Gemini CLI and capture stdout ===

const exec_gemini = (command: string, prompt: string, timeout_ms: number): Promise<string> => {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, [prompt], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeout_ms,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Gemini CLI exited with code ${code}: ${stderr.trim()}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
};

// === Parse Gemini response JSON ===

const parse_response = (raw: string): { decision: 'approved' | 'rejected'; reason: string } => {
  // Try to extract JSON from the response (Gemini may add surrounding text)
  const json_match = raw.match(/\{[\s\S]*"decision"[\s\S]*\}/);
  if (!json_match) {
    throw new Error(`No JSON found in Gemini response: ${raw.slice(0, 200)}`);
  }

  const parsed = JSON.parse(json_match[0]) as Record<string, unknown>;

  if (parsed.decision !== 'approved' && parsed.decision !== 'rejected') {
    throw new Error(`Invalid decision value: ${String(parsed.decision)}`);
  }

  return {
    decision: parsed.decision,
    reason: typeof parsed.reason === 'string' ? parsed.reason : 'No reason provided',
  };
};

// === Factory: create cross-approval client ===

export const create_cross_approval = (config: CrossApprovalConfig = {}) => {
  const gemini_command = config.gemini_command ?? DEFAULT_GEMINI_COMMAND;
  const timeout_ms = config.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  const auto_reject = config.auto_reject_on_error ?? true;

  const request_approval = async (
    action: string,
    context: string,
  ): Promise<CrossApprovalResult> => {
    const prompt = build_prompt(action, context);

    try {
      const raw = await exec_gemini(gemini_command, prompt, timeout_ms);
      const { decision, reason } = parse_response(raw);

      return {
        decision,
        reason,
        reviewed_by: 'gemini_a',
        reviewed_at: new Date().toISOString(),
      };
    } catch (err) {
      const error_msg = err instanceof Error ? err.message : String(err);
      console.warn(`[CrossApproval] Error: ${error_msg}`);

      if (auto_reject) {
        return {
          decision: 'rejected',
          reason: `Auto-rejected due to error: ${error_msg}`,
          reviewed_by: 'system',
          reviewed_at: new Date().toISOString(),
        };
      }

      throw err;
    }
  };

  return { request_approval };
};

export type CrossApproval = ReturnType<typeof create_cross_approval>;
