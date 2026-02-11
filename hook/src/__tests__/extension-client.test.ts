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
    });

    await client.connect();
    expect(client.isConnected()).toBe(true);

    // Check that hook_ready was sent to outbox
    const outboxDir = path.join(tmpDir, '.popcorn', 'outbox');
    const files = await fs.readdir(outboxDir);
    expect(files.length).toBe(1);

    const content = await fs.readFile(path.join(outboxDir, files[0]), 'utf-8');
    const msg = JSON.parse(content);
    expect(msg.type).toBe('hook_ready');
    expect(msg.payload.hookVersion).toBe('0.1.0');

    client.disconnect();
    expect(client.isConnected()).toBe(false);
  });

  it('throws when starting demo without connecting', async () => {
    const client = new ExtensionClient({ projectRoot: tmpDir });
    await expect(
      client.startDemo('test', { planName: 'test', steps: [], baseUrl: '/' }, [], 'test.ts'),
    ).rejects.toThrow('Not connected');
  });

  it('sends start_demo message to outbox', async () => {
    const client = new ExtensionClient({
      projectRoot: tmpDir,
      pollIntervalMs: 50,
      timeoutMs: 500,
    });

    await client.connect();

    // Start demo (don't await — it will time out since no response)
    const demoPromise = client.startDemo(
      'login-test',
      { planName: 'login', steps: [], baseUrl: '/' },
      ['All steps pass'],
      'Login.tsx',
    );

    // Give it a moment to write the file
    await new Promise((r) => setTimeout(r, 100));

    const outboxDir = path.join(tmpDir, '.popcorn', 'outbox');
    const files = await fs.readdir(outboxDir);
    // Should have hook_ready + start_demo
    expect(files.length).toBe(2);

    const messages = await Promise.all(
      files.map(async (f) => JSON.parse(await fs.readFile(path.join(outboxDir, f), 'utf-8'))),
    );
    const startDemo = messages.find((m) => m.type === 'start_demo');
    expect(startDemo).toBeDefined();
    expect(startDemo.payload.testPlanId).toBe('login-test');

    // Let it timeout
    await expect(demoPromise).rejects.toThrow('timed out');
    client.disconnect();
  });

  it('resolves when demo result arrives in inbox', async () => {
    const client = new ExtensionClient({
      projectRoot: tmpDir,
      pollIntervalMs: 50,
      timeoutMs: 5000,
    });

    await client.connect();

    // Start demo
    const demoPromise = client.startDemo(
      'quick-test',
      { planName: 'quick', steps: [], baseUrl: '/' },
      [],
      'test.ts',
    );

    // Simulate extension writing a result to the inbox
    const inboxDir = path.join(tmpDir, '.popcorn', 'inbox');
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

    // Wait a bit then write result
    await new Promise((r) => setTimeout(r, 100));
    await fs.writeFile(
      path.join(inboxDir, `${Date.now()}-result.json`),
      JSON.stringify(resultMsg),
    );

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
