// Feedback extractor for FAS Captain
// Extracts lessons learned from completed tasks via Gemini CLI
// Fire-and-forget: failures only log warnings, never block task completion

import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';

// === Configuration ===

export type FeedbackExtractorConfig = {
  gemini_command?: string;    // CLI command (default: 'gemini')
  feedback_path: string;      // Path to Doctrine feedback file (append)
  timeout_ms?: number;        // Gemini timeout (default: 60_000 = 1 min)
};

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_GEMINI_COMMAND = 'gemini';

// === Execute Gemini CLI ===

const exec_gemini = (command: string, prompt: string, timeout_ms: number): Promise<string> => {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, [prompt], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeout_ms,
    });

    let stdout = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Gemini CLI exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
};

// === Factory ===

export const create_feedback_extractor = (config: FeedbackExtractorConfig) => {
  const gemini_command = config.gemini_command ?? DEFAULT_GEMINI_COMMAND;
  const timeout_ms = config.timeout_ms ?? DEFAULT_TIMEOUT_MS;

  // Extract a one-sentence lesson from a completed task
  const extract = async (task_title: string, output_summary: string): Promise<void> => {
    const prompt =
      `Task: "${task_title}"\nResult: "${output_summary}"\n\n` +
      `이 작업에서 얻은 교훈을 한 문장으로 요약하세요. 한국어로 답변하세요.`;

    try {
      const lesson = await exec_gemini(gemini_command, prompt, timeout_ms);

      if (lesson.length > 0 && lesson.length < 500) {
        const timestamp = new Date().toISOString().split('T')[0];
        const entry = `\n- [${timestamp}] ${task_title}: ${lesson}`;
        appendFileSync(config.feedback_path, entry, 'utf-8');
      } else {
        console.warn(`[FeedbackExtractor] Unexpected response length (${lesson.length}), skipping`);
      }
    } catch (err) {
      // Non-critical: log and continue
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[FeedbackExtractor] Failed to extract feedback: ${msg}`);
    }
  };

  return { extract };
};

export type FeedbackExtractor = ReturnType<typeof create_feedback_extractor>;
