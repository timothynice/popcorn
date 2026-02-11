/**
 * Structured logger for the Popcorn hook.
 * Provides leveled logging with a [popcorn:<prefix>] tag and optional
 * structured data. Output goes to stdout/stderr via console methods.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

/** Numeric priorities for level comparison. */
const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** Minimum log level. Defaults to 'info'; override via POPCORN_LOG_LEVEL env var. */
function getMinLevel(): LogLevel {
  const env =
    typeof process !== 'undefined'
      ? (process.env?.POPCORN_LOG_LEVEL ?? '').toLowerCase()
      : '';
  if (env === 'debug' || env === 'info' || env === 'warn' || env === 'error') {
    return env;
  }
  return 'info';
}

/**
 * Format a log entry as a single string.
 * Structure: `[popcorn:<prefix>] <level> <message>  { key: value, ... }`
 */
function formatEntry(
  prefix: string,
  level: LogLevel,
  msg: string,
  data?: Record<string, unknown>,
): string {
  const tag = `[popcorn:${prefix}]`;
  const base = `${tag} ${level.toUpperCase()} ${msg}`;
  if (data && Object.keys(data).length > 0) {
    return `${base}  ${JSON.stringify(data)}`;
  }
  return base;
}

/**
 * Creates a logger instance with the given prefix.
 * Messages below the minimum log level are silently dropped.
 *
 * @param prefix - Short identifier prepended to every log line (e.g. 'watcher', 'messenger').
 * @param minLevelOverride - Optional override for the minimum log level (useful in tests).
 */
export function createLogger(prefix: string, minLevelOverride?: LogLevel): Logger {
  const minLevel = minLevelOverride ?? getMinLevel();
  const minPriority = LEVEL_PRIORITY[minLevel];

  function shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= minPriority;
  }

  return {
    debug(msg: string, data?: Record<string, unknown>): void {
      if (!shouldLog('debug')) return;
      console.debug(formatEntry(prefix, 'debug', msg, data));
    },

    info(msg: string, data?: Record<string, unknown>): void {
      if (!shouldLog('info')) return;
      console.log(formatEntry(prefix, 'info', msg, data));
    },

    warn(msg: string, data?: Record<string, unknown>): void {
      if (!shouldLog('warn')) return;
      console.warn(formatEntry(prefix, 'warn', msg, data));
    },

    error(msg: string, data?: Record<string, unknown>): void {
      if (!shouldLog('error')) return;
      console.error(formatEntry(prefix, 'error', msg, data));
    },
  };
}
