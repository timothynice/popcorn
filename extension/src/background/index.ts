/**
 * Background service worker for the Popcorn Chrome extension.
 * Acts as the integration hub: listens for messages from the hook
 * (via internal and external messaging), orchestrates demos through
 * the full recording pipeline, and persists results as tape records.
 */

import type { PopcornMessage, StartDemoMessage } from '@popcorn/shared';
import { isPopcornMessage, createMessage } from '@popcorn/shared';
import { initExternalMessaging } from './external-messaging.js';
import { initBridgePolling, isHookConnected, discoverHookPort } from './bridge-client.js';
import { runFullDemo, runExplorationDemo, reloadTab } from './demo-flow.js';
import type { ExplorationPlan } from '@popcorn/shared';
import { captureScreenshot } from '../capture/screenshot.js';
import { TapeStore } from '../storage/tape-store.js';
import type { DemoState } from './state.js';

// -- Singleton TapeStore instance --
const tapeStore = new TapeStore();
let tapeStoreReady = false;

async function ensureTapeStore(): Promise<void> {
  if (!tapeStoreReady) {
    await tapeStore.init();
    tapeStoreReady = true;
  }
}

// -- Current demo status for the popup --
let currentStatus: DemoState = 'idle';
let currentError: string | null = null;

/** Update the extension icon badge to reflect the current demo state. */
function updateBadge(status: DemoState): void {
  switch (status) {
    case 'recording':
      chrome.action.setBadgeText({ text: 'REC' });
      chrome.action.setBadgeBackgroundColor({ color: '#e53e3e' });
      chrome.action.setTitle({ title: 'Popcorn \u2014 Recording...' });
      break;
    case 'complete':
      chrome.action.setBadgeText({ text: '\u2713' });
      chrome.action.setBadgeBackgroundColor({ color: '#4ade80' });
      chrome.action.setTitle({ title: 'Popcorn \u2014 Done!' });
      break;
    case 'error':
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#f87171' });
      chrome.action.setTitle({ title: 'Popcorn \u2014 Error' });
      break;
    case 'idle':
    default:
      chrome.action.setBadgeText({ text: '' });
      chrome.action.setTitle({ title: 'Popcorn' });
      break;
  }
}

/** Update internal state + badge only (no messaging). Use during the demo
 *  pipeline when the popup is closed and the offscreen document is active,
 *  to avoid sending stray messages that could interfere with recording. */
function updateStatus(status: DemoState, error?: string | null): void {
  currentStatus = status;
  currentError = error ?? null;
  updateBadge(status);
}

/** Update state + badge AND broadcast via chrome.runtime.sendMessage.
 *  Only use when the popup might be open to receive the message and the
 *  offscreen document is NOT active (i.e. before/after the demo pipeline). */
function broadcastStatus(status: DemoState, error?: string | null): void {
  updateStatus(status, error);
  chrome.runtime.sendMessage({
    type: 'status_update',
    payload: { status, error: error ?? null },
  }).catch(() => {
    // Popup may not be open; ignore errors
  });
}

/** Notify the popup that a new tape was saved so it can refresh. */
function notifyTapeSaved(tapeId: string): void {
  chrome.runtime.sendMessage({
    type: 'tape_saved',
    payload: { tapeId },
  }).catch(() => {
    // Popup may not be open; ignore errors
  });
}

/** Bridge message handler for HTTP polling. */
async function handleBridgeMessage(rawMessage: unknown): Promise<unknown> {
  if (!rawMessage || typeof rawMessage !== 'object') return null;
  const msg = rawMessage as Record<string, unknown>;

  if (msg.type === 'start_demo' && msg.payload && msg.timestamp) {
    try {
      const result = await handleStartDemoMessage(
        rawMessage as StartDemoMessage,
        {} as chrome.runtime.MessageSender,
      );
      return result;
    } catch (err) {
      console.error('[Popcorn] Bridge demo failed:', err);
      return null;
    }
  }

  if (msg.type === 'hook_ready') {
    console.log('[Popcorn] Hook connected via bridge:', msg.payload);
    return createMessage('extension_ready', { extensionVersion: '0.1.0' });
  }

  return null;
}

// -- Initialize external messaging for hook communication --
initExternalMessaging();
initBridgePolling(handleBridgeMessage);
console.log('[Popcorn] Background script loaded, bridge polling initialized');

