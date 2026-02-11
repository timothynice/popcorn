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
  },
  tabs: {
    sendMessage: vi.fn(),
    query: vi.fn(),
    update: vi.fn(),
  },
};

vi.stubGlobal('chrome', chromeMock);
