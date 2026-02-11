/**
 * Background service worker for the Popcorn Chrome extension.
 * Acts as the integration hub: listens for messages from the hook
 * (via internal and external messaging), orchestrates demos through
 * the full recording pipeline, and persists results as tape records.
 */

import type { PopcornMessage, StartDemoMessage } from '@popcorn/shared';
import { isPopcornMessage, createMessage } from '@popcorn/shared';
import { initExternalMessaging } from './external-messaging.js';
import { runFullDemo } from './demo-flow.js';
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

function broadcastStatus(status: DemoState, error?: string | null): void {
  currentStatus = status;
  currentError = error ?? null;
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

// -- Initialize external messaging for hook communication --
initExternalMessaging();

console.log('[Popcorn] Background script loaded');

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

  broadcastStatus('running');

  // Ensure TapeStore is ready
  await ensureTapeStore();

  // Get the active tab
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]?.id) {
    broadcastStatus('error', 'No active tab found');
    throw new Error('No active tab found');
  }

  const tabId = tabs[0].id;

  // Navigate to base URL if specified
  if (message.payload.testPlan.baseUrl) {
    await chrome.tabs.update(tabId, { url: message.payload.testPlan.baseUrl });
    // Wait for page to load
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  try {
    broadcastStatus('capturing');

    // Run the full demo pipeline
    const demoResult = await runFullDemo(message, tabId, { tapeStore, onTapeSaved: notifyTapeSaved });

    broadcastStatus('complete');

    // Return to idle after a brief moment
    setTimeout(() => broadcastStatus('idle'), 1000);

    // Wrap as a message for the response
    const resultMessage = createMessage('demo_result', demoResult);
    return resultMessage;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    broadcastStatus('error', errorMsg);
    throw error;
  }
}

// -- Signal extension installation --
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Popcorn] Extension installed');
});
