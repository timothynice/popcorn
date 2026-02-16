/**
 * Bridge client for connecting the Chrome extension background to
 * Popcorn hook HTTP servers. Supports multiple simultaneous hooks
 * (one per project) by probing all ports in the range and polling
 * each active hook for messages.
 */

const POPCORN_PORT_RANGE = [7890, 7891, 7892, 7893, 7894, 7895, 7896, 7897, 7898, 7899];
const POLL_ALARM_NAME = 'popcorn-poll';
const CACHE_KEY = 'popcorn_bridge_hooks';
const CACHE_TTL_MS = 60_000;

type MessageHandler = (msg: unknown) => Promise<unknown>;

export interface HookEntry {
  port: number;
  token: string;
  baseUrl: string | null;
  discoveredAt: number;
}

let hookConnected = false;
let messageHandler: MessageHandler | null = null;
let activeHooks: Map<number, HookEntry> = new Map();

/** Starts polling all hook HTTP servers for messages. */
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
  activeHooks.clear();
}

/** Returns whether at least one hook is currently reachable. */
export function isHookConnected(): boolean {
  return hookConnected;
}

/** Returns all currently active hook entries. */
export function getActiveHooks(): HookEntry[] {
  return Array.from(activeHooks.values());
}

/**
 * Discovers the hook's HTTP server by probing ports 7890-7899.
 * Returns the first (or any) active hook for backward compatibility.
 * Prefer getActiveHooks() for multi-hook scenarios.
 */
export async function discoverHookPort(): Promise<{ port: number; token: string; discoveredAt: number } | null> {
  // If we already have active hooks, return the first one
  if (activeHooks.size > 0) {
    const first = activeHooks.values().next().value;
    if (first) return { port: first.port, token: first.token, discoveredAt: first.discoveredAt };
  }

  // Fall back to full discovery
  const hooks = await discoverAllHooks();
  if (hooks.length === 0) return null;
  return { port: hooks[0].port, token: hooks[0].token, discoveredAt: hooks[0].discoveredAt };
}

/**
 * Discovers ALL active hook servers on ports 7890-7899.
 * Probes all ports in parallel and returns entries for every responding server.
 */
export async function discoverAllHooks(): Promise<HookEntry[]> {
  // Check cache first
  let cachedHooks: HookEntry[] = [];
  try {
    const cached = await chrome.storage.local.get(CACHE_KEY);
    const entries = cached[CACHE_KEY] as HookEntry[] | undefined;
    if (entries && Array.isArray(entries)) {
      cachedHooks = entries.filter((e) => Date.now() - e.discoveredAt < CACHE_TTL_MS);
    }
  } catch {
    // Storage read failed
  }

  // Verify cached hooks are still alive + probe all ports for new ones
  const probeResults = await Promise.allSettled(
    POPCORN_PORT_RANGE.map(async (port) => {
      try {
        const resp = await fetch(`http://127.0.0.1:${port}/health`, {
          signal: AbortSignal.timeout(1000),
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data.ok && data.token) {
            return {
              port: data.port ?? port,
              token: data.token,
              baseUrl: data.baseUrl ?? null,
              discoveredAt: Date.now(),
            } as HookEntry;
          }
        }
      } catch {
        // Port not available
      }
      return null;
    }),
  );

  const discovered: HookEntry[] = [];
  for (const result of probeResults) {
    if (result.status === 'fulfilled' && result.value) {
      discovered.push(result.value);
    }
  }

  // Update the active hooks map
  activeHooks.clear();
  for (const hook of discovered) {
    activeHooks.set(hook.port, hook);
  }

  // Cache the discovered hooks
  if (discovered.length > 0) {
    try {
      await chrome.storage.local.set({ [CACHE_KEY]: discovered });
    } catch {
      // Storage write failed
    }
  }

  return discovered;
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

/** Sends POST /shutdown to a specific hook to stop it remotely. */
export async function stopHook(port: number, token: string): Promise<boolean> {
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/shutdown`, {
      method: 'POST',
      headers: { 'X-Popcorn-Token': token },
      signal: AbortSignal.timeout(3000),
    });
    if (resp.ok) {
      activeHooks.delete(port);
      hookConnected = activeHooks.size > 0;
      return true;
    }
  } catch {
    // Hook may already be gone
  }
  return false;
}

/** Internal: single poll cycle — discovers all hooks and polls each one. */
async function pollOnce(): Promise<void> {
  if (!messageHandler) return;

  const hooks = await discoverAllHooks();

  if (hooks.length === 0) {
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

  // Poll all active hooks
  let anySuccess = false;
  for (const hook of hooks) {
    try {
      await pollForMessages(messageHandler, hook.port, hook.token);
      anySuccess = true;
    } catch {
      // This specific hook failed; others may still succeed
      activeHooks.delete(hook.port);
    }
  }

  hookConnected = anySuccess;

  if (anySuccess && !wasConnected) {
    chrome.runtime.sendMessage({
      type: 'hook_status',
      payload: { connected: true, hookCount: activeHooks.size },
    }).catch(() => {});
  } else if (!anySuccess && wasConnected) {
    chrome.runtime.sendMessage({
      type: 'hook_status',
      payload: { connected: false },
    }).catch(() => {});
  }
}
