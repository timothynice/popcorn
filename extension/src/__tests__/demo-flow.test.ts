/**
 * Tests for the full demo flow orchestrator.
 * Verifies that runFullDemo correctly coordinates the recorder,
 * content script execution, tape storage, and result assembly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StartDemoMessage, TestPlan, DemoResult } from '@popcorn/shared';
import { createMessage } from '@popcorn/shared';
import { runFullDemo } from '../background/demo-flow.js';
import type { DemoFlowDeps } from '../background/demo-flow.js';

// -- Chrome mock --
const chromeMock = {
  tabs: {
    sendMessage: vi.fn(),
    query: vi.fn(),
    update: vi.fn(),
    captureVisibleTab: vi.fn(),
  },
  tabCapture: {
    capture: vi.fn(),
  },
  runtime: {
    lastError: null,
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    sendMessage: vi.fn(),
  },
};

vi.stubGlobal('chrome', chromeMock);

// Mock MediaRecorder for recording tests
class MockMediaRecorder {
  state = 'inactive' as 'inactive' | 'recording' | 'paused';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  mimeType = 'video/webm';

  start(_timeslice?: number) {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    // Deliver some data
    if (this.ondataavailable) {
      this.ondataavailable({ data: new Blob(['video-data'], { type: 'video/webm' }) });
    }
    // Fire onstop callback
    if (this.onstop) {
      this.onstop();
    }
  }

  static isTypeSupported(_type: string) {
    return true;
  }
}

vi.stubGlobal('MediaRecorder', MockMediaRecorder);

// -- Mock TapeStore --
function createMockTapeStore() {
  const savedTapes: any[] = [];
  return {
    store: {
      init: vi.fn().mockResolvedValue(undefined),
      save: vi.fn().mockImplementation(async (tape: any) => {
        const id = `tape-${Date.now()}`;
        savedTapes.push({ ...tape, id });
        return id;
      }),
    },
    savedTapes,
  };
}

// -- Helpers --
function createTestPlan(overrides?: Partial<TestPlan>): TestPlan {
  return {
    planName: 'test-plan',
    baseUrl: 'http://localhost:3000',
    steps: [
      {
        stepNumber: 1,
        action: 'click',
        description: 'Click button',
        selector: '#btn',
      },
    ],
    ...overrides,
  };
}

function createStartDemoMessage(plan?: TestPlan): StartDemoMessage {
  const testPlan = plan ?? createTestPlan();
  return createMessage('start_demo', {
    testPlanId: testPlan.planName,
    testPlan,
    acceptanceCriteria: ['All steps pass'],
    triggeredBy: 'test.tsx',
  });
}

describe('demo-flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('executes test plan and returns demo result', async () => {
    const { store } = createMockTapeStore();

    // Mock content script returning step results
    chromeMock.tabs.sendMessage.mockResolvedValue({
      results: [
        {
          stepNumber: 1,
          action: 'click',
          description: 'Click button',
          passed: true,
          duration: 50,
          timestamp: Date.now(),
        },
      ],
    });

    // Mock tabCapture failing (no recording available)
    chromeMock.tabCapture.capture.mockImplementation((_opts: any, cb: Function) => {
      chromeMock.runtime.lastError = { message: 'Tab capture not available' } as any;
      cb(null);
      chromeMock.runtime.lastError = null;
    });

    // Mock screenshot capture
    chromeMock.tabs.captureVisibleTab.mockImplementation((_opts: any, cb: Function) => {
      cb('data:image/png;base64,thumbnail');
    });

    const message = createStartDemoMessage();
    const deps: DemoFlowDeps = { tapeStore: store };

    const result = await runFullDemo(message, 1, deps);

    expect(result.passed).toBe(true);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].passed).toBe(true);
    expect(result.testPlanId).toBe('test-plan');
  });

  it('saves tape record to store after successful demo', async () => {
    const { store, savedTapes } = createMockTapeStore();

    chromeMock.tabs.sendMessage.mockResolvedValue({
      results: [
        {
          stepNumber: 1,
          action: 'click',
          description: 'Click button',
          passed: true,
          duration: 50,
          timestamp: Date.now(),
        },
      ],
    });

    chromeMock.tabCapture.capture.mockImplementation((_opts: any, cb: Function) => {
      chromeMock.runtime.lastError = { message: 'Not available' } as any;
      cb(null);
      chromeMock.runtime.lastError = null;
    });

    chromeMock.tabs.captureVisibleTab.mockImplementation((_opts: any, cb: Function) => {
      cb('data:image/png;base64,thumb');
    });

    const message = createStartDemoMessage();
    await runFullDemo(message, 1, { tapeStore: store });

    expect(store.save).toHaveBeenCalledOnce();

    const savedTape = store.save.mock.calls[0][0];
    expect(savedTape.testPlanId).toBe('test-plan');
    expect(savedTape.demoName).toBe('test-plan');
    expect(savedTape.passed).toBe(true);
    expect(savedTape.status).toBe('complete');
    expect(savedTape.thumbnailDataUrl).toBe('data:image/png;base64,thumb');
  });

  it('saves tape with error status on failed demo', async () => {
    const { store } = createMockTapeStore();

    chromeMock.tabs.sendMessage.mockResolvedValue({
      results: [
        {
          stepNumber: 1,
          action: 'click',
          description: 'Click missing button',
          passed: false,
          duration: 50,
          error: 'Element not found',
          timestamp: Date.now(),
        },
      ],
    });

    chromeMock.tabCapture.capture.mockImplementation((_opts: any, cb: Function) => {
      chromeMock.runtime.lastError = { message: 'Not available' } as any;
      cb(null);
      chromeMock.runtime.lastError = null;
    });

    chromeMock.tabs.captureVisibleTab.mockImplementation((_opts: any, cb: Function) => {
      cb('data:image/png;base64,thumb');
    });

    const message = createStartDemoMessage();
    const result = await runFullDemo(message, 1, { tapeStore: store });

    expect(result.passed).toBe(false);
    expect(store.save).toHaveBeenCalledOnce();

    const savedTape = store.save.mock.calls[0][0];
    expect(savedTape.passed).toBe(false);
    expect(savedTape.status).toBe('error');
  });

  it('continues without video when recording is unavailable', async () => {
    const { store } = createMockTapeStore();

    chromeMock.tabs.sendMessage.mockResolvedValue({
      results: [
        {
          stepNumber: 1,
          action: 'click',
          description: 'Click button',
          passed: true,
          duration: 50,
          timestamp: Date.now(),
        },
      ],
    });

    // tabCapture fails
    chromeMock.tabCapture.capture.mockImplementation((_opts: any, cb: Function) => {
      chromeMock.runtime.lastError = { message: 'Tab capture not available' } as any;
      cb(null);
      chromeMock.runtime.lastError = null;
    });

    chromeMock.tabs.captureVisibleTab.mockImplementation((_opts: any, cb: Function) => {
      cb(null);
    });

    const message = createStartDemoMessage();
    const result = await runFullDemo(message, 1, { tapeStore: store });

    // Should succeed despite no recording
    expect(result.passed).toBe(true);
    expect(result.videoMetadata).toBeNull();
  });

  it('handles tape store save failure gracefully', async () => {
    const store = {
      init: vi.fn().mockResolvedValue(undefined),
      save: vi.fn().mockRejectedValue(new Error('IndexedDB failed')),
    };

    chromeMock.tabs.sendMessage.mockResolvedValue({
      results: [
        {
          stepNumber: 1,
          action: 'click',
          description: 'Click button',
          passed: true,
          duration: 50,
          timestamp: Date.now(),
        },
      ],
    });

    chromeMock.tabCapture.capture.mockImplementation((_opts: any, cb: Function) => {
      chromeMock.runtime.lastError = { message: 'Not available' } as any;
      cb(null);
      chromeMock.runtime.lastError = null;
    });

    chromeMock.tabs.captureVisibleTab.mockImplementation((_opts: any, cb: Function) => {
      cb(null);
    });

    const message = createStartDemoMessage();

    // Should not throw even if tape store fails
    const result = await runFullDemo(message, 1, { tapeStore: store });
    expect(result.passed).toBe(true);
    expect(store.save).toHaveBeenCalledOnce();
  });

  it('handles content script failure', async () => {
    const { store } = createMockTapeStore();

    // Content script throws
    chromeMock.tabs.sendMessage.mockRejectedValue(
      new Error('Content script not ready'),
    );

    chromeMock.tabCapture.capture.mockImplementation((_opts: any, cb: Function) => {
      chromeMock.runtime.lastError = { message: 'Not available' } as any;
      cb(null);
      chromeMock.runtime.lastError = null;
    });

    const message = createStartDemoMessage();

    // runFullDemo calls handleStartDemo which catches the error and returns
    // a failed DemoResult rather than throwing
    const result = await runFullDemo(message, 1, { tapeStore: store });
    expect(result.passed).toBe(false);
    expect(result.summary).toContain('failed');
  });

  it('passes correct test plan to content script', async () => {
    const { store } = createMockTapeStore();

    const plan = createTestPlan({
      planName: 'custom-plan',
      steps: [
        { stepNumber: 1, action: 'navigate', description: 'Go to page', target: '/page' },
        { stepNumber: 2, action: 'click', description: 'Click', selector: '#btn' },
      ],
    });

    chromeMock.tabs.sendMessage.mockResolvedValue({
      results: [
        { stepNumber: 1, action: 'navigate', description: 'Go to page', passed: true, duration: 100, timestamp: Date.now() },
        { stepNumber: 2, action: 'click', description: 'Click', passed: true, duration: 50, timestamp: Date.now() },
      ],
    });

    chromeMock.tabCapture.capture.mockImplementation((_opts: any, cb: Function) => {
      chromeMock.runtime.lastError = { message: 'Not available' } as any;
      cb(null);
      chromeMock.runtime.lastError = null;
    });

    chromeMock.tabs.captureVisibleTab.mockImplementation((_opts: any, cb: Function) => {
      cb(null);
    });

    const message = createStartDemoMessage(plan);
    const result = await runFullDemo(message, 42, { tapeStore: store });

    // Verify the content script was called with the right tab and plan
    expect(chromeMock.tabs.sendMessage).toHaveBeenCalledWith(42, {
      type: 'execute_plan',
      payload: { steps: plan.steps },
    });

    expect(result.testPlanId).toBe('custom-plan');
    expect(result.steps).toHaveLength(2);
  });
});
