/**
 * Integration test for the Popcorn hook pipeline.
 * Tests the full flow: load test plans, send start_demo through
 * ExtensionClient (HTTP bridge), simulate extension responses,
 * and verify the Messenger (file-based IPC) round-trip.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ExtensionClient } from '../extension-client.js';
import { Messenger } from '../messenger.js';
import { loadTestPlan, listTestPlans } from '../plan-loader.js';
import type { DemoResultMessage, StartDemoMessage, TestPlan } from '@popcorn/shared';
import { createMessage } from '@popcorn/shared';

/** Helper: waits for a specified number of milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Hook Integration', () => {
  let tmpDir: string;
  let testPlansDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'popcorn-integration-'));
    testPlansDir = path.join(tmpDir, 'test-plans');
    fs.mkdirSync(testPlansDir, { recursive: true });

    // Create a sample test plan
    const plan: TestPlan = {
      planName: 'login',
      description: 'Test login flow',
      baseUrl: 'http://localhost:3000',
      steps: [
        {
          stepNumber: 1,
          action: 'navigate',
          description: 'Navigate to login page',
          target: 'http://localhost:3000/login',
        },
        {
          stepNumber: 2,
          action: 'fill',
          description: 'Fill email field',
          selector: '#email',
          value: 'test@example.com',
        },
        {
          stepNumber: 3,
          action: 'click',
          description: 'Click login button',
          selector: '#login-btn',
        },
      ],
    };

    fs.writeFileSync(
      path.join(testPlansDir, 'login.json'),
      JSON.stringify(plan, null, 2),
    );
  });

  afterEach(async () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads test plan and sends start_demo through ExtensionClient', async () => {
    // Set up client with short poll interval and timeout
    const client = new ExtensionClient({
      projectRoot: tmpDir,
      pollIntervalMs: 50,
      timeoutMs: 2000,
      bridgePort: 19200,
    });

    await client.connect();
    expect(client.getTransport()).toBe('http');

    // Load the test plan
    const plan = await loadTestPlan('login', testPlansDir);
    expect(plan.planName).toBe('login');
    expect(plan.steps).toHaveLength(3);

    // Start the demo (will time out since no extension response)
    const demoPromise = client.startDemo(
      plan.planName,
      plan,
      ['All steps pass'],
      'LoginPage.tsx',
    );

    // Wait for message to be queued
    await sleep(100);

    // Read bridge.json to get port and token
    const bridgePath = path.join(tmpDir, '.popcorn', 'bridge.json');
    const { port, token } = JSON.parse(await fsp.readFile(bridgePath, 'utf-8'));

    // Poll via HTTP to verify messages are queued
    const pollRes = await fetch(`http://127.0.0.1:${port}/poll`, {
      headers: { 'X-Popcorn-Token': token },
    });
    const pollData = await pollRes.json() as { messages: Array<{ type: string; payload: Record<string, unknown> }> };

    const hookReady = pollData.messages.find((m) => m.type === 'hook_ready');
    expect(hookReady).toBeDefined();
    expect(hookReady!.payload.hookVersion).toBe('0.1.0');

    const startDemo = pollData.messages.find((m) => m.type === 'start_demo');
    expect(startDemo).toBeDefined();
    expect(startDemo!.payload.testPlanId).toBe('login');
    expect((startDemo!.payload as any).testPlan.steps).toHaveLength(3);
    expect((startDemo!.payload as any).acceptanceCriteria).toEqual(['All steps pass']);
    expect((startDemo!.payload as any).triggeredBy).toBe('LoginPage.tsx');

    // Let it time out
    await expect(demoPromise).rejects.toThrow('timed out');
    client.disconnect();
  });

  it('receives demo_result from simulated extension response', async () => {
    const client = new ExtensionClient({
      projectRoot: tmpDir,
      pollIntervalMs: 50,
      timeoutMs: 5000,
      bridgePort: 19201,
    });

    await client.connect();
    expect(client.getTransport()).toBe('http');

    const plan = await loadTestPlan('login', testPlansDir);

    // Start the demo
    const demoPromise = client.startDemo(
      plan.planName,
      plan,
      ['All steps pass'],
      'Login.tsx',
    );

    // Simulate extension posting a result back via HTTP
    await sleep(100);
    const bridgePath = path.join(tmpDir, '.popcorn', 'bridge.json');
    const { port, token } = JSON.parse(await fsp.readFile(bridgePath, 'utf-8'));

    const resultMsg: DemoResultMessage = {
      type: 'demo_result',
      payload: {
        testPlanId: 'login',
        passed: true,
        steps: [
          { stepNumber: 1, action: 'navigate', description: 'Navigate to login page', passed: true, duration: 150, timestamp: Date.now() },
          { stepNumber: 2, action: 'fill', description: 'Fill email field', passed: true, duration: 50, timestamp: Date.now() },
          { stepNumber: 3, action: 'click', description: 'Click login button', passed: true, duration: 30, timestamp: Date.now() },
        ],
        summary: 'Demo completed successfully. All 3 steps passed in 0.23s.',
        videoMetadata: null,
        screenshots: [],
        duration: 230,
        timestamp: Date.now(),
      },
      timestamp: Date.now(),
    };

    await fetch(`http://127.0.0.1:${port}/result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Popcorn-Token': token,
      },
      body: JSON.stringify({ message: resultMsg }),
    });

    // Wait for result
    const result = await demoPromise;
    expect(result.passed).toBe(true);
    expect(result.testPlanId).toBe('login');
    expect(result.steps).toHaveLength(3);
    expect(result.summary).toContain('All 3 steps passed');
    expect(result.duration).toBe(230);

    client.disconnect();
  });

  it('handles failed demo result correctly', async () => {
    const client = new ExtensionClient({
      projectRoot: tmpDir,
      pollIntervalMs: 50,
      timeoutMs: 5000,
      bridgePort: 19202,
    });

    await client.connect();

    const plan = await loadTestPlan('login', testPlansDir);

    const demoPromise = client.startDemo(
      plan.planName,
      plan,
      ['All steps pass'],
      'Login.tsx',
    );

    await sleep(100);
    const bridgePath = path.join(tmpDir, '.popcorn', 'bridge.json');
    const { port, token } = JSON.parse(await fsp.readFile(bridgePath, 'utf-8'));

    const failedResult: DemoResultMessage = {
      type: 'demo_result',
      payload: {
        testPlanId: 'login',
        passed: false,
        steps: [
          { stepNumber: 1, action: 'navigate', description: 'Navigate', passed: true, duration: 150, timestamp: Date.now() },
          { stepNumber: 2, action: 'fill', description: 'Fill email', passed: true, duration: 50, timestamp: Date.now() },
          { stepNumber: 3, action: 'click', description: 'Click button', passed: false, duration: 30, error: 'Element not found: #login-btn', timestamp: Date.now() },
        ],
        summary: 'Demo completed with issues. 2/3 steps passed, 1 failed.',
        videoMetadata: null,
        screenshots: [],
        duration: 230,
        timestamp: Date.now(),
      },
      timestamp: Date.now(),
    };

    await fetch(`http://127.0.0.1:${port}/result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Popcorn-Token': token,
      },
      body: JSON.stringify({ message: failedResult }),
    });

    const result = await demoPromise;
    expect(result.passed).toBe(false);
    expect(result.steps[2].passed).toBe(false);
    expect(result.steps[2].error).toContain('#login-btn');

    client.disconnect();
  });

  it('lists available test plans from the test-plans directory', async () => {
    // Add another plan
    const checkoutPlan: TestPlan = {
      planName: 'checkout',
      baseUrl: 'http://localhost:3000',
      steps: [
        { stepNumber: 1, action: 'navigate', description: 'Go to cart', target: '/cart' },
      ],
    };

    fs.writeFileSync(
      path.join(testPlansDir, 'checkout.json'),
      JSON.stringify(checkoutPlan, null, 2),
    );

    const plans = await listTestPlans(testPlansDir);
    expect(plans).toContain('login');
    expect(plans).toContain('checkout');
    expect(plans).toHaveLength(2);
  });

  it('round-trips messages through outbox and inbox directories', async () => {
    const messenger = new Messenger(tmpDir, { pollIntervalMs: 50 });
    await messenger.connect();

    // Send a message through the outbox
    const hookReady = createMessage('hook_ready', {
      hookVersion: '0.1.0',
      watchDir: 'src/frontend',
    });
    await messenger.sendMessage(hookReady);

    // Verify it landed in the outbox
    const outboxFiles = await fsp.readdir(messenger.getOutboxDir());
    expect(outboxFiles.length).toBe(1);

    const sent = JSON.parse(
      await fsp.readFile(path.join(messenger.getOutboxDir(), outboxFiles[0]), 'utf-8'),
    );
    expect(sent.type).toBe('hook_ready');

    // Simulate a response arriving in the inbox
    const received: any[] = [];
    messenger.onMessage((msg) => received.push(msg));

    const responseMsg: DemoResultMessage = {
      type: 'demo_result',
      payload: {
        testPlanId: 'test',
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

    await fsp.writeFile(
      path.join(messenger.getInboxDir(), 'response.json'),
      JSON.stringify(responseMsg),
    );

    await sleep(200);

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('demo_result');
    expect(received[0].payload.passed).toBe(true);

    messenger.disconnect();
  });
});
