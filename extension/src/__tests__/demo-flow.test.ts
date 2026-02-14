/**
 * Tests for the full demo flow orchestrator.
 * Verifies that runFullDemo correctly coordinates the recorder,
 * content script execution, tape storage, and result assembly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StartDemoMessage, TestPlan, DemoResult } from '@popcorn/shared';
import { createMessage } from '@popcorn/shared';
import { runFullDemo, reloadTab } from '../background/demo-flow.js';
import type { DemoFlowDeps } from '../background/demo-flow.js';

// Mock the offscreen manager so Recorder doesn't actually create documents
vi.mock('../background/offscreen-manager.js', () => ({
  ensureOffscreenDocument: vi.fn(() => Promise.resolve()),
  closeOffscreenDocument: vi.fn(() => Promise.resolve()),
}));

// -- Chrome mock --
const chromeMock = {
  tabs: {
    sendMessage: vi.fn(),
    query: vi.fn(),
    update: vi.fn(),
    reload: vi.fn(),
    get: vi.fn(() => Promise.resolve({ url: '' })),
    captureVisibleTab: vi.fn(),
    onUpdated: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  tabCapture: {
    getMediaStreamId: vi.fn(
      (_options: unknown, callback: (streamId: string) => void) => {
        // Default: simulate failure so recording is unavailable (matches existing test behavior)
        (chromeMock.runtime as any).lastError = { message: 'Tab capture not available' };
        callback('');
        (chromeMock.runtime as any).lastError = null;
      },
    ),
  },
  runtime: {
    lastError: null as chrome.runtime.LastError | null,
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    sendMessage: vi.fn(() => Promise.resolve({ success: true })),
    getURL: vi.fn((path: string) => `chrome-extension://mock-id/${path}`),
    getContexts: vi.fn(() => Promise.resolve([])),
  },
  offscreen: {
    createDocument: vi.fn(() => Promise.resolve()),
    closeDocument: vi.fn(() => Promise.resolve()),
    Reason: { USER_MEDIA: 'USER_MEDIA' },
  },
};

vi.stubGlobal('chrome', chromeMock);

// ---------------------------------------------------------------------------
// Mock IndexedDB for blob transfer between offscreen and background
// ---------------------------------------------------------------------------

const transferStore = new Map<string, Blob>();

function createMockIDBObjectStore() {
  return {
    put(value: any, key: string) {
      transferStore.set(key, value);
      const req = { result: undefined as any, onsuccess: null as any, onerror: null as any };
      Promise.resolve().then(() => req.onsuccess?.());
      return req;
    },
    get(key: string) {
      const result = transferStore.get(key);
      const req = { result, onsuccess: null as any, onerror: null as any };
      Promise.resolve().then(() => req.onsuccess?.());
      return req;
    },
    delete(key: string) {
      transferStore.delete(key);
      const req = { result: undefined as any, onsuccess: null as any, onerror: null as any };
      Promise.resolve().then(() => req.onsuccess?.());
      return req;
    },
  };
}

function createMockIDBTransaction() {
  const store = createMockIDBObjectStore();
  const tx = {
    objectStore: vi.fn(() => store),
    oncomplete: null as any,
  };
  Promise.resolve().then(() => tx.oncomplete?.());
  return tx;
}

function createMockIDBDatabase() {
  return {
    objectStoreNames: { contains: vi.fn(() => true) },
    createObjectStore: vi.fn(),
    transaction: vi.fn(() => createMockIDBTransaction()),
    close: vi.fn(),
  };
}

const mockIndexedDB = {
  open(_name: string, _version?: number) {
    const db = createMockIDBDatabase();
    const req = {
      result: db,
      onsuccess: null as any,
      onerror: null as any,
      onupgradeneeded: null as any,
    };
    Promise.resolve().then(() => req.onsuccess?.());
    return req;
  },
};

vi.stubGlobal('indexedDB', mockIndexedDB);

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

/**
 * Helper to make tabCapture.getMediaStreamId fail (default behavior).
 * This simulates "recording unavailable" so tests focus on the demo flow.
 */
function mockRecordingUnavailable() {
  chromeMock.tabCapture.getMediaStreamId.mockImplementation(
    (_options: unknown, callback: (streamId: string) => void) => {
      (chromeMock.runtime as any).lastError = { message: 'Tab capture not available' };
      callback('');
      (chromeMock.runtime as any).lastError = null;
    },
  );
}

/**
 * Helper to make tabCapture.getMediaStreamId succeed with recording.
 */
