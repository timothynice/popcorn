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

  // Only navigate if baseUrl is specified AND differs from the current URL
  const targetUrl = message.payload.testPlan.baseUrl;
  if (targetUrl && targetUrl !== currentUrl) {
    console.log(`[Popcorn] Navigating to ${targetUrl}`);
    await chrome.tabs.update(tabId, { url: targetUrl });
    // Wait for page to load
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  try {
    // Run the full demo pipeline (use updateStatus to avoid sending messages
    // to the offscreen document which could interfere with recording)
    const demoResult = await runFullDemo(message, tabId, { tapeStore, onTapeSaved: notifyTapeSaved });

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

// -- Signal extension installation --
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Popcorn] Extension installed');
});
