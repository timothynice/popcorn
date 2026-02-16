import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readBridgeJson, isProcessAlive, killBridgeDaemon } from '../daemon-utils.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'popcorn-daemon-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('readBridgeJson', () => {
  it('returns null when .popcorn/bridge.json does not exist', async () => {
    const result = await readBridgeJson(tmpDir);
    expect(result).toBeNull();
  });

  it('returns parsed bridge info when file exists', async () => {
    const popcornDir = path.join(tmpDir, '.popcorn');
    await fs.mkdir(popcornDir, { recursive: true });
    await fs.writeFile(
      path.join(popcornDir, 'bridge.json'),
      JSON.stringify({ port: 7890, token: 'abc123', pid: 12345, startedAt: '2025-01-01T00:00:00Z' }),
    );

    const result = await readBridgeJson(tmpDir);
    expect(result).toEqual({
      port: 7890,
      token: 'abc123',
      pid: 12345,
      startedAt: '2025-01-01T00:00:00Z',
    });
  });

  it('returns null when bridge.json has invalid JSON', async () => {
    const popcornDir = path.join(tmpDir, '.popcorn');
    await fs.mkdir(popcornDir, { recursive: true });
    await fs.writeFile(path.join(popcornDir, 'bridge.json'), 'not json');

    const result = await readBridgeJson(tmpDir);
    expect(result).toBeNull();
  });

  it('returns null when bridge.json is missing required fields', async () => {
    const popcornDir = path.join(tmpDir, '.popcorn');
    await fs.mkdir(popcornDir, { recursive: true });
    await fs.writeFile(path.join(popcornDir, 'bridge.json'), JSON.stringify({ token: 'abc' }));

    const result = await readBridgeJson(tmpDir);
    expect(result).toBeNull();
  });
});

describe('isProcessAlive', () => {
  it('returns true for the current process PID', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('returns false for a bogus PID', () => {
    // PID 999999 is very unlikely to be running
    expect(isProcessAlive(999999)).toBe(false);
  });
});

describe('killBridgeDaemon', () => {
  it('returns false when no bridge.json exists', async () => {
    const result = await killBridgeDaemon(tmpDir);
    expect(result).toBe(false);
  });

  it('returns false when PID in bridge.json is dead', async () => {
    const popcornDir = path.join(tmpDir, '.popcorn');
    await fs.mkdir(popcornDir, { recursive: true });
    await fs.writeFile(
      path.join(popcornDir, 'bridge.json'),
      JSON.stringify({ port: 7890, token: 'abc', pid: 999999, startedAt: '2025-01-01T00:00:00Z' }),
    );

    const result = await killBridgeDaemon(tmpDir);
    expect(result).toBe(false);
  });
});
