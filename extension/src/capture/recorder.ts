import type { VideoMetadata } from '@popcorn/shared';

export type RecorderState = 'idle' | 'recording' | 'stopped' | 'error';

/**
 * Preferred MIME types in order of priority.
 * vp9 offers better compression; vp8 is the widely-supported fallback.
 */
const PREFERRED_MIME_TYPES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

/**
 * Select the best supported MIME type for MediaRecorder.
 * Returns the first type that passes `MediaRecorder.isTypeSupported`,
 * or falls back to the empty string (browser default).
 */
function selectMimeType(): string {
  for (const mime of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return '';
}

/**
 * Captures video from a browser tab using `chrome.tabCapture` and
 * `MediaRecorder`.  The recording is collected in chunks (1 s timeslice)
 * so partial data is preserved even if the session ends unexpectedly.
 */
export class Recorder {
  private state: RecorderState = 'idle';
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private startTime = 0;
  private resolution = { width: 0, height: 0 };
  private mimeType = '';

  /** Current recorder state. */
  getState(): RecorderState {
    return this.state;
  }

  /**
   * Begin recording the visible content of the tab identified by `tabId`.
   *
   * Internally this calls `chrome.tabCapture.capture()` to obtain a
   * `MediaStream`, then pipes it into a `MediaRecorder` with a 1-second
   * timeslice so chunks accumulate progressively.
   *
   * @throws If the recorder is not idle, or if capture/setup fails.
   */
  async start(tabId: number): Promise<void> {
    if (this.state !== 'idle') {
      throw new Error(`Cannot start recording: recorder is in "${this.state}" state`);
    }

    try {
      // Obtain a MediaStream from the active tab
      this.stream = await this.captureTab(tabId);

      // Determine resolution from the first video track
      const videoTrack = this.stream.getVideoTracks()[0];
      if (videoTrack) {
        const settings = videoTrack.getSettings();
        this.resolution = {
          width: settings.width ?? 0,
          height: settings.height ?? 0,
        };
      }

      // Choose the best codec available
      this.mimeType = selectMimeType();

      const options: MediaRecorderOptions = {};
      if (this.mimeType) {
        options.mimeType = this.mimeType;
      }

      // Create the MediaRecorder
      this.mediaRecorder = new MediaRecorder(this.stream, options);
      this.chunks = [];

      this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          this.chunks.push(event.data);
        }
      };

      this.mediaRecorder.onerror = () => {
        this.state = 'error';
      };

      // Start recording with 1-second timeslice for progressive chunking
      this.mediaRecorder.start(1000);
      this.startTime = Date.now();
      this.state = 'recording';
    } catch (error) {
      this.state = 'error';
      this.cleanupStream();
      const message =
        error instanceof Error ? error.message : 'Unknown capture error';
      throw new Error(`Failed to start recording: ${message}`);
    }
  }

  /**
   * Stop recording and return the assembled video blob together with
   * descriptive metadata.
   *
   * @throws If the recorder is not currently recording.
   */
  async stop(): Promise<{ blob: Blob; metadata: VideoMetadata }> {
    if (this.state !== 'recording' || !this.mediaRecorder) {
      throw new Error(`Cannot stop recording: recorder is in "${this.state}" state`);
    }

    return new Promise<{ blob: Blob; metadata: VideoMetadata }>(
      (resolve, reject) => {
        const recorder = this.mediaRecorder!;

        recorder.onstop = () => {
          try {
            this.cleanupStream();

            const mimeType =
              this.mimeType || recorder.mimeType || 'video/webm';
            const blob = new Blob(this.chunks, { type: mimeType });
            const duration = (Date.now() - this.startTime) / 1000;

            const metadata: VideoMetadata = {
              filename: '', // Caller assigns the final filename
              duration,
              fileSize: blob.size,
              resolution: { ...this.resolution },
              mimeType,
              timestamp: Date.now(),
            };

            this.state = 'stopped';
            resolve({ blob, metadata });
          } catch (err) {
            this.state = 'error';
            reject(err);
          }
        };

        recorder.stop();
      },
    );
  }

  /**
   * Reset the recorder to idle, releasing all held resources.
   * Safe to call from any state.
   */
  reset(): void {
    if (this.mediaRecorder) {
      try {
        if (this.mediaRecorder.state !== 'inactive') {
          this.mediaRecorder.stop();
        }
      } catch {
        // Ignore -- we are tearing down
      }
      this.mediaRecorder = null;
    }

    this.cleanupStream();
    this.chunks = [];
    this.startTime = 0;
    this.resolution = { width: 0, height: 0 };
    this.mimeType = '';
    this.state = 'idle';
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  /**
   * Wrap `chrome.tabCapture.capture` in a promise.
   */
  private captureTab(_tabId: number): Promise<MediaStream> {
    return new Promise<MediaStream>((resolve, reject) => {
      const captureOptions: chrome.tabCapture.CaptureOptions = {
        audio: true,
        video: true,
        videoConstraints: {
          mandatory: {
            minWidth: 1280,
            minHeight: 720,
            maxWidth: 1920,
            maxHeight: 1080,
            maxFrameRate: 30,
          },
        },
      };

      chrome.tabCapture.capture(
        captureOptions,
        (stream: MediaStream | null) => {
          if (chrome.runtime.lastError) {
            reject(
              new Error(chrome.runtime.lastError.message ?? 'Tab capture failed'),
            );
            return;
          }
          if (!stream) {
            reject(new Error('Tab capture returned null stream'));
            return;
          }
          resolve(stream);
        },
      );
    });
  }

  /** Stop all tracks on the current stream and release the reference. */
  private cleanupStream(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
  }
}
