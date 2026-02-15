/**
 * Tests for the per-element exploration flow.
 * Verifies that runExplorationDemo correctly iterates through targets,
 * handles navigation, screenshots, modals, and error recovery.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExplorationPlan, StepResult } from '@popcorn/shared';
import {
  runExplorationDemo,
  throttledScreenshot,
  waitForTabComplete,
  ensureContentScript,
  sendSingleAction,
} from '../background/demo-flow.js';
import type { DemoFlowDeps } from '../background/demo-flow.js';

// Mock the offscreen manager
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
    goBack: vi.fn(),
    get: vi.fn(() => Promise.resolve({ url: '', windowId: 1 })),
    captureVisibleTab: vi.fn(),
    onUpdated: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  tabCapture: {
    getMediaStreamId: vi.fn((_opts: unknown, cb: (id: string) => void) => {
      (chromeMock.runtime as any).lastError = { message: 'No gesture' };
      cb('');
      (chromeMock.runtime as any).lastError = null;
    }),
  },
  runtime: {
    lastError: null as chrome.runtime.LastError | null,
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    sendMessage: vi.fn(() => Promise.resolve({ success: true })),
    getURL: vi.fn((p: string) => `chrome-extension://mock/${p}`),
    getContexts: vi.fn(() => Promise.resolve([])),
  },
  offscreen: {
    createDocument: vi.fn(() => Promise.resolve()),
    closeDocument: vi.fn(() => Promise.resolve()),
    Reason: { USER_MEDIA: 'USER_MEDIA' },
  },
  scripting: {
    executeScript: vi.fn(() => Promise.resolve()),
  },
  windows: {
    update: vi.fn(() => Promise.resolve()),
  },
  action: {
    setBadgeText: vi.fn(),
    setBadgeBackgroundColor: vi.fn(),
    setTitle: vi.fn(),
  },
  storage: {
    local: {
      get: vi.fn(() => Promise.resolve({})),
      set: vi.fn(() => Promise.resolve()),
    },
  },
};

vi.stubGlobal('chrome', chromeMock);

// Mock IndexedDB (needed by Recorder via tape-store)
vi.stubGlobal('indexedDB', {
  open() {
    const db = {
      objectStoreNames: { contains: vi.fn(() => true) },
      createObjectStore: vi.fn(),
      transaction: vi.fn(() => ({
        objectStore: vi.fn(() => ({
          put: vi.fn(() => ({ onsuccess: null, onerror: null })),
          get: vi.fn(() => ({ onsuccess: null, onerror: null })),
          delete: vi.fn(() => ({ onsuccess: null, onerror: null })),
        })),
        oncomplete: null,
      })),
      close: vi.fn(),
    };
    const req = { result: db, onsuccess: null as any, onerror: null as any, onupgradeneeded: null as any };
    Promise.resolve().then(() => req.onsuccess?.());
    return req;
  },
});

// -- Helpers --
function createMockTapeStore() {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue('tape-123'),
  };
}

function createBasicPlan(overrides?: Partial<ExplorationPlan>): ExplorationPlan {
  return {
    baseUrl: 'http://localhost:3000',
    mode: 'smart',
    targets: [],
    formFillSteps: [],
    ...overrides,
  };
}

/** Helper to make sendMessage return expected results for specific call patterns. */
function mockSendMessageSequence(responses: Array<Record<string, unknown> | Error>) {
  let callIdx = 0;
  chromeMock.tabs.sendMessage.mockImplementation(async () => {
    if (callIdx >= responses.length) {
      return { results: [] };
    }
    const resp = responses[callIdx++];
    if (resp instanceof Error) throw resp;
    return resp;
  });
}

