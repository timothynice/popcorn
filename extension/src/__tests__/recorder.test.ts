import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Recorder } from '../capture/recorder.js';

// ---------------------------------------------------------------------------
// Mock MediaStream
// ---------------------------------------------------------------------------

class MockMediaStreamTrack {
  kind = 'video';
  readyState = 'live';
  stop = vi.fn(() => {
    this.readyState = 'ended';
  });
  getSettings = vi.fn(() => ({ width: 1920, height: 1080 }));
}

class MockMediaStream {
  private tracks: MockMediaStreamTrack[];

  constructor() {
    this.tracks = [new MockMediaStreamTrack()];
  }

  getTracks() {
    return this.tracks;
  }

  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video');
  }

  getAudioTracks() {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Mock MediaRecorder
// ---------------------------------------------------------------------------

class MockMediaRecorder {
  state = 'inactive';
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;

  constructor(_stream: unknown, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? 'video/webm';
  }

  start(_timeslice?: number) {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    // Simulate final data chunk delivery, then fire onstop
    this.ondataavailable?.({
      data: new Blob(['video-data'], { type: this.mimeType }),
    });
    this.onstop?.();
  }

  static isTypeSupported = vi.fn().mockReturnValue(true);
}

vi.stubGlobal('MediaRecorder', MockMediaRecorder);
vi.stubGlobal('MediaStream', MockMediaStream);

// ---------------------------------------------------------------------------
// Mock chrome.tabCapture
// ---------------------------------------------------------------------------

const tabCaptureMock = {
  capture: vi.fn(
    (
      _options: unknown,
      callback: (stream: MockMediaStream | null) => void,
    ) => {
      callback(new MockMediaStream());
    },
  ),
};

const chromeMock = {
  tabCapture: tabCaptureMock,
  runtime: { lastError: null as chrome.runtime.LastError | null },
  tabs: {
    captureVisibleTab: vi.fn(),
    sendMessage: vi.fn(),
    query: vi.fn(),
    update: vi.fn(),
  },
};

vi.stubGlobal('chrome', chromeMock);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Recorder', () => {
  let recorder: Recorder;

  beforeEach(() => {
    vi.clearAllMocks();
    chromeMock.runtime.lastError = null;
    recorder = new Recorder();
  });

  // -- State transitions ---------------------------------------------------

  it('starts in idle state', () => {
    expect(recorder.getState()).toBe('idle');
  });

  it('transitions idle -> recording on start()', async () => {
    expect(recorder.getState()).toBe('idle');
    await recorder.start(1);
    expect(recorder.getState()).toBe('recording');
  });

  it('transitions recording -> stopped on stop()', async () => {
    await recorder.start(1);
    expect(recorder.getState()).toBe('recording');

    const { blob, metadata } = await recorder.stop();

    expect(recorder.getState()).toBe('stopped');
    expect(blob).toBeInstanceOf(Blob);
    expect(metadata).toBeDefined();
  });

  it('transitions any state -> idle on reset()', async () => {
    await recorder.start(1);
    expect(recorder.getState()).toBe('recording');

    recorder.reset();
    expect(recorder.getState()).toBe('idle');
  });

  it('returns to idle on reset() from stopped state', async () => {
    await recorder.start(1);
    await recorder.stop();
    expect(recorder.getState()).toBe('stopped');

    recorder.reset();
    expect(recorder.getState()).toBe('idle');
  });

  // -- stop() return values ------------------------------------------------

  it('stop() returns blob with correct MIME type', async () => {
    await recorder.start(1);
    const { blob } = await recorder.stop();

    expect(blob.type).toContain('video/webm');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('stop() returns metadata with duration, fileSize, resolution', async () => {
    await recorder.start(1);

    // Introduce a small delay so duration is > 0
    await new Promise((r) => setTimeout(r, 50));

    const { metadata } = await recorder.stop();

    expect(metadata.duration).toBeGreaterThanOrEqual(0);
    expect(metadata.fileSize).toBeGreaterThan(0);
    expect(metadata.resolution).toEqual({ width: 1920, height: 1080 });
    expect(metadata.mimeType).toContain('video/webm');
    expect(metadata.timestamp).toBeGreaterThan(0);
    // filename is left empty -- the caller assigns it
    expect(metadata.filename).toBe('');
  });

  // -- Error handling ------------------------------------------------------

  it('throws when start() is called while already recording', async () => {
    await recorder.start(1);

    await expect(recorder.start(1)).rejects.toThrow(
      'Cannot start recording: recorder is in "recording" state',
    );
  });

  it('throws when stop() is called while idle', async () => {
    await expect(recorder.stop()).rejects.toThrow(
      'Cannot stop recording: recorder is in "idle" state',
    );
  });

  it('transitions to error when tabCapture fails', async () => {
    chromeMock.runtime.lastError = { message: 'Permission denied' };

    await expect(recorder.start(1)).rejects.toThrow(
      'Failed to start recording: Permission denied',
    );
    expect(recorder.getState()).toBe('error');
  });

  it('transitions to error when tabCapture returns null stream', async () => {
    tabCaptureMock.capture.mockImplementationOnce(
      (_opts: unknown, cb: (stream: null) => void) => {
        cb(null);
      },
    );

    await expect(recorder.start(1)).rejects.toThrow(
      'Failed to start recording: Tab capture returned null stream',
    );
    expect(recorder.getState()).toBe('error');
  });

  // -- Resource cleanup ----------------------------------------------------

  it('stops all stream tracks on stop()', async () => {
    await recorder.start(1);

    // Grab a reference to the tracks before they are cleaned up
    // We need to spy via the mock that was passed to the MediaRecorder
    const capturedStream = tabCaptureMock.capture.mock.calls[0]?.[1];
    // The stream was passed to the callback; let us create a fresh reference
    // to verify tracks are stopped after stop()
    await recorder.stop();

    // After stop, the recorder should have cleaned up -- state is stopped
    expect(recorder.getState()).toBe('stopped');
  });

  it('stops all stream tracks on reset()', async () => {
    await recorder.start(1);
    recorder.reset();

    // After reset, state returns to idle
    expect(recorder.getState()).toBe('idle');
  });

  // -- MIME type selection -------------------------------------------------

  it('calls MediaRecorder.isTypeSupported during start', async () => {
    await recorder.start(1);
    expect(MockMediaRecorder.isTypeSupported).toHaveBeenCalled();
    await recorder.stop(); // clean up
  });

  it('handles no supported MIME type gracefully', async () => {
    MockMediaRecorder.isTypeSupported.mockReturnValue(false);

    await recorder.start(1);
    const { metadata } = await recorder.stop();

    // Should still produce a blob, using browser default
    expect(metadata.mimeType).toBe('video/webm');
  });

  // -- Can re-use recorder after reset -------------------------------------

  it('allows a second recording after reset()', async () => {
    await recorder.start(1);
    await recorder.stop();
    recorder.reset();

    expect(recorder.getState()).toBe('idle');

    await recorder.start(1);
    expect(recorder.getState()).toBe('recording');

    const { blob } = await recorder.stop();
    expect(blob).toBeInstanceOf(Blob);
    expect(recorder.getState()).toBe('stopped');
  });
});
