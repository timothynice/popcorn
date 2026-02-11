/**
 * Handles external messages from the Popcorn hook process.
 * The extension listens for connections from externally_connectable sources
 * and routes valid PopcornMessages to the demo orchestrator.
 */

import type { PopcornMessage, StartDemoMessage, DemoResult } from '@popcorn/shared';
import { isPopcornMessage, createMessage, validateMessage } from '@popcorn/shared';
import { handleStartDemo } from './demo-orchestrator.js';

type ExternalMessageHandler = (
  result: DemoResult | null,
  error: string | null,
) => void;

const pendingCallbacks: Map<string, ExternalMessageHandler> = new Map();

/**
 * Initialize external messaging listeners.
 * This should be called once from the background script.
 */
export function initExternalMessaging(): void {
  // Listen for external connections (from hook or other extensions)
  chrome.runtime.onMessageExternal.addListener(
    (message, sender, sendResponse) => {
      handleExternalMessage(message, sender)
        .then((response) => sendResponse(response))
        .catch((error) => {
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      return true; // Keep channel open for async
    },
  );

  // Listen for long-lived connections
  chrome.runtime.onConnectExternal.addListener((port) => {
    console.log('[Popcorn] External connection from:', port.sender?.id);

    port.onMessage.addListener(async (message) => {
      try {
        const response = await handleExternalMessage(message, port.sender!);
        port.postMessage(response);
      } catch (error) {
        port.postMessage({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    port.onDisconnect.addListener(() => {
      console.log('[Popcorn] External connection closed');
    });

    // Send ready signal
    port.postMessage(
      createMessage('extension_ready', { extensionVersion: '0.1.0' }),
    );
  });
}

async function handleExternalMessage(
  rawMessage: unknown,
  sender: chrome.runtime.MessageSender,
): Promise<Record<string, unknown>> {
  const validation = validateMessage(rawMessage);

  if (!validation.valid || !validation.message) {
    return { success: false, error: validation.error ?? 'Invalid message' };
  }

  const message = validation.message;

  switch (message.type) {
    case 'start_demo': {
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      const tabId = tabs[0]?.id;
      if (!tabId) {
        return { success: false, error: 'No active tab found' };
      }

      const result = await handleStartDemo(
        message as StartDemoMessage,
        tabId,
      );
      return { success: true, result };
    }

    case 'hook_ready':
      console.log('[Popcorn] Hook connected:', message.payload);
      return {
        success: true,
        message: createMessage('extension_ready', {
          extensionVersion: '0.1.0',
        }),
      };

    default:
      return { success: false, error: `Unknown message type: ${message.type}` };
  }
}

/**
 * Register a callback for when a demo completes.
 * Used by the popup to get notified of results.
 */
export function onDemoComplete(
  testPlanId: string,
  callback: ExternalMessageHandler,
): void {
  pendingCallbacks.set(testPlanId, callback);
}