// -- Listen for internal messages (from popup or content script relay) --
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle non-Popcorn utility messages first
  if (message && typeof message === 'object' && !isPopcornMessage(message)) {
    switch (message.type) {
      case 'get_status':
        sendResponse({ status: currentStatus, error: currentError });
        return false;
      case 'ping':
        sendResponse({ pong: true });
        return false;
      case 'get_hook_status':
        sendResponse({ hookConnected: isHookConnected() });
        return false;
      case 'capture_screenshot':
        captureScreenshot()
          .then((dataUrl) => sendResponse({ dataUrl }))
          .catch((err) => sendResponse({ error: err instanceof Error ? err.message : String(err) }));
        return true; // Keep channel open for async response
      case 'rerun_with_recording':
        handleRerunWithRecording(message.payload?.tapeId)
          .then((result) => sendResponse({ success: true, result }))
          .catch((err) => sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) }));
        return true; // Keep channel open for async response
      case 'scan_page':
        handleScanPage()
          .then((elements) => sendResponse({ success: true, elements }))
          .catch((err) => sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) }));
        return true; // Keep channel open for async response
      case 'get_tape_count':
        ensureTapeStore()
          .then(() => tapeStore.getAll())
          .then((tapes) => sendResponse({ count: tapes.length }))
          .catch(() => sendResponse({ count: 0 }));
        return true;
      case 'clear_tapes':
        ensureTapeStore()
          .then(() => tapeStore.clear())
          .then(() => sendResponse({ success: true }))
          .catch((err) => sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) }));
        return true;
      case 'get_config':
        fetchHookConfig()
          .then((config) => sendResponse({ success: true, config }))
          .catch((err) => sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) }));
        return true;
      case 'set_config':
        updateHookConfig(message.payload?.config)
          .then(() => sendResponse({ success: true }))
          .catch((err) => sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) }));
        return true;
      case 'get_plans':
        fetchPlans()
          .then((plans) => sendResponse({ success: true, plans }))
          .catch((err) => sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) }));
        return true;
      case 'get_plan':
        fetchPlan(message.payload?.planName)
          .then((plan) => sendResponse({ success: true, plan }))
          .catch((err) => sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) }));
        return true;
      default:
        return false;
    }
  }

  if (!isPopcornMessage(message)) {
    return false;
  }

  const popcornMessage = message as PopcornMessage;

  switch (popcornMessage.type) {
    case 'start_demo':
      handleStartDemoMessage(popcornMessage as StartDemoMessage, sender)
        .then((result) => {
          sendResponse({ success: true, result });
        })
        .catch((error) => {
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      return true; // Keep channel open for async response

    case 'hook_ready':
      console.log('[Popcorn] Hook ready:', popcornMessage.payload);
      sendResponse({ success: true });
      return false;

    default:
      console.warn('[Popcorn] Unknown message type:', popcornMessage.type);
      sendResponse({ success: false, error: 'Unknown message type' });
      return false;
  }
});

/**
 * Scans the active tab's DOM for interactive elements.
 * Injects page-scanner.ts via chrome.scripting.executeScript and returns results.
 */
async function handleScanPage() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]?.id) {
    throw new Error('No active tab found');
  }

  const tabId = tabs[0].id;
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    files: ['page-scanner.js'],
  });

  if (!results || results.length === 0 || !results[0].result) {
    return [];
  }

  return results[0].result;
}

/**
 * Re-runs a previously saved demo with video recording enabled.
 * Called from the popup when the user clicks "Re-run with Recording" —
 * the button click provides the user gesture needed for tabCapture.
 */
async function handleRerunWithRecording(tapeId: string) {
  if (!tapeId) {
    throw new Error('No tape ID provided for re-run');
  }

  await ensureTapeStore();

  const tape = await tapeStore.get(tapeId);
  if (!tape) {
    throw new Error(`Tape not found: ${tapeId}`);
  }

  if (!tape.testPlan) {
    throw new Error('Tape does not have a stored test plan for re-run');
  }

  console.log(`[Popcorn] Re-running demo "${tape.testPlanId}" with recording`);

  updateStatus('recording');

  // Get the active tab
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]?.id) {
    broadcastStatus('error', 'No active tab found');
    throw new Error('No active tab found');
  }

  const tabId = tabs[0].id;

  // Force reload to ensure fresh app state before re-run.
  // Without this, the app stays at whatever state the previous demo left it
  // (e.g. slide 4 after 3 ArrowRight keypresses).
  try {
    await reloadTab(tabId);
    console.log('[Popcorn] Tab reloaded for fresh re-run state');
  } catch (err) {
    console.warn(
      '[Popcorn] Failed to reload tab before re-run:',
      err instanceof Error ? err.message : String(err),
    );
  }

  // Build a StartDemoMessage from the stored plan
  const message: StartDemoMessage = {
    type: 'start_demo',
    payload: {
      testPlanId: tape.testPlanId,
      testPlan: tape.testPlan,
      acceptanceCriteria: [],
      triggeredBy: 'popup-rerun',
    },
    timestamp: Date.now(),
  };

  try {
    // Run with recording enabled (user gesture available from popup click)
    const demoResult = await runFullDemo(message, tabId, {
      tapeStore,
      onTapeSaved: notifyTapeSaved,
      skipRecording: false,
    });

    updateStatus('complete');
    setTimeout(() => updateStatus('idle'), 3000);

    return createMessage('demo_result', demoResult);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    updateStatus('error', errorMsg);
    throw error;
  }
}

