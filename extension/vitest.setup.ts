import { vi } from 'vitest';

// Mock chrome API globally before any tests run
const chromeMock = {
  runtime: {
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    sendMessage: vi.fn(() => Promise.resolve({ status: 'idle' })),
    lastError: null,
    getURL: vi.fn((path: string) => `chrome-extension://mock-id/${path}`),
    getContexts: vi.fn(() => Promise.resolve([])),
  },
  tabs: {
    sendMessage: vi.fn(),
    query: vi.fn(),
    update: vi.fn(),
    captureVisibleTab: vi.fn(),
  },
  tabCapture: {
    capture: vi.fn(),
    getMediaStreamId: vi.fn(
      (_options: unknown, callback: (streamId: string) => void) => {
        callback('mock-stream-id');
      },
    ),
  },
  offscreen: {
    createDocument: vi.fn(() => Promise.resolve()),
    closeDocument: vi.fn(() => Promise.resolve()),
    Reason: {
      USER_MEDIA: 'USER_MEDIA',
    },
  },
};

vi.stubGlobal('chrome', chromeMock);
