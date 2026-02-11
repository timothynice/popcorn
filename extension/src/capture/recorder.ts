import type { VideoMetadata } from '@popcorn/shared';
import {
  ensureOffscreenDocument,
  closeOffscreenDocument,
} from '../background/offscreen-manager.js';

export type RecorderState = 'idle' | 'recording' | 'stopped' | 'error';

// ---------------------------------------------------------------------------
// Shared IndexedDB for blob transfer (matches offscreen-recorder.ts)
// ---------------------------------------------------------------------------

const TRANSFER_DB_NAME = 'popcorn-transfer';
const TRANSFER_STORE_NAME = 'blobs';

function openTransferDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(TRANSFER_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TRANSFER_STORE_NAME)) {
        db.createObjectStore(TRANSFER_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readBlobFromTransferDB(key: string): Promise<Blob> {
  const db = await openTransferDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TRANSFER_STORE_NAME, 'readwrite');
    const store = tx.objectStore(TRANSFER_STORE_NAME);
    const getReq = store.get(key);
    getReq.onsuccess = () => {
      const blob = getReq.result;
      // Clean up the temporary record after reading
      store.delete(key);
      if (blob instanceof Blob) {
        resolve(blob);
      } else {
        reject(new Error('Transfer DB did not contain a Blob'));
      }
    };
    getReq.onerror = () => reject(getReq.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * Orchestrates video recording via the Chrome Offscreen API.
 *
 * MV3 service workers have no DOM, so we cannot use MediaRecorder directly.
 * Instead this class:
 * 1. Obtains a stream ID via `chrome.tabCapture.getMediaStreamId()`
 * 2. Creates an offscreen document (hidden HTML page with DOM access)
 * 3. Sends the stream ID to the offscreen document via messaging
 * 4. The offscreen document runs MediaRecorder and stores the blob in
 *    a shared IndexedDB. Only a small reference key is sent back via messaging.
 * 5. Background reads the blob from IndexedDB and returns it.
 *
 * The public API (start/stop/reset/getState) is unchanged so that
 * `demo-flow.ts` requires zero modifications.
 */
export class Recorder {
  private state: RecorderState = 'idle';
  private startTime = 0;

  /** Current recorder state. */
  getState(): RecorderState {
    return this.state;
  }

  /**
   * Begin recording the visible content of the tab identified by `tabId`.
   *
   * Obtains a media stream ID via `chrome.tabCapture.getMediaStreamId()`,
   * creates an offscreen document, and tells it to start recording.
   *
   * @throws If the recorder is not idle, or if capture/setup fails.
   */
  async start(tabId: number): Promise<void> {
    if (this.state !== 'idle') {
      throw new Error(`Cannot start recording: recorder is in "${this.state}" state`);
    }

    try {
      // 1. Get a media stream ID for the target tab
      const streamId = await this.getMediaStreamId(tabId);

      // 2. Ensure the offscreen document is ready
      await ensureOffscreenDocument();

      // 3. Tell the offscreen document to start recording with this stream ID
      const response = await chrome.runtime.sendMessage({
        type: 'offscreen-start-recording',
        streamId,
      });

      if (!response?.success) {
        throw new Error(response?.error ?? 'Offscreen recording failed to start');
      }

      this.startTime = Date.now();
      this.state = 'recording';
    } catch (error) {
      this.state = 'error';
      // Try to clean up the offscreen document
      try {
        await closeOffscreenDocument();
      } catch {
        // Ignore cleanup errors
      }
      const message =
        error instanceof Error ? error.message : 'Unknown capture error';
      throw new Error(`Failed to start recording: ${message}`);
    }
  }

  /**
   * Stop recording and return the assembled video blob together with
   * descriptive metadata.
   *
   * The offscreen document writes the blob to a shared IndexedDB and
   * returns a reference key. We read the blob from IndexedDB here.
   *
   * @throws If the recorder is not currently recording.
   */
  async stop(): Promise<{ blob: Blob; metadata: VideoMetadata }> {
    if (this.state !== 'recording') {
      throw new Error(`Cannot stop recording: recorder is in "${this.state}" state`);
    }

    try {
      // Tell the offscreen document to stop recording
      const response = await chrome.runtime.sendMessage({
        type: 'offscreen-stop-recording',
      });

      if (!response?.success) {
        throw new Error(response?.error ?? 'Offscreen recording failed to stop');
      }

      // Read the blob from the shared IndexedDB using the key
      const blob = await readBlobFromTransferDB(response.blobKey);

      const metadata: VideoMetadata = {
        filename: '', // Caller assigns the final filename
        duration: response.duration,
        fileSize: response.fileSize,
        resolution: response.resolution,
        mimeType: response.mimeType,
        timestamp: response.timestamp,
      };

      this.state = 'stopped';

      // Close the offscreen document now that we have the data
      try {
        await closeOffscreenDocument();
      } catch {
        // Non-fatal
      }

      return { blob, metadata };
    } catch (error) {
      this.state = 'error';
      try {
        await closeOffscreenDocument();
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  /**
   * Reset the recorder to idle, releasing all held resources.
   * Safe to call from any state.
   */
  reset(): void {
    // Try to close the offscreen document (fire and forget)
    closeOffscreenDocument().catch(() => {
      // Ignore -- we are tearing down
    });

    this.startTime = 0;
    this.state = 'idle';
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  /**
   * Get a media stream ID for the given tab using the MV3-compatible API.
   * This replaces the deprecated `chrome.tabCapture.capture()`.
   */
  private getMediaStreamId(tabId: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId(
        { targetTabId: tabId },
        (streamId: string) => {
          if (chrome.runtime.lastError) {
            reject(
              new Error(
                chrome.runtime.lastError.message ?? 'Failed to get media stream ID',
              ),
            );
            return;
          }
          if (!streamId) {
            reject(new Error('getMediaStreamId returned empty stream ID'));
            return;
          }
          resolve(streamId);
        },
      );
    });
  }
}
