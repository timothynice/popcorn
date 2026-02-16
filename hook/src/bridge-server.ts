/**
 * HTTP bridge server for hook-to-extension communication.
 * Runs a lightweight HTTP server on localhost that the Chrome extension
 * can poll for messages and post results back to. This replaces the
 * file-based IPC when both sides are available over HTTP.
 *
 * Routes:
 *   GET  /health  — discovery endpoint (no auth), returns port + token
 *   GET  /poll    — drains outgoing message queue (requires token)
 *   POST /result  — receives a PopcornMessage from the extension (requires token)
 */

import http from 'node:http';
import crypto from 'node:crypto';
import type { PopcornMessage } from '@popcorn/shared';
import { isPopcornMessage } from '@popcorn/shared';
import { createLogger } from './logger.js';

const log = createLogger('bridge');

const VERSION = '0.1.0';
const MAX_PORT_ATTEMPTS = 10;

export type ResultCallback = (msg: PopcornMessage) => void;

export class BridgeServer {
  private server: http.Server | null = null;
  private port = 0;
  private preferredPort: number;
  private token: string;
  private queue: PopcornMessage[] = [];
  private resultCallbacks: ResultCallback[] = [];
  private config: Record<string, unknown>;

  constructor(options?: { preferredPort?: number; config?: Record<string, unknown> }) {
    this.preferredPort = options?.preferredPort ?? 7890;
    this.token = crypto.randomBytes(16).toString('hex');
    this.config = options?.config ?? {};
  }

