/**
 * Bridge client for connecting the Chrome extension background to the
 * Popcorn hook's HTTP server. Discovers the hook via port probing,
 * polls for messages via chrome.alarms, and sends results back.
 */

const POPCORN_PORT_RANGE = [7890, 7891, 7892, 7893, 7894, 7895, 7896, 7897, 7898, 7899];
const POLL_ALARM_NAME = 'popcorn-poll';
const CACHE_KEY = 'popcorn_bridge_cache';
const CACHE_TTL_MS = 60_000;

type MessageHandler = (msg: unknown) => Promise<unknown>;

interface BridgeCache {
  port: number;
  token: string;
  discoveredAt: number;
}

let hookConnected = false;
let messageHandler: MessageHandler | null = null;

/** Starts polling the hook HTTP server for messages. */
export function initBridgePolling(onMessage: MessageHandler): void {
  messageHandler = onMessage;

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === POLL_ALARM_NAME) {
      pollOnce().catch((err) => {
        console.warn('[Popcorn Bridge] Poll error:', err);
      });
    }
  });

  // Create polling alarm — 0.05 min (~3s) works for unpacked extensions
  chrome.alarms.create(POLL_ALARM_NAME, { periodInMinutes: 0.05 });

  // Do an immediate first poll
  pollOnce().catch(() => {});
}

/** Stops bridge polling. */
export function stopBridgePolling(): void {
  chrome.alarms.clear(POLL_ALARM_NAME);
  messageHandler = null;
  hookConnected = false;
}

/** Returns whether the hook is currently reachable. */
export function isHookConnected(): boolean {
  return hookConnected;
}

/** Discovers the hook's HTTP server by probing ports 7890-7899. */
export async function discoverHookPort(): Promise<BridgeCache | null> {
  // Check cache first
  try {
    const cached = await chrome.storage.local.get(CACHE_KEY);
    const entry = cached[CACHE_KEY] as BridgeCache | undefined;
    if (entry && Date.now() - entry.discoveredAt < CACHE_TTL_MS) {
      // Verify cached port still works
      try {
        const resp = await fetch(`http://127.0.0.1:${entry.port}/health`, {
          signal: AbortSignal.timeout(1000),
        });
        if (resp.ok) return entry;
      } catch {
        // Cached port no longer works, re-probe
      }
    }
  } catch {
    // Storage read failed
  }

  // Probe all ports
  for (const port of POPCORN_PORT_RANGE) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.ok && data.token) {
          const entry: BridgeCache = {
            port: data.port ?? port,
            token: data.token,
            discoveredAt: Date.now(),
          };
          await chrome.storage.local.set({ [CACHE_KEY]: entry });
          return entry;
        }
      }
    } catch {
      // Port not available, continue
    }
  }

  return null;
}

/** Polls the hook for queued messages and processes them. */
export async function pollForMessages(handler: MessageHandler, port: number, token: string): Promise<void> {
  const resp = await fetch(`http://127.0.0.1:${port}/poll`, {
    headers: { 'X-Popcorn-Token': token },
    signal: AbortSignal.timeout(3000),
  });

  if (!resp.ok) return;

  const data = await resp.json();
  const messages = data.messages;
  if (!Array.isArray(messages) || messages.length === 0) return;

  for (const msg of messages) {
    const result = await handler(msg);
    if (result) {
      await sendResult(result, port, token);
    }
  }
}

/** Sends a result message back to the hook via POST /result. */
export async function sendResult(msg: unknown, port: number, token: string): Promise<void> {
  try {
    await fetch(`http://127.0.0.1:${port}/result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Popcorn-Token': token,
      },
      body: JSON.stringify({ message: msg }),
      signal: AbortSignal.timeout(3000),
    });
  } catch (err) {
    console.warn('[Popcorn Bridge] Failed to send result:', err);
  }
}

/** Internal: single poll cycle with connection state tracking. */
async function pollOnce(): Promise<void> {
  if (!messageHandler) return;

  const bridge = await discoverHookPort();
  if (!bridge) {
    if (hookConnected) {
      hookConnected = false;
      chrome.runtime.sendMessage({
        type: 'hook_status',
        payload: { connected: false },
      }).catch(() => {});
    }
    return;
  }

  const wasConnected = hookConnected;
  try {
    await pollForMessages(messageHandler, bridge.port, bridge.token);
    hookConnected = true;

    if (!wasConnected) {
      chrome.runtime.sendMessage({
        type: 'hook_status',
        payload: { connected: true, port: bridge.port },
      }).catch(() => {});
    }
  } catch {
    hookConnected = false;
    if (wasConnected) {
      chrome.runtime.sendMessage({
        type: 'hook_status',
        payload: { connected: false },
      }).catch(() => {});
    }
  }
}