/** Creates a StepResult matching what sendSingleAction would return. */
function makeResult(overrides: Partial<StepResult> = {}): StepResult {
  return {
    stepNumber: 1,
    action: 'click',
    description: 'test',
    passed: true,
    duration: 10,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('exploration-flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chromeMock.runtime.lastError = null;

    // Store listeners so we can fire them from update/goBack/reload
    const storedListeners: Function[] = [];
    chromeMock.tabs.onUpdated.addListener.mockImplementation((listener: Function) => {
      storedListeners.push(listener);
    });

    const fireTabComplete = (tabId: number) => {
      setTimeout(() => {
        for (const listener of storedListeners) {
          listener(tabId, { status: 'complete' });
        }
      }, 0);
    };

    // Default: tabs.update triggers onUpdated with 'complete'
    chromeMock.tabs.update.mockImplementation((_tabId: number) => {
      fireTabComplete(_tabId);
      return Promise.resolve({});
    });

    chromeMock.tabs.goBack.mockImplementation((_tabId: number, callback?: () => void) => {
      if (callback) callback(); // Signal no runtime error
      fireTabComplete(_tabId);
      return Promise.resolve();
    });

    chromeMock.tabs.reload.mockImplementation((_tabId: number) => {
      fireTabComplete(_tabId);
      return Promise.resolve();
    });

    chromeMock.tabs.captureVisibleTab.mockImplementation((_opts: any, cb: Function) => {
      cb('data:image/png;base64,screenshot');
    });

    chromeMock.tabs.get.mockResolvedValue({ url: 'http://localhost:3000', windowId: 1 });
  });

  describe('waitForTabComplete', () => {
    it('resolves true when tab completes', async () => {
      // Override addListener to fire the callback after a short delay
      chromeMock.tabs.onUpdated.addListener.mockImplementation((listener: Function) => {
        setTimeout(() => listener(1, { status: 'complete' }), 5);
      });

      const result = await waitForTabComplete(1, 5000);
      expect(result).toBe(true);
      expect(chromeMock.tabs.onUpdated.removeListener).toHaveBeenCalled();
    });

    it('resolves false on timeout (SPA navigation)', async () => {
      // Don't fire the callback — simulates SPA that doesn't trigger 'complete'
      chromeMock.tabs.onUpdated.addListener.mockImplementation(() => {});

      const result = await waitForTabComplete(1, 50);
      expect(result).toBe(false);
    });
  });

  describe('ensureContentScript', () => {
    it('skips injection when content script responds to ping', async () => {
      chromeMock.tabs.sendMessage.mockResolvedValue({ pong: true });
      await ensureContentScript(1);
      expect(chromeMock.scripting.executeScript).not.toHaveBeenCalled();
    });

    it('injects content script when ping fails', async () => {
      chromeMock.tabs.sendMessage.mockRejectedValue(new Error('No listener'));
      await ensureContentScript(1);
      expect(chromeMock.scripting.executeScript).toHaveBeenCalledWith({
        target: { tabId: 1 },
        files: ['content.js'],
      });
    });
  });

  describe('sendSingleAction', () => {
    it('sends step and returns result', async () => {
      const expected = makeResult({ stepNumber: 5, action: 'click', passed: true });
      chromeMock.tabs.sendMessage.mockResolvedValue({ results: [expected] });

      const result = await sendSingleAction(1, {
        stepNumber: 5,
        action: 'click',
        description: 'Click btn',
        selector: '#btn',
      });

      expect(result.stepNumber).toBe(5);
      expect(result.passed).toBe(true);
    });

    it('throws when no result returned', async () => {
      chromeMock.tabs.sendMessage.mockResolvedValue({ results: [] });

      await expect(
        sendSingleAction(1, { stepNumber: 1, action: 'click', description: 'Click', selector: '#x' }),
      ).rejects.toThrow('No result from content script');
    });
  });

  describe('throttledScreenshot', () => {
    it('captures screenshot', async () => {
      const dataUrl = await throttledScreenshot(1);
      expect(dataUrl).toBe('data:image/png;base64,screenshot');
      expect(chromeMock.tabs.captureVisibleTab).toHaveBeenCalled();
    });
  });

  describe('runExplorationDemo', () => {
    it('runs empty plan with no targets — captures initial + final screenshots', async () => {
      const store = createMockTapeStore();
      const plan = createBasicPlan();

      // No targets, so only navigation and screenshots
      const result = await runExplorationDemo(plan, 1, { tapeStore: store });

      expect(result.testPlanId).toBe('exploration-smart');
      // Should have navigate + initial screenshot + final screenshot
      expect(result.steps.length).toBeGreaterThanOrEqual(2);
      expect(result.screenshots.length).toBeGreaterThanOrEqual(1);
      expect(store.save).toHaveBeenCalled();
    });

    it('executes form fill steps before exploring targets', async () => {
      const store = createMockTapeStore();
      const plan = createBasicPlan({
        formFillSteps: [
          { stepNumber: 1, action: 'fill', description: 'Fill email', selector: '#email', value: 'test@test.com' },
        ],
        targets: [],
      });

      // Ping response for ensureContentScript
      chromeMock.tabs.sendMessage
        .mockResolvedValueOnce({ pong: true }) // ensureContentScript ping
        .mockResolvedValueOnce({
          results: [makeResult({ action: 'fill', passed: true })],
        });

      const result = await runExplorationDemo(plan, 1, { tapeStore: store });
      expect(result.passed).toBe(true);

      // Verify form fill was sent
      const sendCalls = chromeMock.tabs.sendMessage.mock.calls;
      const formFillCall = sendCalls.find(
        (c: any) => c[1]?.type === 'execute_plan' && c[1]?.payload?.steps?.[0]?.action === 'fill',
      );
      expect(formFillCall).toBeDefined();
    });

    it('clicks button, takes screenshot, continues to next element', async () => {
      const store = createMockTapeStore();
      const plan = createBasicPlan({
        targets: [
          { selector: '#btn1', type: 'button', label: 'Submit', mayNavigate: false },
          { selector: '#btn2', type: 'button', label: 'Cancel', mayNavigate: false },
        ],
      });

      // For each target: ensureContentScript (ping) + check_actionability + get_page_state + click + screenshot steps
      chromeMock.tabs.sendMessage.mockImplementation(async (_tabId: number, msg: any) => {
        if (msg.type === 'ping') return { pong: true };
        if (msg.type === 'execute_plan') {
          const step = msg.payload?.steps?.[0];
          if (!step) return { results: [] };
          if (step.action === 'check_actionability') {
            return { results: [makeResult({ action: 'check_actionability', passed: true, metadata: { actionable: true } })] };
          }
          if (step.action === 'get_page_state') {
            return { results: [makeResult({ action: 'get_page_state', metadata: { url: 'http://localhost:3000', title: 'Test' } })] };
          }
          if (step.action === 'click') {
            return { results: [makeResult({ action: 'click', metadata: { urlChanged: false, modalDetected: null, domSettled: true } })] };
          }
          if (step.action === 'wait') {
            return { results: [makeResult({ action: 'wait', passed: true })] };
          }
        }
        return { results: [] };
      });

      const result = await runExplorationDemo(plan, 1, { tapeStore: store });

      // Should have explored both buttons
      const clickResults = result.steps.filter((s) => s.action === 'click');
      expect(clickResults.length).toBeGreaterThanOrEqual(2);
      // Screenshots taken after each click
      expect(result.screenshots.length).toBeGreaterThanOrEqual(2);
    });

    it('skips unactionable elements', async () => {
      const store = createMockTapeStore();
      const plan = createBasicPlan({
        targets: [
          { selector: '#hidden-btn', type: 'button', label: 'Hidden Button', mayNavigate: false },
        ],
      });

      chromeMock.tabs.sendMessage.mockImplementation(async (_tabId: number, msg: any) => {
        if (msg.type === 'ping') return { pong: true };
        if (msg.type === 'execute_plan') {
          const step = msg.payload?.steps?.[0];
          if (step?.action === 'check_actionability') {
            return {
              results: [makeResult({
                action: 'check_actionability',
                passed: false,
                metadata: { actionable: false, reason: 'hidden' },
              })],
            };
          }
        }
        return { results: [] };
      });

      const result = await runExplorationDemo(plan, 1, { tapeStore: store });

      // No click should have been attempted
      const clickResults = result.steps.filter((s) => s.action === 'click');
      expect(clickResults).toHaveLength(0);
    });

    it('handles URL change: waits for tab, re-injects, screenshots, goes back', async () => {
      const store = createMockTapeStore();
      const plan = createBasicPlan({
        targets: [
          { selector: 'a.about', type: 'link', label: 'About', href: '/about', mayNavigate: true },
        ],
      });

      chromeMock.tabs.sendMessage.mockImplementation(async (_tabId: number, msg: any) => {
        if (msg.type === 'ping') return { pong: true };
        if (msg.type === 'execute_plan') {
          const step = msg.payload?.steps?.[0];
          if (step?.action === 'check_actionability') {
            return { results: [makeResult({ action: 'check_actionability', passed: true, metadata: { actionable: true } })] };
          }
          if (step?.action === 'get_page_state') {
            return { results: [makeResult({ action: 'get_page_state', metadata: { url: 'http://localhost:3000', title: 'Home' } })] };
          }
          if (step?.action === 'click') {
            return { results: [makeResult({ action: 'click', metadata: { urlChanged: true, modalDetected: null, domSettled: true } })] };
          }
          if (step?.action === 'wait') {
            return { results: [makeResult({ action: 'wait', passed: true })] };
          }
        }
        return { results: [] };
      });

      const result = await runExplorationDemo(plan, 1, { tapeStore: store });

      // go_back should have been called after clicking the link
      expect(chromeMock.tabs.goBack).toHaveBeenCalled();

      // go_back step should appear in results
      const goBackResult = result.steps.find((s) => s.action === 'go_back');
      expect(goBackResult).toBeDefined();
      expect(goBackResult!.passed).toBe(true);
    }, 15000); // waitForTabComplete times out (3s) + screenshot throttle (1.1s each) adds up

    it('single element failure does not abort the run', async () => {
      const store = createMockTapeStore();
      const plan = createBasicPlan({
        targets: [
          { selector: '#failing-btn', type: 'button', label: 'Failing Button', mayNavigate: false },
          { selector: '#ok-btn', type: 'button', label: 'OK Button', mayNavigate: false },
        ],
      });

      let targetIdx = 0;
      chromeMock.tabs.sendMessage.mockImplementation(async (_tabId: number, msg: any) => {
        if (msg.type === 'ping') return { pong: true };
        if (msg.type === 'execute_plan') {
          const step = msg.payload?.steps?.[0];
          if (step?.action === 'check_actionability') {
            targetIdx++;
            if (targetIdx === 1) {
              // First target throws during actionability check
              throw new Error('Injection failed');
            }
            return { results: [makeResult({ action: 'check_actionability', passed: true, metadata: { actionable: true } })] };
          }
          if (step?.action === 'get_page_state') {
            return { results: [makeResult({ action: 'get_page_state', metadata: { url: 'http://localhost:3000', title: 'Test' } })] };
          }
          if (step?.action === 'click') {
            return { results: [makeResult({ action: 'click', metadata: { urlChanged: false, modalDetected: null, domSettled: true } })] };
          }
          if (step?.action === 'wait') {
            return { results: [makeResult({ action: 'wait', passed: true })] };
          }
        }
        return { results: [] };
      });

      const result = await runExplorationDemo(plan, 1, { tapeStore: store });

      // Should have a SKIPPED result for the first target and a click for the second
      const skippedResult = result.steps.find((s) => s.description?.includes('SKIPPED'));
      expect(skippedResult).toBeDefined();
      const clickResults = result.steps.filter((s) => s.action === 'click' && s.passed);
      expect(clickResults.length).toBeGreaterThanOrEqual(1);
    });

    it('saves tape to store after exploration', async () => {
      const store = createMockTapeStore();
      const plan = createBasicPlan();

      await runExplorationDemo(plan, 1, { tapeStore: store });

      expect(store.save).toHaveBeenCalledOnce();
      const savedTape = store.save.mock.calls[0][0];
      expect(savedTape.testPlanId).toBe('exploration-smart');
      expect(savedTape.testPlan.tags).toContain('exploration');
    });

    it('reloads tab after exploration completes', async () => {
      const store = createMockTapeStore();
      const plan = createBasicPlan();

      await runExplorationDemo(plan, 1, { tapeStore: store });

      expect(chromeMock.tabs.reload).toHaveBeenCalledWith(1);
    });

    it('calls onTapeSaved callback after saving', async () => {
      const store = createMockTapeStore();
      const onTapeSaved = vi.fn();
      const plan = createBasicPlan();

      await runExplorationDemo(plan, 1, { tapeStore: store, onTapeSaved });

      expect(onTapeSaved).toHaveBeenCalledWith('tape-123');
    });

    it('detects modal after click and dismisses it', async () => {
      const store = createMockTapeStore();
      const plan = createBasicPlan({
        targets: [
          { selector: '#modal-btn', type: 'button', label: 'Open Modal', mayNavigate: false },
        ],
      });

      chromeMock.tabs.sendMessage.mockImplementation(async (_tabId: number, msg: any) => {
        if (msg.type === 'ping') return { pong: true };
        if (msg.type === 'execute_plan') {
          const step = msg.payload?.steps?.[0];
          if (step?.action === 'check_actionability') {
            return { results: [makeResult({ action: 'check_actionability', passed: true, metadata: { actionable: true } })] };
          }
          if (step?.action === 'get_page_state') {
            return { results: [makeResult({ action: 'get_page_state', metadata: { url: 'http://localhost:3000', title: 'Test' } })] };
          }
          if (step?.action === 'click') {
            return {
              results: [makeResult({
                action: 'click',
                metadata: {
                  urlChanged: false,
                  modalDetected: { type: 'dialog', selector: 'dialog[open]', dismissSelector: '.close-btn' },
                  domSettled: true,
                },
              })],
            };
          }
          if (step?.action === 'dismiss_modal') {
            return { results: [makeResult({ action: 'dismiss_modal', passed: true, metadata: { dismissed: true } })] };
          }
          if (step?.action === 'wait') {
            return { results: [makeResult({ action: 'wait', passed: true })] };
          }
        }
        return { results: [] };
      });

      const result = await runExplorationDemo(plan, 1, { tapeStore: store });

      // Should have a dismiss_modal step in results
      const dismissResult = result.steps.find((s) => s.action === 'dismiss_modal');
      expect(dismissResult).toBeDefined();
      expect(dismissResult!.passed).toBe(true);
    });

    it('uses exhaustive mode label in testPlanId', async () => {
      const store = createMockTapeStore();
      const plan = createBasicPlan({ mode: 'exhaustive' });

      const result = await runExplorationDemo(plan, 1, { tapeStore: store });

      expect(result.testPlanId).toBe('exploration-exhaustive');
    });
  });
});