  /**
   * Starts the HTTP server, trying ports from preferredPort up to
   * preferredPort + MAX_PORT_ATTEMPTS - 1. Binds to 127.0.0.1 only.
   * Returns the port that was successfully bound.
   */
  async start(): Promise<number> {
    this.server = http.createServer((req, res) => this.handleRequest(req, res));

    for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
      const tryPort = this.preferredPort + attempt;
      try {
        await this.listen(tryPort);
        this.port = tryPort;
        log.info(`Bridge server started on port ${tryPort}`);
        return tryPort;
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EADDRINUSE' && attempt < MAX_PORT_ATTEMPTS - 1) {
          log.debug(`Port ${tryPort} in use, trying next`);
          continue;
        }
        throw err;
      }
    }

    throw new Error(
      `Could not find an available port in range ${this.preferredPort}-${this.preferredPort + MAX_PORT_ATTEMPTS - 1}`,
    );
  }

  /** Stops the HTTP server and clears internal state. */
  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.queue = [];
    this.resultCallbacks = [];
    this.port = 0;
  }

  /** Returns the port the server is bound to, or 0 if not started. */
  getPort(): number {
    return this.port;
  }

  /** Returns the auth token for this server instance. */
  getToken(): string {
    return this.token;
  }

  /** Adds a message to the outgoing queue for the extension to poll. */
  enqueueMessage(msg: PopcornMessage): void {
    this.queue.push(msg);
    log.debug('Message enqueued', { type: msg.type });
  }

  /** Registers a callback invoked when the extension posts a result. */
  onResult(cb: ResultCallback): void {
    this.resultCallbacks.push(cb);
  }

  /** Updates the config object. */
  setConfig(config: Record<string, unknown>): void {
    this.config = config;
  }

  /** Saves config to popcorn.config.json in the project root. */
  private async saveConfigToDisk(config: Record<string, unknown>): Promise<void> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const configPath = path.resolve(process.cwd(), 'popcorn.config.json');
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  // --------------- private ---------------

  /** Wraps server.listen in a promise for async/await port probing. */
  private listen(port: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const srv = this.server!;
      const onError = (err: Error) => {
        srv.removeListener('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        srv.removeListener('error', onError);
        resolve();
      };
      srv.once('error', onError);
      srv.once('listening', onListening);
      srv.listen(port, '127.0.0.1');
    });
  }

  /** Central request dispatcher. */
  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // CORS headers for Chrome extension requests
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Popcorn-Token');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = req.url ?? '/';

    if (url === '/health' && req.method === 'GET') {
      this.handleHealth(res);
    } else if (url === '/poll' && req.method === 'GET') {
      this.handlePoll(req, res);
    } else if (url === '/result' && req.method === 'POST') {
      this.handleResult(req, res);
    } else if (url === '/config' && req.method === 'GET') {
      this.handleGetConfig(req, res);
    } else if (url === '/config' && req.method === 'POST') {
      this.handleSetConfig(req, res);
    } else if (url === '/demo' && req.method === 'POST') {
      this.handlePostDemo(req, res);
    } else if (url === '/plans' && req.method === 'GET') {
      this.handleGetPlans(req, res);
    } else if (url.startsWith('/plans/') && req.method === 'GET') {
      this.handleGetPlan(req, res, url);
    } else {
      this.json(res, 404, { ok: false, error: 'Not found' });
    }
  }

  /** GET /health — no auth required, used for discovery. */
  private handleHealth(res: http.ServerResponse): void {
    this.json(res, 200, {
      ok: true,
      port: this.port,
      version: VERSION,
      token: this.token,
      baseUrl: (this.config.baseUrl as string) || null,
    });
  }

  /** GET /poll — drains the message queue. Requires token. */
  private handlePoll(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (!this.checkToken(req, res)) return;

    const messages = this.queue.splice(0);
    this.json(res, 200, { messages });
  }

  /** POST /result — receives a PopcornMessage from the extension. Requires token. */
  private handleResult(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (!this.checkToken(req, res)) return;

    this.readBody(req)
      .then((body) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          this.json(res, 400, { ok: false, error: 'Invalid JSON' });
          return;
        }

        // Accept either { message: PopcornMessage } or a bare PopcornMessage
        const msg = (parsed as Record<string, unknown>).message ?? parsed;

        if (!isPopcornMessage(msg)) {
          this.json(res, 400, { ok: false, error: 'Invalid PopcornMessage' });
          return;
        }

        log.debug('Result received', { type: (msg as PopcornMessage).type });

        for (const cb of this.resultCallbacks) {
          try {
            cb(msg as PopcornMessage);
          } catch {
            // Swallow callback errors
          }
        }

        this.json(res, 200, { ok: true });
      })
      .catch(() => {
        this.json(res, 400, { ok: false, error: 'Failed to read request body' });
      });
  }

  /** GET /config — returns current config. Requires token. */
  private handleGetConfig(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (!this.checkToken(req, res)) return;
    this.json(res, 200, { ok: true, config: this.config });
  }

  /** POST /config — updates config. Requires token. */
  private handleSetConfig(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (!this.checkToken(req, res)) return;

    this.readBody(req)
      .then(async (body) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          this.json(res, 400, { ok: false, error: 'Invalid JSON' });
          return;
        }

        const data = parsed as Record<string, unknown>;
        if (!data.config || typeof data.config !== 'object') {
          this.json(res, 400, { ok: false, error: 'Missing config object' });
          return;
        }

        this.config = data.config as Record<string, unknown>;
        await this.saveConfigToDisk(this.config);
        log.info('Config updated and saved');

        this.json(res, 200, { ok: true });
      })
      .catch(() => {
        this.json(res, 500, { ok: false, error: 'Failed to save config' });
      });
  }

  /** POST /demo — accepts a start_demo message and enqueues it. Requires token. */
  private handlePostDemo(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (!this.checkToken(req, res)) return;

    this.readBody(req)
      .then((body) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          this.json(res, 400, { ok: false, error: 'Invalid JSON' });
          return;
        }

        const msg = (parsed as Record<string, unknown>).message ?? parsed;

        if (!isPopcornMessage(msg)) {
          this.json(res, 400, { ok: false, error: 'Invalid PopcornMessage' });
          return;
        }

        this.enqueueMessage(msg as PopcornMessage);
        log.info('Demo enqueued via POST /demo', { type: (msg as PopcornMessage).type });
        this.json(res, 200, { ok: true });
      })
      .catch(() => {
        this.json(res, 400, { ok: false, error: 'Failed to read request body' });
      });
  }

  /** GET /plans — lists all test plan names. Requires token. */
  private handleGetPlans(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (!this.checkToken(req, res)) return;

    (async () => {
      const { listTestPlans } = await import('./plan-loader.js');
      const testPlansDir = (this.config.testPlansDir as string) || 'test-plans';
      const plans = await listTestPlans(testPlansDir);
      this.json(res, 200, { ok: true, plans });
    })().catch((err) => {
      log.error('Failed to list plans', { error: (err as Error).message });
      this.json(res, 500, { ok: false, error: 'Failed to list plans' });
    });
  }

  /** GET /plans/:planName — loads a specific test plan. Requires token. */
  private handleGetPlan(req: http.IncomingMessage, res: http.ServerResponse, url: string): void {
    if (!this.checkToken(req, res)) return;

    const planName = url.slice(7); // Remove '/plans/' prefix

    (async () => {
      const { loadTestPlan } = await import('./plan-loader.js');
      const testPlansDir = (this.config.testPlansDir as string) || 'test-plans';
      const plan = await loadTestPlan(planName, testPlansDir);
      this.json(res, 200, { ok: true, plan });
    })().catch((err) => {
      log.error('Failed to load plan', { planName, error: (err as Error).message });
      this.json(res, 404, { ok: false, error: 'Plan not found' });
    });
  }

  /** Validates the X-Popcorn-Token header. Returns false and sends 401 if invalid. */
  private checkToken(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    const headerToken = req.headers['x-popcorn-token'];
    if (headerToken !== this.token) {
      this.json(res, 401, { ok: false, error: 'Unauthorized' });
      return false;
    }
    return true;
  }

  /** Reads the full request body as a string. */
  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      req.on('error', reject);
    });
  }

  /** Sends a JSON response with the given status code. */
  private json(res: http.ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }
}
