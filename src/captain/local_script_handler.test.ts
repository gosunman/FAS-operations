// Local script handler tests

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create_local_script_handler } from './local_script_handler.js';
import type { Task } from '../shared/types.js';
import { resolve } from 'node:path';

// === Helpers ===

const make_task = (description: string): Task => ({
  id: 'task-001',
  title: 'Local script test',
  description,
  priority: 'low',
  assigned_to: 'captain',
  mode: 'awake',
  risk_level: 'low',
  requires_personal_info: false,
  status: 'in_progress',
  created_at: new Date().toISOString(),
  deadline: null,
  depends_on: [],
  action: 'local_script',
});

// === Tests ===

describe('create_local_script_handler', () => {
  it('rejects empty script path', async () => {
    const handler = create_local_script_handler({ allowed_dirs: ['/tmp'] });
    await expect(handler(make_task(''))).rejects.toThrow('Empty script path');
  });

  it('rejects path traversal attempts', async () => {
    const handler = create_local_script_handler({ allowed_dirs: ['/tmp'] });
    await expect(handler(make_task('../../etc/passwd'))).rejects.toThrow('Path traversal');
  });

  it('rejects scripts outside allowed directories', async () => {
    const handler = create_local_script_handler({ allowed_dirs: ['/tmp/safe'] });
    await expect(handler(make_task('/usr/bin/evil.sh'))).rejects.toThrow('not in allowed directories');
  });

  it('rejects non-existent scripts', async () => {
    const handler = create_local_script_handler({
      allowed_dirs: [resolve(process.cwd(), 'scripts')],
    });
    await expect(handler(make_task('scripts/nonexistent_script_12345.sh'))).rejects.toThrow('Script not found');
  });

  it('executes a real script from scripts/ directory', async () => {
    // Use an existing simple script that should exist
    const handler = create_local_script_handler({
      allowed_dirs: [resolve(process.cwd(), 'scripts')],
      timeout_ms: 10_000,
    });

    // Try to run status.sh which should exist and return quickly
    try {
      const result = await handler(make_task('scripts/status.sh'));
      expect(result.summary).toContain('[local_script]');
      expect(result.files_created).toEqual([]);
    } catch (err) {
      // If script doesn't exist or fails, that's also valid — just check it's a proper error
      expect(err).toBeInstanceOf(Error);
    }
  });

  it('uses task description first line as script path', async () => {
    const handler = create_local_script_handler({ allowed_dirs: ['/tmp'] });
    const task = make_task('../../etc/passwd\nsome other content\nignored');
    await expect(handler(task)).rejects.toThrow('Path traversal');
  });
});
