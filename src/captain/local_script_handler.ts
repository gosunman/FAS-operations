// Local script executor for Captain Worker
// Runs bash/python scripts specified in task description from allowed directories only.
// Security: path traversal blocked, only whitelisted directories allowed, timeout enforced.

import { execFile } from 'node:child_process';
import { resolve, dirname, isAbsolute } from 'node:path';
import { existsSync } from 'node:fs';
import type { CaptainActionHandler } from './captain_worker.js';

// === Types ===

export type LocalScriptConfig = {
  allowed_dirs: string[];    // Only scripts in these directories can be executed
  timeout_ms?: number;       // Max execution time per script (default: 120s)
};

// === Security validation ===

// Ensure script path is within allowed directories and has no traversal
const validate_script_path = (script_path: string, allowed_dirs: string[]): { valid: boolean; reason?: string } => {
  if (!script_path || script_path.trim().length === 0) {
    return { valid: false, reason: 'Empty script path' };
  }

  // Block path traversal
  if (script_path.includes('..')) {
    return { valid: false, reason: 'Path traversal detected (..)' };
  }

  // Resolve to absolute path
  const abs_path = isAbsolute(script_path) ? script_path : resolve(process.cwd(), script_path);

  // Check that the script is within an allowed directory
  const in_allowed_dir = allowed_dirs.some((dir) => {
    const abs_dir = isAbsolute(dir) ? dir : resolve(process.cwd(), dir);
    return abs_path.startsWith(abs_dir + '/') || abs_path === abs_dir;
  });

  if (!in_allowed_dir) {
    return { valid: false, reason: `Script not in allowed directories: ${allowed_dirs.join(', ')}` };
  }

  // Check file exists
  if (!existsSync(abs_path)) {
    return { valid: false, reason: `Script not found: ${abs_path}` };
  }

  return { valid: true };
};

// Determine the interpreter based on file extension
const get_interpreter = (script_path: string): string => {
  if (script_path.endsWith('.py')) return 'python3';
  if (script_path.endsWith('.ts')) return 'npx';
  return 'bash';
};

// Get args for the interpreter
const get_interpreter_args = (script_path: string): string[] => {
  if (script_path.endsWith('.ts')) return ['tsx', script_path];
  return [script_path];
};

// === Factory ===

export const create_local_script_handler = (config: LocalScriptConfig): CaptainActionHandler => {
  const { allowed_dirs, timeout_ms = 120_000 } = config;

  return async (task) => {
    // Script path comes from task description (first line)
    const script_path = (task.description ?? '').split('\n')[0].trim();

    // Validate security
    const validation = validate_script_path(script_path, allowed_dirs);
    if (!validation.valid) {
      throw new Error(`Script validation failed: ${validation.reason}`);
    }

    const abs_path = isAbsolute(script_path) ? script_path : resolve(process.cwd(), script_path);
    const interpreter = get_interpreter(abs_path);
    const args = get_interpreter_args(abs_path);

    // Execute script with timeout
    const output = await new Promise<string>((resolve_promise, reject) => {
      const child = execFile(interpreter, args, {
        timeout: timeout_ms,
        maxBuffer: 10 * 1024 * 1024, // 10MB output buffer
        cwd: dirname(abs_path),
      }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Script failed (exit ${error.code ?? 'unknown'}): ${stderr || error.message}`));
          return;
        }
        resolve_promise(stdout + (stderr ? `\n[STDERR]\n${stderr}` : ''));
      });
    });

    // Truncate output for summary (max 2000 chars)
    const summary = output.length > 2000
      ? output.slice(0, 2000) + `\n... (truncated, total ${output.length} chars)`
      : output;

    return {
      summary: `[local_script] ${script_path}\n${summary}`,
      files_created: [],
    };
  };
};
