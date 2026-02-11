/**
 * Capture a screenshot of the currently visible tab.
 *
 * Uses `chrome.tabs.captureVisibleTab()` which returns a base64-encoded
 * PNG data URL. The optional `tabId` parameter is accepted for symmetry
 * with other capture utilities but is not used directly -- the Chrome
 * API always captures the visible tab of the current window.
 *
 * @param _tabId - Accepted for API consistency; not used by the underlying Chrome API.
 * @returns A `data:image/png;base64,...` string.
 */
export async function captureScreenshot(_tabId?: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    try {
      chrome.tabs.captureVisibleTab(
        { format: 'png' },
        (dataUrl: string) => {
          if (chrome.runtime.lastError) {
            reject(
              new Error(
                chrome.runtime.lastError.message ?? 'Screenshot capture failed',
              ),
            );
            return;
          }
          if (!dataUrl) {
            reject(new Error('Screenshot capture returned empty result'));
            return;
          }
          resolve(dataUrl);
        },
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown screenshot error';
      reject(new Error(`Failed to capture screenshot: ${message}`));
    }
  });
}
