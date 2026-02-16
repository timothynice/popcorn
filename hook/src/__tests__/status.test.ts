import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runStatus, formatUptime } from '../commands/status.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'popcorn-status-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('formatUptime', () => {
  it('formats seconds', () => {
    expect(formatUptime(5000)).toBe('5s');
    expect(formatUptime(45000)).toBe('45s');
  });

  it('formats minutes and seconds', () => {
    expect(formatUptime(90_000)).toBe('1m 30s');
    expect(formatUptime(300_000)).toBe('5m 0s');
  });

  it('formats hours and minutes', () => {
    expect(formatUptime(3_600_000)).toBe('1h 0m');
    expect(formatUptime(5_400_000)).toBe('1h 30m');
  });
});

describe('runStatus', () => {
  it('returns not running when no bridge.json exists', async () => {
    const result = await runStatus(tmpDir);
    expect(result.running).toBe(false);
    expect(result.pid).toBeUndefined();
  });

  it('returns not running when PID in bridge.json is dead', async () => {
    const popcornDir = path.join(tmpDir, '.popcorn');
    await fs.mkdir(popcornDir, { recursive: true });
    await fs.writeFile(
      path.join(popcornDir, 'bridge.json'),
      JSON.stringify({ port: 7891, token: 'abc', pid: 999999, startedAt: '2025-01-01T00:00:00Z' }),
    );

    const result = await runStatus(tmpDir);
    expect(result.running).toBe(false);
    expect(result.pid).toBe(999999);
    expect(result.port).toBe(7891);
  });

  it('returns running with uptime when PID is alive', async () => {
    const popcornDir = path.join(tmpDir, '.popcorn');
    await fs.mkdir(popcornDir, { recursive: true });
    const startedAt = new Date(Date.now() - 60_000).toISOString(); // 1 minute ago
    await fs.writeFile(
      path.join(popcornDir, 'bridge.json'),
      JSON.stringify({ port: 7892, token: 'abc', pid: process.pid, startedAt }),
    );

    const result = await runStatus(tmpDir);
    expect(result.running).toBe(true);
    expect(result.pid).toBe(process.pid);
    expect(result.port).toBe(7892);
    expect(result.uptime).toBeDefined();
    expect(result.startedAt).toBe(startedAt);
  });
});
