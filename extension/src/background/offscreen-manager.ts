/**
 * Manages the lifecycle of the offscreen document used for video recording.
 *
 * Chrome enforces that only one offscreen document can exist at a time per
 * extension. This module provides helpers to create and close the document,
 * with guards to prevent duplicate creation.
 */

const OFFSCREEN_URL = 'offscreen.html';

/**
 * Returns true if an offscreen document already exists.
 */
async function hasOffscreenDocument(): Promise<boolean> {
  // chrome.offscreen.hasDocument was added in Chrome 116
  if ('getContexts' in chrome.runtime) {
    const contexts = await (chrome.runtime as any).getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
    });
    return contexts.length > 0;
  }

  // Fallback: try creating and see if it fails (shouldn't be needed for Chrome 123+)
  return false;
}

/**
 * Create the offscreen document if it doesn't already exist.
 * The document is used as a DOM context for MediaRecorder.
 */
export async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: 'Recording tab video via MediaRecorder requires a DOM context',
  });
}

/**
 * Close the offscreen document if it exists.
 * Safe to call even if no document is open.
 */
export async function closeOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) {
    await chrome.offscreen.closeDocument();
  }
}
