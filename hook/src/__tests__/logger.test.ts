import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger } from '../logger.js';
import type { Logger } from '../logger.js';

describe('Logger', () => {
  let consoleSpy: {
    log: ReturnType<typeof vi.spyOn>;
    warn: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
    debug: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(() => {
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a logger with the given prefix', () => {
    const logger = createLogger('test', 'debug');
    expect(logger).toBeDefined();
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  it('logs info messages with correct format', () => {
    const logger = createLogger('watcher', 'debug');
    logger.info('File changed');

    expect(consoleSpy.log).toHaveBeenCalledOnce();
    const output = consoleSpy.log.mock.calls[0][0] as string;
    expect(output).toContain('[popcorn:watcher]');
    expect(output).toContain('INFO');
    expect(output).toContain('File changed');
  });

  it('logs warn messages via console.warn', () => {
    const logger = createLogger('hook', 'debug');
    logger.warn('Something suspicious');

    expect(consoleSpy.warn).toHaveBeenCalledOnce();
    const output = consoleSpy.warn.mock.calls[0][0] as string;
    expect(output).toContain('[popcorn:hook]');
    expect(output).toContain('WARN');
    expect(output).toContain('Something suspicious');
  });

  it('logs error messages via console.error', () => {
    const logger = createLogger('messenger', 'debug');
    logger.error('Connection failed');

    expect(consoleSpy.error).toHaveBeenCalledOnce();
    const output = consoleSpy.error.mock.calls[0][0] as string;
    expect(output).toContain('[popcorn:messenger]');
    expect(output).toContain('ERROR');
    expect(output).toContain('Connection failed');
  });

  it('logs debug messages via console.debug', () => {
    const logger = createLogger('client', 'debug');
    logger.debug('Polling inbox');

    expect(consoleSpy.debug).toHaveBeenCalledOnce();
    const output = consoleSpy.debug.mock.calls[0][0] as string;
    expect(output).toContain('[popcorn:client]');
    expect(output).toContain('DEBUG');
    expect(output).toContain('Polling inbox');
  });

  it('includes structured data as JSON when provided', () => {
    const logger = createLogger('hook', 'debug');
    logger.info('File changed', { file: 'Login.tsx', hasMarker: true });

    const output = consoleSpy.log.mock.calls[0][0] as string;
    expect(output).toContain('"file":"Login.tsx"');
    expect(output).toContain('"hasMarker":true');
  });

  it('omits data section when no data is provided', () => {
    const logger = createLogger('hook', 'debug');
    logger.info('Simple message');

    const output = consoleSpy.log.mock.calls[0][0] as string;
    // Should not contain JSON braces for data
    expect(output).toBe('[popcorn:hook] INFO Simple message');
  });

  it('respects minimum log level - filters out debug when level is info', () => {
    const logger = createLogger('hook', 'info');
    logger.debug('Should be hidden');
    logger.info('Should be visible');

    expect(consoleSpy.debug).not.toHaveBeenCalled();
    expect(consoleSpy.log).toHaveBeenCalledOnce();
  });

  it('respects minimum log level - filters out info and debug when level is warn', () => {
    const logger = createLogger('hook', 'warn');
    logger.debug('Hidden');
    logger.info('Also hidden');
    logger.warn('Visible');
    logger.error('Also visible');

    expect(consoleSpy.debug).not.toHaveBeenCalled();
    expect(consoleSpy.log).not.toHaveBeenCalled();
    expect(consoleSpy.warn).toHaveBeenCalledOnce();
    expect(consoleSpy.error).toHaveBeenCalledOnce();
  });

  it('error level only allows error messages', () => {
    const logger = createLogger('hook', 'error');
    logger.debug('Hidden');
    logger.info('Hidden');
    logger.warn('Hidden');
    logger.error('Visible');

    expect(consoleSpy.debug).not.toHaveBeenCalled();
    expect(consoleSpy.log).not.toHaveBeenCalled();
    expect(consoleSpy.warn).not.toHaveBeenCalled();
    expect(consoleSpy.error).toHaveBeenCalledOnce();
  });

  it('handles empty data object gracefully', () => {
    const logger = createLogger('hook', 'debug');
    logger.info('Message', {});

    const output = consoleSpy.log.mock.calls[0][0] as string;
    // Empty object should not produce a JSON suffix
    expect(output).toBe('[popcorn:hook] INFO Message');
  });
});
