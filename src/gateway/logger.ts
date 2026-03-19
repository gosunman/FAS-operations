// Gateway logger — adds ISO timestamps and log levels to all output
// Format: [2026-03-19T10:30:45.123Z] [LEVEL] message
// Replaces raw console.log/error/warn calls for time-based log analysis

// Log levels supported by the logger
type LogLevel = 'INFO' | 'WARN' | 'ERROR';

// Logger configuration options
export type LoggerOptions = {
  prefix?: string;  // Optional prefix added before message (e.g., "Gateway")
};

// Logger interface — drop-in replacement for console.log/warn/error
export type Logger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

// Format arguments into a single string
// Handles Error objects, primitives, and objects
const format_args = (args: unknown[]): string =>
  args.map((arg) => {
    if (arg instanceof Error) return String(arg);
    if (typeof arg === 'object' && arg !== null) return JSON.stringify(arg);
    return String(arg);
  }).join(' ');

// Build a formatted log line with timestamp and level
const format_line = (level: LogLevel, prefix: string | undefined, args: unknown[]): string => {
  const timestamp = new Date().toISOString();
  const prefix_part = prefix ? `[${prefix}] ` : '';
  return `[${timestamp}] [${level}] ${prefix_part}${format_args(args)}`;
};

// Create a logger instance
// Usage:
//   const log = create_logger({ prefix: 'Gateway' });
//   log.info('Server started on port', 3100);
//   // → [2026-03-19T10:30:45.123Z] [INFO] [Gateway] Server started on port 3100
export const create_logger = (options: LoggerOptions = {}): Logger => {
  const { prefix } = options;

  return {
    info: (...args: unknown[]) => {
      console.log(format_line('INFO', prefix, args));
    },
    warn: (...args: unknown[]) => {
      console.warn(format_line('WARN', prefix, args));
    },
    error: (...args: unknown[]) => {
      console.error(format_line('ERROR', prefix, args));
    },
  };
};
