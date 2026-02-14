/**
 * Offscreen document recorder script.
 *
 * This runs inside the offscreen document (a hidden HTML page) which has
 * full DOM access — unlike the MV3 service worker. It receives a
 * `streamId` from the background, obtains a MediaStream via
 * `navigator.mediaDevices.getUserMedia`, and uses MediaRecorder to
 * capture video chunks. When told to stop, it assembles the chunks into
 * a Blob and stores it in a shared IndexedDB (avoiding binary data
 * transfer through Chrome messaging which can corrupt ArrayBuffers).
 */

/**
 * Preferred MIME types in order of priority.
 * vp9 offers better compression; vp8 is the widely-supported fallback.
 */
const PREFERRED_MIME_TYPES = [
  'video/mp4;codecs=avc1.424028,mp4a.40.2',
  'video/mp4;codecs=avc1.424028',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

function selectMimeType(): string {
  for (const mime of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return '';
}

// ---------------------------------------------------------------------------
// Shared IndexedDB for blob transfer (avoids Chrome messaging size limits)
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

async function writeBlobToTransferDB(key: string, blob: Blob): Promise<void> {
  const db = await openTransferDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TRANSFER_STORE_NAME, 'readwrite');
    const store = tx.objectStore(TRANSFER_STORE_NAME);
    const request = store.put(blob, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

// -- State --
let mediaRecorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let stream: MediaStream | null = null;
let startTime = 0;
let resolution = { width: 0, height: 0 };
let selectedMimeType = '';

/**
 * Clean up the media stream by stopping all tracks.
 */
function cleanupStream(): void {
  if (stream) {
    for (const track of stream.getTracks()) {
      track.stop();
    }
    stream = null;
  }
}

/**
 * Start recording using the provided stream ID from chrome.tabCapture.getMediaStreamId().
 */
async function startRecording(streamId: string): Promise<void> {
  try {
    // Obtain MediaStream using the stream ID provided by background
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      } as MediaTrackConstraints,
      video: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
          minWidth: 1280,
          minHeight: 720,
          maxWidth: 1920,
          maxHeight: 1080,
          maxFrameRate: 30,
        },
      } as MediaTrackConstraints,
    });

    // Determine resolution from the video track
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      const settings = videoTrack.getSettings();
      resolution = {
        width: settings.width ?? 0,
        height: settings.height ?? 0,
      };
      console.log('[Popcorn Offscreen] Video track settings:', JSON.stringify(settings));
    }

    // Choose the best codec
    selectedMimeType = selectMimeType();
    console.log('[Popcorn Offscreen] Selected MIME type:', selectedMimeType || '(browser default)');

    const options: MediaRecorderOptions = {};
    if (selectedMimeType) {
      options.mimeType = selectedMimeType;
    }

    // Create MediaRecorder
    mediaRecorder = new MediaRecorder(stream, options);
    chunks = [];

    mediaRecorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
        console.log(`[Popcorn Offscreen] Chunk received: ${event.data.size} bytes`);
      }
    };

    mediaRecorder.onerror = () => {
      console.error('[Popcorn Offscreen] MediaRecorder error');
      chrome.runtime.sendMessage({
        type: 'offscreen-recording-error',
        error: 'MediaRecorder error',
      });
    };

    // Start recording WITHOUT a timeslice — data is collected on requestData() / stop()
    // This avoids the edge case where a <1s recording with 1s timeslice yields zero chunks.
    mediaRecorder.start();
    startTime = Date.now();

    console.log('[Popcorn Offscreen] Recording started');
  } catch (error) {
    cleanupStream();
    const message = error instanceof Error ? error.message : 'Unknown capture error';
    throw new Error(`Failed to start offscreen recording: ${message}`);
  }
}

/**
 * Stop recording, write the blob to a shared IndexedDB, and return
 * a reference key + metadata to the background script.
 */
async function stopRecording(): Promise<{
  blobKey: string;
  mimeType: string;
  duration: number;
  fileSize: number;
  resolution: { width: number; height: number };
  timestamp: number;
}> {
  return new Promise((resolve, reject) => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      reject(new Error('No active recording to stop'));
      return;
    }

    mediaRecorder.onstop = async () => {
      try {
        cleanupStream();

        const mimeType = selectedMimeType || mediaRecorder?.mimeType || 'video/webm';
        const blob = new Blob(chunks, { type: mimeType });
        const duration = (Date.now() - startTime) / 1000;

        console.log(
          `[Popcorn Offscreen] Recording stopped: ${chunks.length} chunks, ` +
          `${blob.size} bytes, ${duration.toFixed(1)}s, ${mimeType}`,
        );

        // Write blob to shared IndexedDB instead of sending via messaging
        const blobKey = `recording-${Date.now()}`;
        await writeBlobToTransferDB(blobKey, blob);
        console.log(`[Popcorn Offscreen] Blob written to IndexedDB with key: ${blobKey}`);

        resolve({
          blobKey,
          mimeType,
          duration,
          fileSize: blob.size,
          resolution: { ...resolution },
          timestamp: Date.now(),
        });
      } catch (err) {
        reject(err);
      }
    };

    // Force-flush any buffered data before stopping.
    // Without this, short recordings might have zero chunks because
    // MediaRecorder buffers data until the next timeslice or stop().
    mediaRecorder.requestData();
    mediaRecorder.stop();
  });
}

// -- Message listener --
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;

  switch (message.type) {
    case 'offscreen-start-recording': {
      const { streamId } = message;
      startRecording(streamId)
        .then(() => {
          sendResponse({ success: true });
        })
        .catch((error) => {
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      return true; // Keep channel open for async response
    }

    case 'offscreen-stop-recording': {
      stopRecording()
        .then((result) => {
          sendResponse({ success: true, ...result });
        })
        .catch((error) => {
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      return true; // Keep channel open for async response
    }

    default:
      return false;
  }
});

console.log('[Popcorn Offscreen] Offscreen recorder loaded');
