// Gemini CLI Fallback for FAS Daemon
//
// When Claude Code (Captain) is unavailable due to rate limits or quota
// exhaustion, this module provides emergency processing capabilities
// via the Gemini CLI. It wraps the existing Gemini CLI wrapper with
// captain-specific context and fallback behavior.
//
// Capabilities in fallback mode:
//   - Respond to owner's Telegram/Slack messages
//   - Review hunter task results (summarize, flag issues)
//   - Process simple code review requests
//   - Forward urgent alerts
//
// Security:
//   - Gemini does NOT receive personal information or secrets
//   - All prompts include a "fallback captain" system context
//   - Results are clearly marked as coming from Gemini (not Claude)

import { spawn_gemini } from '../gemini/cli_wrapper.js';
import type { GeminiConfig, GeminiResponse } from '../gemini/types.js';

// === Configuration ===

export type GeminiFallbackConfig = {
  timeout_ms?: number;          // Timeout per Gemini call (default: 120_000)
  model?: string;               // Gemini model override
  gemini_command?: string;      // CLI command override
};

// === Constants ===

const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes
const LOG_PREFIX = '[GeminiFallback]';

// System context injected into every fallback prompt
const FALLBACK_SYSTEM_CONTEXT = `You are acting as a temporary fallback for the FAS (Fully Automation System) Captain.
The primary AI (Claude Code) is currently unavailable due to rate limits.
Your role:
- Respond helpfully to the owner's messages in Korean
- Summarize task results concisely
- Flag any security or quality issues
- Do NOT make major decisions or code changes
- Clearly state that you are Gemini acting as a fallback
- Keep responses concise and actionable`;

// === Factory ===

export const create_gemini_fallback = (config?: GeminiFallbackConfig) => {
  const timeout_ms = config?.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  const model = config?.model;
  const gemini_command = config?.gemini_command;

  // Build GeminiConfig for the CLI wrapper
  const build_gemini_config = (): GeminiConfig => ({
    account: 'a',
    timeout_ms,
    model,
    gemini_command,
  });

  // === Core: send prompt to Gemini CLI ===

  /** Send a prompt with FAS fallback context to Gemini CLI */
  const send_prompt = async (user_prompt: string): Promise<GeminiResponse> => {
    const full_prompt = `${FALLBACK_SYSTEM_CONTEXT}\n\n---\n\nUser message:\n${user_prompt}`;
    const gemini_config = build_gemini_config();

    try {
      const response = await spawn_gemini(gemini_config, full_prompt);
      return response;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${LOG_PREFIX} Gemini CLI error: ${msg}`);
      return {
        content: '',
        raw_output: '',
        success: false,
        error: msg,
        duration_ms: 0,
      };
    }
  };

  // === Public API ===

  /** Process an owner's message via Gemini CLI */
  const process_message = async (message: string): Promise<GeminiResponse> => {
    console.log(`${LOG_PREFIX} Processing message via Gemini fallback`);
    return send_prompt(message);
  };

  /** Review a hunter task result and provide a summary */
  const review_task_result = async (
    task_id: string,
    title: string,
    result: string,
  ): Promise<GeminiResponse> => {
    const review_prompt = [
      `Review the following FAS Hunter task result:`,
      ``,
      `Task ID: ${task_id}`,
      `Title: ${title}`,
      ``,
      `Result:`,
      result,
      ``,
      `Please provide:`,
      `1. A concise summary (2-3 sentences)`,
      `2. Any quality or security concerns`,
      `3. Whether the result looks complete`,
    ].join('\n');

    console.log(`${LOG_PREFIX} Reviewing task ${task_id} via Gemini`);
    return send_prompt(review_prompt);
  };

  /** Check if Gemini CLI is available by running a simple test */
  const is_available = async (): Promise<boolean> => {
    try {
      const response = await spawn_gemini(
        { ...build_gemini_config(), timeout_ms: 15_000 },
        'Respond with OK',
      );
      return response.success;
    } catch {
      return false;
    }
  };

  return {
    process_message,
    review_task_result,
    is_available,
  };
};

export type GeminiFallback = ReturnType<typeof create_gemini_fallback>;
