import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ExtensionClient } from '../extension-client.js';
import type { DemoResultMessage } from '@popcorn/shared';

describe('ExtensionClient', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'popcorn-client-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('connects and sends hook_ready', async () => {
    const client = new ExtensionClient({
      projectRoot: tmpDir,
      pollIntervalMs: 50,
      bridgePort: 19100,
    });

    await client.connect();
    expect(client.isConnected()).toBe(true);

    client.disconnect();
    expect(client.isConnected()).toBe(false);
  });

  it('throws when starting demo without connecting', async () => {
    const client = new ExtensionClient({ projectRoot: tmpDir });
    await expect(
      client.startDemo('test', { planName: 'test', steps: [], baseUrl: '/' }, [], 'test.ts'),
    ).rejects.toThrow('Not connected');
  });

  it('sends start_demo message via active transport', async () => {
    const client = new ExtensionClient({
      projectRoot: tmpDir,
      pollIntervalMs: 50,
      timeoutMs: 500,
      bridgePort: 19101,
    });

    await client.connect();

    // Start demo (don't await — it will time out since no response)
    const demoPromise = client.startDemo(
      'login-test',
      { planName: 'login', steps: [], baseUrl: '/' },
      ['All steps pass'],
      'Login.tsx',
    );

    // Let it timeout
    await expect(demoPromise).rejects.toThrow('timed out');
    client.disconnect();
  });

  it('resolves when demo result arrives via HTTP bridge', async () => {
    const client = new ExtensionClient({
      projectRoot: tmpDir,
      pollIntervalMs: 50,
      timeoutMs: 5000,
      bridgePort: 19102,
    });

    await client.connect();
    expect(client.getTransport()).toBe('http');

    // Read the bridge.json to get port and token
    const bridgePath = path.join(tmpDir, '.popcorn', 'bridge.json');
    const bridgeData = JSON.parse(await fs.readFile(bridgePath, 'utf-8'));
    const { port, token } = bridgeData;

    // Start demo
    const demoPromise = client.startDemo(
      'quick-test',
      { planName: 'quick', steps: [], baseUrl: '/' },
      [],
      'test.ts',
    );

    // Simulate extension posting a result back via HTTP
    const resultMsg: DemoResultMessage = {
      type: 'demo_result',
      payload: {
        testPlanId: 'quick-test',
        passed: true,
        steps: [],
        summary: 'All passed',
        videoMetadata: null,
        screenshots: [],
        duration: 100,
        timestamp: Date.now(),
      },
      timestamp: Date.now(),
    };

    await new Promise((r) => setTimeout(r, 50));
    const res = await fetch(`http://127.0.0.1:${port}/result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Popcorn-Token': token,
      },
      body: JSON.stringify({ message: resultMsg }),
    });
    expect(res.status).toBe(200);

    const result = await demoPromise;
    expect(result.passed).toBe(true);
    expect(result.testPlanId).toBe('quick-test');
    expect(result.summary).toBe('All passed');

    client.disconnect();
  });

  it('rejects pending callbacks on disconnect', async () => {
    const client = new ExtensionClient({
      projectRoot: tmpDir,
      pollIntervalMs: 50,
      timeoutMs: 5000,
      bridgePort: 19103,
    });

    await client.connect();

    // Start the demo but immediately catch to prevent unhandled rejection
    let caughtError: Error | null = null;
    const demoPromise = client.startDemo(
      'disconnect-test',
      { planName: 'test', steps: [], baseUrl: '/' },
      [],
      'test.ts',
    ).catch((err) => { caughtError = err; });

    // Give sendMessage time to complete
    await new Promise((r) => setTimeout(r, 50));

    // Disconnect — this should reject the pending callback
    client.disconnect();

    await demoPromise;
    expect(caughtError).toBeInstanceOf(Error);
    expect(caughtError!.message).toContain('disconnected');
  });
});

describe('ExtensionClient HTTP transport', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'popcorn-http-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('uses HTTP transport by default', async () => {
    const client = new ExtensionClient({
      projectRoot: tmpDir,
      bridgePort: 19110,
    });

    await client.connect();
    expect(client.getTransport()).toBe('http');
    client.disconnect();
  });

  it('writes bridge.json on HTTP connect', async () => {
    const client = new ExtensionClient({
      projectRoot: tmpDir,
      bridgePort: 19111,
    });

    await client.connect();

    const bridgePath = path.join(tmpDir, '.popcorn', 'bridge.json');
    const stat = await fs.stat(bridgePath);
    expect(stat.isFile()).toBe(true);

    const data = JSON.parse(await fs.readFile(bridgePath, 'utf-8'));
    expect(data.port).toBe(19111);
    expect(typeof data.token).toBe('string');
    expect(data.pid).toBe(process.pid);
    expect(typeof data.startedAt).toBe('string');

    client.disconnect();
  });

  it('cleans up bridge.json on disconnect', async () => {
    const client = new ExtensionClient({
      projectRoot: tmpDir,
      bridgePort: 19112,
    });

    await client.connect();

    const bridgePath = path.join(tmpDir, '.popcorn', 'bridge.json');
    // File should exist while connected
    await fs.access(bridgePath);

    client.disconnect();

    // Give the async unlink a moment to complete
    await new Promise((r) => setTimeout(r, 100));

    // File should be removed after disconnect
    await expect(fs.access(bridgePath)).rejects.toThrow();
  });

  it('falls back to file transport when bridge port range is exhausted', async () => {
    // Start 10 servers to exhaust the port range 19120-19129
    const http = await import('node:http');
    const blockers: ReturnType<typeof http.createServer>[] = [];

    for (let i = 0; i < 10; i++) {
      const srv = http.createServer();
      await new Promise<void>((resolve, reject) => {
        srv.once('error', reject);
        srv.once('listening', resolve);
        srv.listen(19120 + i, '127.0.0.1');
      });
      blockers.push(srv);
    }

    try {
      const client = new ExtensionClient({
        projectRoot: tmpDir,
        pollIntervalMs: 50,
        bridgePort: 19120,
      });

      await client.connect();
      expect(client.getTransport()).toBe('file');
      expect(client.isConnected()).toBe(true);
      client.disconnect();
    } finally {
      for (const srv of blockers) {
        srv.close();
      }
    }
  });

  it('extension can poll queued messages via HTTP bridge', async () => {
    const client = new ExtensionClient({
      projectRoot: tmpDir,
      pollIntervalMs: 50,
      timeoutMs: 500,
      bridgePort: 19130,
    });

    await client.connect();
    expect(client.getTransport()).toBe('http');

    // Read bridge info
    const bridgePath = path.join(tmpDir, '.popcorn', 'bridge.json');
    const { port, token } = JSON.parse(await fs.readFile(bridgePath, 'utf-8'));

    // Start a demo — this enqueues a start_demo message
    const demoPromise = client.startDemo(
      'poll-test',
      { planName: 'poll', steps: [], baseUrl: '/' },
      [],
      'test.ts',
    ).catch(() => { /* will timeout, that's fine */ });

    // Poll for messages as the extension would
    const res = await fetch(`http://127.0.0.1:${port}/poll`, {
      headers: { 'X-Popcorn-Token': token },
    });
    const data = await res.json() as { messages: Array<{ type: string }> };

    // Should contain hook_ready and start_demo
    const types = data.messages.map((m) => m.type);
    expect(types).toContain('hook_ready');
    expect(types).toContain('start_demo');

    client.disconnect();
    await demoPromise;
  });
});
