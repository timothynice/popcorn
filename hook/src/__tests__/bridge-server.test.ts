import { describe, it, expect, afterEach } from 'vitest';
import type { PopcornMessage, DemoResultMessage } from '@popcorn/shared';
import { BridgeServer } from '../bridge-server.js';

/** Helper: make an HTTP request to the bridge server and parse the JSON response. */
async function request(
  port: number,
  path: string,
  options?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; data: Record<string, unknown> }> {
  const url = `http://127.0.0.1:${port}${path}`;
  const res = await fetch(url, {
    method: options?.method ?? 'GET',
    headers: options?.headers,
    body: options?.body,
  });
  const data = (await res.json()) as Record<string, unknown>;
  return { status: res.status, data };
}

describe('BridgeServer', () => {
  const servers: BridgeServer[] = [];

  /** Start a server and track it for cleanup. */
  async function startServer(preferredPort?: number): Promise<BridgeServer> {
    const server = new BridgeServer({ preferredPort });
    await server.start();
    servers.push(server);
    return server;
  }

  afterEach(() => {
    for (const s of servers) {
      s.stop();
    }
    servers.length = 0;
  });

  it('starts and binds to the expected port', async () => {
    const server = await startServer(18900);
    expect(server.getPort()).toBe(18900);
  });

  it('GET /health returns correct fields without needing a token', async () => {
    const server = await startServer(18901);
    const { status, data } = await request(18901, '/health');

    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.port).toBe(18901);
    expect(data.version).toBe('0.1.0');
    expect(typeof data.token).toBe('string');
    expect((data.token as string).length).toBe(32);
  });

  it('GET /health includes baseUrl from config', async () => {
    const server = new BridgeServer({
      preferredPort: 18920,
      config: { baseUrl: 'http://localhost:8080' },
    });
    await server.start();
    servers.push(server);

    const { status, data } = await request(18920, '/health');

    expect(status).toBe(200);
    expect(data.baseUrl).toBe('http://localhost:8080');
  });

  it('GET /health returns null baseUrl when config has none', async () => {
    const server = await startServer(18921);
    const { data } = await request(18921, '/health');

    expect(data.baseUrl).toBeNull();
  });

  it('GET /poll returns 401 without X-Popcorn-Token header', async () => {
    await startServer(18902);
    const { status, data } = await request(18902, '/poll');

    expect(status).toBe(401);
    expect(data.ok).toBe(false);
    expect(data.error).toBe('Unauthorized');
  });

  it('GET /poll returns empty messages when queue is empty', async () => {
    const server = await startServer(18903);
    const token = server.getToken();
    const { status, data } = await request(18903, '/poll', {
      headers: { 'X-Popcorn-Token': token },
    });

    expect(status).toBe(200);
    expect(data.messages).toEqual([]);
  });

  it('GET /poll returns queued messages and drains the queue', async () => {
    const server = await startServer(18904);
    const token = server.getToken();

    const msg: PopcornMessage = {
      type: 'hook_ready',
      payload: { hookVersion: '0.1.0', watchDir: 'src' },
      timestamp: Date.now(),
    };
    server.enqueueMessage(msg);

    // First poll returns the message
    const first = await request(18904, '/poll', {
      headers: { 'X-Popcorn-Token': token },
    });
    expect(first.status).toBe(200);
    const msgs = first.data.messages as PopcornMessage[];
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('hook_ready');

    // Second poll returns empty (queue was drained)
    const second = await request(18904, '/poll', {
      headers: { 'X-Popcorn-Token': token },
    });
    expect(second.status).toBe(200);
    expect((second.data.messages as PopcornMessage[])).toHaveLength(0);
  });

  it('POST /result accepts a valid PopcornMessage and triggers callback', async () => {
    const server = await startServer(18905);
    const token = server.getToken();

    let received: PopcornMessage | null = null;
    server.onResult((msg) => {
      received = msg;
    });

    const resultMsg: DemoResultMessage = {
      type: 'demo_result',
      payload: {
        testPlanId: 'test-1',
        passed: true,
        steps: [],
        summary: 'OK',
        videoMetadata: null,
        screenshots: [],
        duration: 50,
        timestamp: Date.now(),
      },
      timestamp: Date.now(),
    };

    const { status, data } = await request(18905, '/result', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Popcorn-Token': token,
      },
      body: JSON.stringify({ message: resultMsg }),
    });

    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(received).not.toBeNull();
    expect(received!.type).toBe('demo_result');
  });

  it('POST /result rejects an invalid message body', async () => {
    const server = await startServer(18906);
    const token = server.getToken();

    const { status, data } = await request(18906, '/result', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Popcorn-Token': token,
      },
      body: JSON.stringify({ message: { not: 'valid' } }),
    });

    expect(status).toBe(400);
    expect(data.ok).toBe(false);
    expect(data.error).toBe('Invalid PopcornMessage');
  });

  it('POST /result returns 401 without token', async () => {
    await startServer(18907);

    const { status, data } = await request(18907, '/result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { type: 'hook_ready', payload: {}, timestamp: 1 } }),
    });

    expect(status).toBe(401);
    expect(data.ok).toBe(false);
  });

  it('falls back to next port when preferred port is in use', async () => {
    const first = await startServer(18908);
    expect(first.getPort()).toBe(18908);

    const second = await startServer(18908);
    expect(second.getPort()).toBe(18909);
  });

  it('stop() closes the server cleanly', async () => {
    const server = await startServer(18910);
    expect(server.getPort()).toBe(18910);

    server.stop();
    // Remove from tracked list so afterEach doesn't double-stop
    servers.splice(servers.indexOf(server), 1);

    expect(server.getPort()).toBe(0);

    // Verify the port is freed — start a new server on the same port
    const second = await startServer(18910);
    expect(second.getPort()).toBe(18910);
  });

  it('handles OPTIONS preflight requests', async () => {
    await startServer(18911);
    const res = await fetch('http://127.0.0.1:18911/poll', { method: 'OPTIONS' });

    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-headers')).toContain('X-Popcorn-Token');
  });
});
