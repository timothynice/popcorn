import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runStop } from '../commands/stop.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'popcorn-stop-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('runStop', () => {
  it('returns no_bridge_json when .popcorn/bridge.json does not exist', async () => {
    const result = await runStop(tmpDir);
    expect(result.stopped).toBe(false);
    expect(result.reason).toBe('no_bridge_json');
  });

  it('cleans up stale bridge.json when PID is dead', async () => {
    const popcornDir = path.join(tmpDir, '.popcorn');
    await fs.mkdir(popcornDir, { recursive: true });
    await fs.writeFile(
      path.join(popcornDir, 'bridge.json'),
      JSON.stringify({ port: 7890, token: 'abc', pid: 999999, startedAt: '2025-01-01T00:00:00Z' }),
    );

    const result = await runStop(tmpDir);
    expect(result.stopped).toBe(false);
    expect(result.reason).toBe('not_running');
    expect(result.pid).toBe(999999);
    expect(result.port).toBe(7890);

    // bridge.json should be cleaned up
    await expect(fs.stat(path.join(popcornDir, 'bridge.json'))).rejects.toThrow();
  });
});