function mockRecordingAvailable() {
  chromeMock.tabCapture.getMediaStreamId.mockImplementation(
    (_options: unknown, callback: (streamId: string) => void) => {
      callback('mock-stream-id');
    },
  );

  // Also mock sendMessage to handle offscreen recording messages
  chromeMock.runtime.sendMessage.mockImplementation((message: any) => {
    if (message.type === 'offscreen-start-recording') {
      return Promise.resolve({ success: true });
    }
    if (message.type === 'offscreen-stop-recording') {
      // Simulate offscreen writing blob to shared IndexedDB
      const blobKey = `recording-${Date.now()}`;
      transferStore.set(blobKey, new Blob(['video-data'], { type: 'video/webm;codecs=vp9' }));
      return Promise.resolve({
        success: true,
        blobKey,
        mimeType: 'video/webm;codecs=vp9',
        duration: 2.0,
        fileSize: 1024,
        resolution: { width: 1920, height: 1080 },
        timestamp: Date.now(),
      });
    }
    return Promise.resolve({ success: true });
  });
}

describe('demo-flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transferStore.clear();
    chromeMock.runtime.lastError = null;
    // Default: recording unavailable
    mockRecordingUnavailable();

    // Make chrome.tabs.update trigger the onUpdated listener with 'complete'
    // so navigateTab resolves. This simulates Chrome's tab navigation lifecycle.
    chromeMock.tabs.update.mockImplementation((_tabId: number, _updateProps: any) => {
      // Fire the onUpdated listener asynchronously
      setTimeout(() => {
        const listeners = chromeMock.tabs.onUpdated.addListener.mock.calls;
        for (const [listener] of listeners) {
          listener(_tabId, { status: 'complete' });
        }
      }, 0);
      return Promise.resolve({});
    });

    // Make chrome.tabs.reload trigger the onUpdated listener with 'complete'
    // so reloadTab resolves. Same pattern as chrome.tabs.update above.
    chromeMock.tabs.reload.mockImplementation((_tabId: number) => {
      setTimeout(() => {
        const listeners = chromeMock.tabs.onUpdated.addListener.mock.calls;
        for (const [listener] of listeners) {
          listener(_tabId, { status: 'complete' });
        }
      }, 0);
      return Promise.resolve();
    });
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
        { stepNumber: 2, action: 'click', description: 'Click', passed: true, duration: 50, timestamp: Date.now() },
      ],
    });

    chromeMock.tabs.captureVisibleTab.mockImplementation((_opts: any, cb: Function) => {
      cb(null);
    });

    const message = createStartDemoMessage(plan);
    const result = await runFullDemo(message, 42, { tapeStore: store });

    // Navigate step is handled by the background via chrome.tabs.update,
    // so only the click step is sent to the content script
    expect(chromeMock.tabs.update).toHaveBeenCalledWith(42, { url: '/page' });
    expect(chromeMock.tabs.sendMessage).toHaveBeenCalledWith(42, {
      type: 'execute_plan',
      payload: {
        steps: [
          { stepNumber: 2, action: 'click', description: 'Click', selector: '#btn' },
        ],
      },
    });

    expect(result.testPlanId).toBe('custom-plan');
  });

  it('captures video when recording is available', async () => {
    mockRecordingAvailable();
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

    chromeMock.tabs.captureVisibleTab.mockImplementation((_opts: any, cb: Function) => {
      cb('data:image/png;base64,thumb');
    });

    const message = createStartDemoMessage();
    const result = await runFullDemo(message, 1, { tapeStore: store });

    expect(result.passed).toBe(true);
    expect(result.videoMetadata).toBeDefined();
    expect(result.videoMetadata?.mimeType).toContain('video/webm');

    // Tape should have a video blob saved
    const savedTape = store.save.mock.calls[0][0];
    expect(savedTape.videoBlob).toBeInstanceOf(Blob);
    expect(savedTape.videoBlob.size).toBeGreaterThan(0);
  });

  it('skips recording when skipRecording is true', async () => {
    mockRecordingAvailable();
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

    chromeMock.tabs.captureVisibleTab.mockImplementation((_opts: any, cb: Function) => {
      cb('data:image/png;base64,thumb');
    });

    const message = createStartDemoMessage();
    const result = await runFullDemo(message, 1, {
      tapeStore: store,
      skipRecording: true,
    });

    expect(result.passed).toBe(true);
    // Recording should NOT have been attempted
    expect(chromeMock.tabCapture.getMediaStreamId).not.toHaveBeenCalled();
    expect(result.videoMetadata).toBeNull();
  });

  it('saves testPlan in tape record', async () => {
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

    chromeMock.tabs.captureVisibleTab.mockImplementation((_opts: any, cb: Function) => {
      cb('data:image/png;base64,thumb');
    });

    const message = createStartDemoMessage();
    await runFullDemo(message, 1, { tapeStore: store });

    expect(store.save).toHaveBeenCalledOnce();
    const savedTape = store.save.mock.calls[0][0];
    expect(savedTape.testPlan).toBeDefined();
    expect(savedTape.testPlan.planName).toBe('test-plan');
    expect(savedTape.testPlan.steps).toHaveLength(1);
  });

  it('includes screenshots in result when screenshot steps return data', async () => {
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
        {
          stepNumber: 2,
          action: 'screenshot',
          description: 'Capture final state',
          passed: true,
          duration: 100,
          timestamp: Date.now(),
          screenshotDataUrl: 'data:image/png;base64,screenshotdata',
        },
      ],
    });

    chromeMock.tabs.captureVisibleTab.mockImplementation((_opts: any, cb: Function) => {
      cb('data:image/png;base64,thumb');
    });

    const message = createStartDemoMessage();
    const result = await runFullDemo(message, 1, { tapeStore: store });

    expect(result.passed).toBe(true);
    expect(result.screenshots).toHaveLength(1);
    expect(result.screenshots[0].dataUrl).toBe('data:image/png;base64,screenshotdata');
    expect(result.screenshots[0].stepNumber).toBe(2);
  });

  it('reloadTab calls chrome.tabs.reload and resolves on complete', async () => {
    await reloadTab(42);

    expect(chromeMock.tabs.reload).toHaveBeenCalledWith(42);
    expect(chromeMock.tabs.onUpdated.addListener).toHaveBeenCalled();
    expect(chromeMock.tabs.onUpdated.removeListener).toHaveBeenCalled();
  });

  it('reloads tab after saving tape to reset app state', async () => {
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

    chromeMock.tabs.captureVisibleTab.mockImplementation((_opts: any, cb: Function) => {
      cb('data:image/png;base64,thumb');
    });

    const message = createStartDemoMessage();
    await runFullDemo(message, 1, { tapeStore: store });

    // Verify tab was reloaded after demo completed
    expect(chromeMock.tabs.reload).toHaveBeenCalledWith(1);
  });

  it('includes step results for background navigate/wait steps', async () => {
    const { store } = createMockTapeStore();

    const plan = createTestPlan({
      planName: 'nav-plan',
      steps: [
        { stepNumber: 1, action: 'navigate', description: 'Navigate to page', target: 'http://localhost:3000/about' },
        { stepNumber: 2, action: 'wait', description: 'Wait for load', condition: 'timeout', timeout: 100 } as any,
        { stepNumber: 3, action: 'click', description: 'Click button', selector: '#btn' },
      ],
    });

    chromeMock.tabs.sendMessage.mockResolvedValue({
      results: [
        {
          stepNumber: 3,
          action: 'click',
          description: 'Click button',
          passed: true,
          duration: 50,
          timestamp: Date.now(),
        },
      ],
    });

    const message = createStartDemoMessage(plan);
    const result = await runFullDemo(message, 1, { tapeStore: store });

    // Navigate + wait + click = 3 step results total
    expect(result.steps.length).toBeGreaterThanOrEqual(3);

    // Background navigate step should be in the results
    const navResult = result.steps.find((s) => s.action === 'navigate' && s.description === 'Navigate to page');
    expect(navResult).toBeDefined();
    expect(navResult!.passed).toBe(true);

    // Background wait step should be in the results
    const waitResult = result.steps.find((s) => s.action === 'wait');
    expect(waitResult).toBeDefined();
    expect(waitResult!.passed).toBe(true);
  });

  it('captures screenshots from background for steps with needsBackgroundScreenshot marker', async () => {
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
        {
          stepNumber: 2,
          action: 'screenshot',
          description: 'Capture visual state',
          passed: true,
          duration: 0,
          timestamp: Date.now(),
          metadata: { needsBackgroundScreenshot: true },
        },
      ],
    });

    chromeMock.tabs.captureVisibleTab.mockImplementation((_opts: any, cb: Function) => {
      cb('data:image/png;base64,captured');
    });

    const message = createStartDemoMessage();
    const result = await runFullDemo(message, 1, { tapeStore: store });

    expect(result.passed).toBe(true);
    // captureVisibleTab called twice: once for the screenshot step, once for thumbnail
    expect(chromeMock.tabs.captureVisibleTab).toHaveBeenCalledTimes(2);
    expect(result.screenshots).toHaveLength(1);
    expect(result.screenshots[0].dataUrl).toBe('data:image/png;base64,captured');
    expect(result.screenshots[0].stepNumber).toBe(2);
  });
});