/**
 * Handles an incoming start_demo message by:
 * 1. Finding the active tab
 * 2. Navigating to the base URL if specified
 * 3. Running the full demo pipeline (record, execute, save)
 * 4. Returning the result as a demo_result message
 */
async function handleStartDemoMessage(
  message: StartDemoMessage,
  _sender: chrome.runtime.MessageSender,
) {
  console.log('[Popcorn] Received start_demo:', message.payload.testPlanId);

  updateStatus('recording');

  // Ensure TapeStore is ready
  await ensureTapeStore();

  // Get the active tab
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]?.id) {
    broadcastStatus('error', 'No active tab found');
    throw new Error('No active tab found');
  }

  const tabId = tabs[0].id;
  const currentUrl = tabs[0].url;

  // Decide whether to navigate:
  // 1. If active tab is already on an http(s) page → run in place (no navigation needed)
  // 2. If active tab is NOT on http(s) → navigate to the test plan's baseUrl as fallback
  const currentIsHttp = currentUrl?.startsWith('http://') || currentUrl?.startsWith('https://');
  const targetUrl = message.payload.testPlan.baseUrl;

  if (currentIsHttp) {
    console.log(`[Popcorn] Active tab already on ${currentUrl} — running demo in place`);
  } else if (targetUrl && (targetUrl.startsWith('http://') || targetUrl.startsWith('https://'))) {
    console.log(`[Popcorn] Active tab not on a web page, navigating to ${targetUrl}`);
    await chrome.tabs.update(tabId, { url: targetUrl });
    await new Promise((resolve) => setTimeout(resolve, 2000));
  } else {
    broadcastStatus('error', 'No web page open — open your app or set baseUrl in popcorn.config.json');
    throw new Error('No web page open and no valid baseUrl configured');
  }

  try {
    // Route exploration plans to the per-element loop
    const testPlan = message.payload.testPlan;
    if ('targets' in testPlan) {
      console.log('[Popcorn] Routing to exploration demo');
      const demoResult = await runExplorationDemo(
        testPlan as unknown as ExplorationPlan,
        tabId,
        {
          tapeStore,
          onTapeSaved: notifyTapeSaved,
          skipRecording: message.payload.triggeredBy !== 'popup',
        },
      );

      updateStatus('complete');
      setTimeout(() => updateStatus('idle'), 3000);
      return createMessage('demo_result', demoResult);
    }

    // Record video when triggered from the popup (user gesture available for
    // tabCapture). Skip recording for hook-triggered demos (no gesture).
    const skipRecording = message.payload.triggeredBy !== 'popup';
    const demoResult = await runFullDemo(message, tabId, {
      tapeStore,
      onTapeSaved: notifyTapeSaved,
      skipRecording,
    });

    updateStatus('complete');

    // Return to idle after 3 seconds so the "✓" badge stays visible
    setTimeout(() => updateStatus('idle'), 3000);

    // Wrap as a message for the response
    const resultMessage = createMessage('demo_result', demoResult);
    return resultMessage;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    updateStatus('error', errorMsg);
    throw error;
  }
}

async function fetchHookConfig() {
  const discovery = await discoverHookPort();
  if (!discovery) throw new Error('Hook not connected');
  const resp = await fetch(`http://127.0.0.1:${discovery.port}/config`, {
    headers: { 'X-Popcorn-Token': discovery.token },
  });
  if (!resp.ok) throw new Error('Failed to fetch config');
  const data = await resp.json();
  return data.config;
}

async function updateHookConfig(config: unknown) {
  const discovery = await discoverHookPort();
  if (!discovery) throw new Error('Hook not connected');
  const resp = await fetch(`http://127.0.0.1:${discovery.port}/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Popcorn-Token': discovery.token },
    body: JSON.stringify({ config }),
  });
  if (!resp.ok) throw new Error('Failed to update config');
}

async function fetchPlans() {
  const discovery = await discoverHookPort();
  if (!discovery) throw new Error('Hook not connected');
  const resp = await fetch(`http://127.0.0.1:${discovery.port}/plans`, {
    headers: { 'X-Popcorn-Token': discovery.token },
  });
  if (!resp.ok) throw new Error('Failed to fetch plans');
  const data = await resp.json();
  return data.plans;
}

async function fetchPlan(planName: string) {
  const discovery = await discoverHookPort();
  if (!discovery) throw new Error('Hook not connected');
  const resp = await fetch(`http://127.0.0.1:${discovery.port}/plans/${planName}`, {
    headers: { 'X-Popcorn-Token': discovery.token },
  });
  if (!resp.ok) throw new Error('Failed to fetch plan');
  const data = await resp.json();
  return data.plan;
}

// -- Signal extension installation --
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Popcorn] Extension installed');
});
