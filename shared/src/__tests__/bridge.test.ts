import { describe, it, expect } from 'vitest';
import {
  validateMessage,
  serializeMessage,
  deserializeMessage,
  isKnownMessageType,
} from '../bridge.js';
import type { StartDemoMessage } from '../messages.js';
import { createMessage } from '../messages.js';

describe('validateMessage', () => {
  it('validates a correct PopcornMessage', () => {
    const msg = createMessage<StartDemoMessage>('start_demo', {
      testPlanId: 'test',
      testPlan: { planName: 'test', steps: [], baseUrl: '/' },
      acceptanceCriteria: [],
      triggeredBy: 'test.ts',
    });
    const result = validateMessage(msg);
    expect(result.valid).toBe(true);
    expect(result.message).toBeDefined();
    expect(result.message?.type).toBe('start_demo');
  });

  it('rejects null', () => {
    const result = validateMessage(null);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('null');
  });

  it('rejects undefined', () => {
    const result = validateMessage(undefined);
    expect(result.valid).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(validateMessage(42).valid).toBe(false);
    expect(validateMessage(true).valid).toBe(false);
  });

  it('rejects objects missing required fields', () => {
    const result = validateMessage({ type: 'test' });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('timestamp');
  });

  it('handles JSON strings', () => {
    const msg = createMessage<StartDemoMessage>('start_demo', {
      testPlanId: 'test',
      testPlan: { planName: 'test', steps: [], baseUrl: '/' },
      acceptanceCriteria: [],
      triggeredBy: 'test.ts',
    });
    const json = JSON.stringify(msg);
    const result = validateMessage(json);
    expect(result.valid).toBe(true);
  });

  it('rejects invalid JSON strings', () => {
    const result = validateMessage('not json');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('not valid JSON');
  });
});

describe('serializeMessage', () => {
  it('serializes a message to JSON', () => {
    const msg = createMessage<StartDemoMessage>('start_demo', {
      testPlanId: 'test',
      testPlan: { planName: 'test', steps: [], baseUrl: '/' },
      acceptanceCriteria: [],
      triggeredBy: 'test.ts',
    });
    const json = serializeMessage(msg);
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe('start_demo');
    expect(parsed.payload.testPlanId).toBe('test');
  });
});

describe('deserializeMessage', () => {
  it('deserializes valid JSON', () => {
    const msg = createMessage<StartDemoMessage>('start_demo', {
      testPlanId: 'test',
      testPlan: { planName: 'test', steps: [], baseUrl: '/' },
      acceptanceCriteria: [],
      triggeredBy: 'test.ts',
    });
    const json = JSON.stringify(msg);
    const result = deserializeMessage(json);
    expect(result.valid).toBe(true);
    expect(result.message?.type).toBe('start_demo');
  });

  it('rejects invalid JSON', () => {
    const result = deserializeMessage('{{bad');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('parse JSON');
  });
});

describe('isKnownMessageType', () => {
  it('recognizes known types', () => {
    expect(isKnownMessageType('start_demo')).toBe(true);
    expect(isKnownMessageType('demo_result')).toBe(true);
    expect(isKnownMessageType('hook_ready')).toBe(true);
    expect(isKnownMessageType('extension_ready')).toBe(true);
    expect(isKnownMessageType('hook_error')).toBe(true);
  });

  it('rejects unknown types', () => {
    expect(isKnownMessageType('unknown')).toBe(false);
    expect(isKnownMessageType('')).toBe(false);
  });
});
