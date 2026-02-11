import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Recorder } from '../capture/recorder.js';

// ---------------------------------------------------------------------------
// Mock chrome APIs for offscreen-based recording
// ---------------------------------------------------------------------------

// Mock the offscreen manager module
vi.mock('../background/offscreen-manager.js', () => ({
  ensureOffscreenDocument: vi.fn(() => Promise.resolve()),
  closeOffscreenDocument: vi.fn(() => Promise.resolve()),
}));

import {
  ensureOffscreenDocument,
  closeOffscreenDocument,
} from '../background/offscreen-manager.js';

// Default mock: sendMessage returns success for offscreen messages
const mockSendMessage = vi.fn();
const mockGetMediaStreamId = vi.fn();

const chromeMock = {
  tabCapture: {
    getMediaStreamId: mockGetMediaStreamId,
  },
  runtime: {
    lastError: null as chrome.runtime.LastError | null,
    sendMessage: mockSendMessage,
    getURL: vi.fn((path: string) => `chrome-extension://mock-id/${path}`),
    getContexts: vi.fn(() => Promise.resolve([])),
  },
  offscreen: {
    createDocument: vi.fn(() => Promise.resolve()),
    closeDocument: vi.fn(() => Promise.resolve()),
    Reason: { USER_MEDIA: 'USER_MEDIA' },
  },
};

vi.stubGlobal('chrome', chromeMock);

// ---------------------------------------------------------------------------
// Mock IndexedDB for blob transfer between offscreen and background
// ---------------------------------------------------------------------------

/** In-memory store simulating the shared popcorn-transfer IndexedDB. */
const transferStore = new Map<string, Blob>();

function createMockIDBObjectStore() {
  return {
    put(value: any, key: string) {
      transferStore.set(key, value);
      const req = { result: undefined as any, onsuccess: null as any, onerror: null as any };
      Promise.resolve().then(() => req.onsuccess?.());
      return req;
    },
    get(key: string) {
      const result = transferStore.get(key);
      const req = { result, onsuccess: null as any, onerror: null as any };
      Promise.resolve().then(() => req.onsuccess?.());
      return req;
    },
    delete(key: string) {
      transferStore.delete(key);
      const req = { result: undefined as any, onsuccess: null as any, onerror: null as any };
      Promise.resolve().then(() => req.onsuccess?.());
      return req;
    },
  };
}

function createMockIDBTransaction() {
  const store = createMockIDBObjectStore();
  const tx = {
    objectStore: vi.fn(() => store),
    oncomplete: null as any,
  };
  Promise.resolve().then(() => tx.oncomplete?.());
  return tx;
}

function createMockIDBDatabase() {
  return {
    objectStoreNames: { contains: vi.fn(() => true) },
    createObjectStore: vi.fn(),
    transaction: vi.fn(() => createMockIDBTransaction()),
    close: vi.fn(),
  };
}

const mockIndexedDB = {
  open(_name: string, _version?: number) {
    const db = createMockIDBDatabase();
    const req = {
      result: db,
      onsuccess: null as any,
      onerror: null as any,
      onupgradeneeded: null as any,
    };
    Promise.resolve().then(() => req.onsuccess?.());
    return req;
  },
};

