// Gemini CLI wrapper module for FAS
// Spawns Gemini CLI as child process with timeout, retry, and output parsing
// Used by: cross-approval verification, research tasks, fact-checking

import { spawn } from 'node:child_process';
import { execSync } from 'node:child_process';
import type { GeminiAccount, GeminiConfig, GeminiResponse, GeminiSessionStatus } from './types.js';

// === Constants ===

const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes
const DEFAULT_GEMINI_COMMAND = 'gemini';

const SESSION_NAMES: Record<GeminiAccount, string> = {
  a: 'fas-gemini-a',
  b: 'fas-gemini-b',
};

// === Get CLI command for a specific account ===

export const get_gemini_command = (account: GeminiAccount, base_command?: string): string => {
  const cmd = base_command ?? DEFAULT_GEMINI_COMMAND;
  // Account-specific config directories allow multiple Gemini accounts
  // Account A uses default config, Account B uses alternate config dir
  if (account === 'b') {
    return `GEMINI_CONFIG_DIR=$HOME/.gemini-b ${cmd}`;
  }
  return cmd;
};

// === Parse Gemini CLI output ===

export const parse_gemini_response = (raw_output: string): string => {
  // Remove ANSI escape codes
  const cleaned = raw_output.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').trim();

  // Try to extract JSON if present
  const json_match = cleaned.match(/\{[\s\S]*\}/);
  if (json_match) {
    try {
      const parsed = JSON.parse(json_match[0]);
      return JSON.stringify(parsed, null, 2);
    } catch {
      // Not valid JSON, return cleaned text
    }
  }

  return cleaned;
};

// === Spawn Gemini CLI and capture output ===

export const spawn_gemini = (config: GeminiConfig, prompt: string): Promise<GeminiResponse> => {
  const timeout_ms = config.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  const command = config.gemini_command ?? DEFAULT_GEMINI_COMMAND;
  const start_time = Date.now();

  return new Promise((resolve) => {
    const args = [prompt];
    if (config.model) {
      args.unshift('--model', config.model);
    }

    // For account B, set alternate config directory
    const env = { ...process.env };
    if (config.account === 'b') {
      env.GEMINI_CONFIG_DIR = `${process.env.HOME}/.gemini-b`;
    }

    const proc = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
      shell: true,
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
      const duration_ms = Date.now() - start_time;

      if (code === 0) {
        resolve({
          content: parse_gemini_response(stdout),
          raw_output: stdout,
          success: true,
          duration_ms,
        });
      } else {
        resolve({
          content: '',
          raw_output: stdout,
          success: false,
          error: `Gemini CLI exited with code ${code}: ${stderr.trim()}`,
          duration_ms,
        });
      }
    });

    proc.on('error', (err) => {
      const duration_ms = Date.now() - start_time;
      resolve({
        content: '',
        raw_output: '',
        success: false,
        error: `Failed to spawn Gemini CLI: ${err.message}`,
        duration_ms,
      });
    });
  });
};

// === Check tmux session status for a Gemini account ===

export const check_session_status = (account: GeminiAccount): GeminiSessionStatus => {
  const session_name = SESSION_NAMES[account];

  try {
    const output = execSync(`tmux has-session -t ${session_name} 2>&1 || true`, {
      encoding: 'utf-8',
      timeout: 5000,
    });

    // tmux has-session returns empty string on success, error message on failure
    if (output.trim() === '' || !output.includes('no server') && !output.includes("can't find")) {
      // Session exists, check if process is alive
      try {
        const pane_pid = execSync(
          `tmux list-panes -t ${session_name} -F '#{pane_pid}' 2>/dev/null`,
          { encoding: 'utf-8', timeout: 5000 },
        ).trim();

        if (pane_pid) {
          return 'running';
        }
      } catch {
        return 'crashed';
      }
    }

    return 'stopped';
  } catch {
    return 'stopped';
  }
};

// === Get session name for account ===

export const get_session_name = (account: GeminiAccount): string => SESSION_NAMES[account];
