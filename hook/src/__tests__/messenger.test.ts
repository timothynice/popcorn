import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Messenger } from '../messenger.js';
import type { PopcornMessage } from '@popcorn/shared';
import { createMessage } from '@popcorn/shared';
import type { HookReadyMessage, DemoResultMessage } from '@popcorn/shared';

/** Helper: waits for a specified number of milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Messenger', () => {
  let tempDir: string;
  let messenger: Messenger;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'popcorn-messenger-'));
  });

  afterEach(async () => {
    if (messenger) {
      messenger.disconnect();
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates outbox and inbox directories on connect', async () => {
    messenger = new Messenger(tempDir);
    await messenger.connect();

    const outboxExists = fs.existsSync(messenger.getOutboxDir());
    const inboxExists = fs.existsSync(messenger.getInboxDir());

    expect(outboxExists).toBe(true);
    expect(inboxExists).toBe(true);
  });

  it('sends a message to the outbox as a JSON file', async () => {
    messenger = new Messenger(tempDir);
    await messenger.connect();

    const msg = createMessage<HookReadyMessage>('hook_ready', {
      hookVersion: '0.1.0',
      watchDir: 'src/frontend',
    });

    await messenger.sendMessage(msg);

    // Check that a JSON file was written to outbox
    const files = fs.readdirSync(messenger.getOutboxDir());
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/\.json$/);

    // Verify the content
    const content = JSON.parse(
      fs.readFileSync(path.join(messenger.getOutboxDir(), files[0]), 'utf-8'),
    );
    expect(content.type).toBe('hook_ready');
    expect(content.payload.hookVersion).toBe('0.1.0');
    expect(typeof content.timestamp).toBe('number');
  });

  it('throws when sending without connecting first', async () => {
    messenger = new Messenger(tempDir);

    const msg = createMessage<HookReadyMessage>('hook_ready', {
      hookVersion: '0.1.0',
      watchDir: 'src/frontend',
    });

    await expect(messenger.sendMessage(msg)).rejects.toThrow('not connected');
  });

  it('reads messages from the inbox', async () => {
    messenger = new Messenger(tempDir, { pollIntervalMs: 50 });
    await messenger.connect();

    const received: PopcornMessage[] = [];
    messenger.onMessage((msg) => received.push(msg));

    // Simulate the extension writing a message to the inbox
    const inboxMsg: DemoResultMessage = {
      type: 'demo_result',
      payload: {
        testPlanId: 'test',
        passed: true,
        steps: [],
        summary: 'All passed',
        videoMetadata: null,
        screenshots: [],
        duration: 500,
        timestamp: Date.now(),
      },
      timestamp: Date.now(),
    };

    await fsp.writeFile(
      path.join(messenger.getInboxDir(), 'msg-001.json'),
      JSON.stringify(inboxMsg),
      'utf-8',
    );

    // Wait for the poll cycle to pick it up
    await sleep(200);

    expect(received.length).toBe(1);
    expect(received[0].type).toBe('demo_result');
    expect((received[0] as DemoResultMessage).payload.passed).toBe(true);
  });

  it('ignores invalid messages in inbox', async () => {
    messenger = new Messenger(tempDir, { pollIntervalMs: 50 });
    await messenger.connect();

    const received: PopcornMessage[] = [];
    messenger.onMessage((msg) => received.push(msg));

    // Write an invalid message (missing required fields)
    await fsp.writeFile(
      path.join(messenger.getInboxDir(), 'bad-001.json'),
      JSON.stringify({ invalid: true }),
      'utf-8',
    );

    await sleep(200);

    // Should not deliver invalid messages
    expect(received.length).toBe(0);
  });

  it('handles missing inbox directory gracefully during polling', async () => {
    messenger = new Messenger(tempDir, { pollIntervalMs: 50 });
    await messenger.connect();

    // Remove the inbox directory to simulate a transient issue
    fs.rmSync(messenger.getInboxDir(), { recursive: true, force: true });

    // Should not throw; polling should continue silently
    await sleep(200);

    // Recreate inbox and verify it can still receive
    fs.mkdirSync(messenger.getInboxDir(), { recursive: true });

    const received: PopcornMessage[] = [];
    messenger.onMessage((msg) => received.push(msg));

    const msg: HookReadyMessage = {
      type: 'hook_ready',
      payload: { hookVersion: '0.1.0', watchDir: 'src' },
      timestamp: Date.now(),
    };

    await fsp.writeFile(
      path.join(messenger.getInboxDir(), 'recovery.json'),
      JSON.stringify(msg),
      'utf-8',
    );

    await sleep(200);

    expect(received.length).toBe(1);
  });

  it('does not deliver the same message twice', async () => {
    messenger = new Messenger(tempDir, { pollIntervalMs: 50 });
    await messenger.connect();

    const received: PopcornMessage[] = [];
    messenger.onMessage((msg) => received.push(msg));

    const msg: HookReadyMessage = {
      type: 'hook_ready',
      payload: { hookVersion: '0.1.0', watchDir: 'src' },
      timestamp: Date.now(),
    };

    await fsp.writeFile(
      path.join(messenger.getInboxDir(), 'once.json'),
      JSON.stringify(msg),
      'utf-8',
    );

    // Wait for multiple poll cycles
    await sleep(300);

    // The file gets deleted after processing, so only one delivery
    expect(received.length).toBe(1);
  });

  it('disconnect stops polling', async () => {
    messenger = new Messenger(tempDir, { pollIntervalMs: 50 });
    await messenger.connect();

    const received: PopcornMessage[] = [];
    messenger.onMessage((msg) => received.push(msg));

    messenger.disconnect();

    // Write a message after disconnect
    const inboxDir = path.join(tempDir, '.popcorn', 'inbox');
    fs.mkdirSync(inboxDir, { recursive: true });

    const msg: HookReadyMessage = {
      type: 'hook_ready',
      payload: { hookVersion: '0.1.0', watchDir: 'src' },
      timestamp: Date.now(),
    };

    await fsp.writeFile(
      path.join(inboxDir, 'after-disconnect.json'),
      JSON.stringify(msg),
      'utf-8',
    );

    await sleep(200);

    // Should not receive messages after disconnect
    expect(received.length).toBe(0);
  });
});
