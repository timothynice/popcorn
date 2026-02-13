import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  discoverHookPort,
  pollForMessages,
  sendResult,
  initBridgePolling,
  isHookConnected,
  stopBridgePolling,
} from '../background/bridge-client.js';

describe('bridge-client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    vi.useFakeTimers();
    stopBridgePolling();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('discoverHookPort returns null when all ports fail', async () => {
    fetchMock.mockRejectedValue(new Error('Connection refused'));

    const result = await discoverHookPort();

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalled();
  });

  it('discoverHookPort returns port info on success', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, token: 'test-token', port: 7890 }),
    });

    const result = await discoverHookPort();

    expect(result).toEqual({
      port: 7890,
      token: 'test-token',
      discoveredAt: expect.any(Number),
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:7890/health',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('discoverHookPort uses cached value when fresh', async () => {
    const cachedEntry = {
      port: 7891,
      token: 'cached-token',
      discoveredAt: Date.now(),
    };

    chrome.storage.local.get = vi.fn(() =>
      Promise.resolve({ popcorn_bridge_cache: cachedEntry })
    );

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, token: 'cached-token', port: 7891 }),
    });

    const result = await discoverHookPort();

    expect(result).toEqual(cachedEntry);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:7891/health',
      expect.any(Object),
    );
  });

  it('pollForMessages calls handler for each message', async () => {
    const handler = vi.fn(async (msg) => ({ echo: msg }));
    const messages = [{ id: 1 }, { id: 2 }, { id: 3 }];

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ messages }),
    });

    await pollForMessages(handler, 7890, 'test-token');

    expect(handler).toHaveBeenCalledTimes(3);
    expect(handler).toHaveBeenCalledWith({ id: 1 });
    expect(handler).toHaveBeenCalledWith({ id: 2 });
    expect(handler).toHaveBeenCalledWith({ id: 3 });
  });

  it('pollForMessages sends result back when handler returns value', async () => {
    const handler = vi.fn(async () => ({ result: 'success' }));
    const messages = [{ id: 1 }];

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ messages }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      });

    await pollForMessages(handler, 7890, 'test-token');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:7890/result',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-Popcorn-Token': 'test-token',
        }),
      }),
    );
  });

  it('pollForMessages handles empty messages array', async () => {
    const handler = vi.fn();

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ messages: [] }),
    });

    await pollForMessages(handler, 7890, 'test-token');

    expect(handler).not.toHaveBeenCalled();
  });

  it('sendResult POSTs with correct headers', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });

    const message = { type: 'demo_result', payload: { success: true } };
    await sendResult(message, 7890, 'test-token');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:7890/result',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Popcorn-Token': 'test-token',
        },
        body: JSON.stringify({ message }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('initBridgePolling creates alarm and sets up listener', () => {
    const handler = vi.fn();

    initBridgePolling(handler);

    expect(chrome.alarms.create).toHaveBeenCalledWith('popcorn-poll', {
      periodInMinutes: 0.05,
    });
    expect(chrome.alarms.onAlarm.addListener).toHaveBeenCalled();
    expect(isHookConnected()).toBe(false);
  });
});