vi.stubGlobal('indexedDB', mockIndexedDB);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Recorder', () => {
  let recorder: Recorder;

  beforeEach(() => {
    vi.clearAllMocks();
    transferStore.clear();
    chromeMock.runtime.lastError = null;
    recorder = new Recorder();

    // Default: getMediaStreamId returns a stream ID successfully
    mockGetMediaStreamId.mockImplementation(
      (_options: unknown, callback: (streamId: string) => void) => {
        callback('mock-stream-id-123');
      },
    );

    // Default: sendMessage handles offscreen messages
    // On stop, offscreen writes blob to transfer IDB and returns blobKey
    mockSendMessage.mockImplementation((message: any) => {
      if (message.type === 'offscreen-start-recording') {
        return Promise.resolve({ success: true });
      }
      if (message.type === 'offscreen-stop-recording') {
        // Simulate offscreen writing blob to shared IndexedDB
        const blobKey = `recording-${Date.now()}`;
        transferStore.set(blobKey, new Blob(['video-data'], { type: 'video/webm;codecs=vp9' }));
        return Promise.resolve({
          success: true,
          blobKey,
          mimeType: 'video/webm;codecs=vp9',
          duration: 2.5,
          fileSize: 1024,
          resolution: { width: 1920, height: 1080 },
          timestamp: Date.now(),
        });
      }
      return Promise.resolve({ status: 'idle' });
    });
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

  it('transitions to error when getMediaStreamId fails', async () => {
    chromeMock.runtime.lastError = { message: 'Permission denied' };

    await expect(recorder.start(1)).rejects.toThrow(
      'Failed to start recording: Permission denied',
    );
    expect(recorder.getState()).toBe('error');
  });

  it('transitions to error when getMediaStreamId returns empty', async () => {
    mockGetMediaStreamId.mockImplementationOnce(
      (_opts: unknown, cb: (streamId: string) => void) => {
        cb('');
      },
    );

    await expect(recorder.start(1)).rejects.toThrow(
      'Failed to start recording: getMediaStreamId returned empty stream ID',
    );
    expect(recorder.getState()).toBe('error');
  });

  it('transitions to error when offscreen start fails', async () => {
    mockSendMessage.mockImplementationOnce(() =>
      Promise.resolve({ success: false, error: 'getUserMedia failed' }),
    );

    await expect(recorder.start(1)).rejects.toThrow(
      'Failed to start recording: getUserMedia failed',
    );
    expect(recorder.getState()).toBe('error');
  });

  it('transitions to error when offscreen stop fails', async () => {
    await recorder.start(1);

    mockSendMessage.mockImplementationOnce(() =>
      Promise.resolve({ success: false, error: 'MediaRecorder error' }),
    );

    await expect(recorder.stop()).rejects.toThrow('MediaRecorder error');
    expect(recorder.getState()).toBe('error');
  });

  // -- Offscreen document lifecycle ----------------------------------------

  it('creates offscreen document on start()', async () => {
    await recorder.start(1);
    expect(ensureOffscreenDocument).toHaveBeenCalledOnce();
  });

  it('closes offscreen document on stop()', async () => {
    await recorder.start(1);
    await recorder.stop();
    expect(closeOffscreenDocument).toHaveBeenCalled();
  });

  it('closes offscreen document on reset()', async () => {
    await recorder.start(1);
    recorder.reset();
    // closeOffscreenDocument is called asynchronously (fire-and-forget)
    expect(closeOffscreenDocument).toHaveBeenCalled();
  });

  it('closes offscreen document on start() error', async () => {
    mockSendMessage.mockImplementationOnce(() =>
      Promise.resolve({ success: false, error: 'start failed' }),
    );

    await expect(recorder.start(1)).rejects.toThrow();
    expect(closeOffscreenDocument).toHaveBeenCalled();
  });

  // -- Messaging -----------------------------------------------------------

  it('sends correct streamId to offscreen on start()', async () => {
    await recorder.start(42);

    expect(mockGetMediaStreamId).toHaveBeenCalledWith(
      { targetTabId: 42 },
      expect.any(Function),
    );

    expect(mockSendMessage).toHaveBeenCalledWith({
      type: 'offscreen-start-recording',
      streamId: 'mock-stream-id-123',
    });
  });

  it('sends stop message to offscreen on stop()', async () => {
    await recorder.start(1);
    await recorder.stop();

    expect(mockSendMessage).toHaveBeenCalledWith({
      type: 'offscreen-stop-recording',
    });
  });

  // -- Blob transfer via IndexedDB -----------------------------------------

  it('reads blob from IndexedDB after stop()', async () => {
    await recorder.start(1);
    const { blob } = await recorder.stop();

    // The blob should come from our mock transfer store
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);

    // Transfer store should be cleaned up (blob deleted after reading)
    expect(transferStore.size).toBe(0);
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
