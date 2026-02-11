import { describe, it, expect } from 'vitest';
import type { StartDemoMessage, DemoResultMessage, PopcornMessage } from '../messages.js';
import { createMessage, isPopcornMessage } from '../messages.js';

describe('message types', () => {
  it('StartDemoMessage has required fields', () => {
    const msg: StartDemoMessage = {
      type: 'start_demo',
      payload: {
        testPlanId: 'login-flow',
        testPlan: { planName: 'login-flow', steps: [], baseUrl: '/' },
        acceptanceCriteria: ['Page loads without errors'],
        triggeredBy: 'src/frontend/Login.tsx',
      },
      timestamp: Date.now(),
    };
    expect(msg.type).toBe('start_demo');
    expect(msg.payload.testPlanId).toBe('login-flow');
    expect(msg.payload.acceptanceCriteria).toHaveLength(1);
  });

  it('DemoResultMessage has required fields', () => {
    const msg: DemoResultMessage = {
      type: 'demo_result',
      payload: {
        testPlanId: 'login-flow',
        passed: true,
        steps: [],
        summary: 'All steps passed',
        videoMetadata: null,
        screenshots: [],
        duration: 1200,
        timestamp: Date.now(),
      },
      timestamp: Date.now(),
    };
    expect(msg.type).toBe('demo_result');
    expect(msg.payload.passed).toBe(true);
    expect(msg.payload.summary).toBe('All steps passed');
  });
});

describe('createMessage', () => {
  it('creates a message with timestamp', () => {
    const before = Date.now();
    const msg = createMessage<StartDemoMessage>('start_demo', {
      testPlanId: 'test',
      testPlan: { planName: 'test', steps: [], baseUrl: '/' },
      acceptanceCriteria: [],
      triggeredBy: 'test.ts',
    });
    expect(msg.type).toBe('start_demo');
    expect(msg.timestamp).toBeGreaterThanOrEqual(before);
    expect(msg.payload.testPlanId).toBe('test');
  });
});

describe('isPopcornMessage', () => {
  it('returns true for valid messages', () => {
    const msg: PopcornMessage = {
      type: 'hook_ready',
      payload: { hookVersion: '0.1.0', watchDir: 'src/frontend' },
      timestamp: Date.now(),
    };
    expect(isPopcornMessage(msg)).toBe(true);
  });

  it('returns false for invalid values', () => {
    expect(isPopcornMessage(null)).toBe(false);
    expect(isPopcornMessage(undefined)).toBe(false);
    expect(isPopcornMessage('string')).toBe(false);
    expect(isPopcornMessage({})).toBe(false);
    expect(isPopcornMessage({ type: 'test' })).toBe(false);
    expect(isPopcornMessage({ type: 'test', timestamp: 123 })).toBe(false);
  });
});
