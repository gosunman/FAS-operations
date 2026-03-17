// Simple file + console logger for Hunter agent
// Logs to: console + {log_dir}/hunter_{date}.log

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export type Logger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
};

const get_log_file_path = (log_dir: string): string => {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return join(log_dir, `hunter_${date}.log`);
};

const format_line = (level: string, msg: string): string => {
  const ts = new Date().toISOString();
  return `[${ts}] [${level.toUpperCase()}] ${msg}`;
};

export const create_logger = (log_dir: string): Logger => {
  mkdirSync(log_dir, { recursive: true });

  const write = (level: string, msg: string) => {
    const line = format_line(level, msg);

    // Console output
    if (level === 'error') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }

    // File output
    try {
      appendFileSync(get_log_file_path(log_dir), line + '\n');
    } catch {
      // Silently ignore file write errors — console is still working
    }
  };

  return {
    info: (msg) => write('info', msg),
    warn: (msg) => write('warn', msg),
    error: (msg) => write('error', msg),
  };
};
