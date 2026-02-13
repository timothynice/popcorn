/**
 * Client for communicating with the Popcorn Chrome extension.
 * Supports two transports:
 *   1. HTTP bridge (preferred) — BridgeServer on localhost
 *   2. File-based IPC (fallback) — Messenger via .popcorn/outbox + inbox
 *
 * On connect(), the client tries the HTTP bridge first. If the bridge
 * server fails to start (e.g., all ports occupied), it falls back to
 * the file-based messenger transparently.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  PopcornMessage,
  StartDemoMessage,
  DemoResult,
  TestPlan,
} from '@popcorn/shared';
import { createMessage } from '@popcorn/shared';
import { Messenger } from './messenger.js';
import { BridgeServer } from './bridge-server.js';
import { createLogger } from './logger.js';

const log = createLogger('client');

export interface ExtensionClientOptions {
  projectRoot: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  /** Preferred starting port for the HTTP bridge server. Default: 7890 */
  bridgePort?: number;
}

export class ExtensionClient {
  private messenger: Messenger;
  private bridgeServer: BridgeServer | null = null;
  private activeTransport: 'http' | 'file' = 'file';
  private projectRoot: string;
  private timeoutMs: number;
  private bridgePort: number;
  private connected = false;
  private resultCallbacks: Map<
    string,
    { resolve: (result: DemoResult) => void; reject: (err: Error) => void }
  > = new Map();

  constructor(options: ExtensionClientOptions) {
    this.projectRoot = options.projectRoot;
    this.messenger = new Messenger(options.projectRoot, {
      pollIntervalMs: options.pollIntervalMs,
    });
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.bridgePort = options.bridgePort ?? 7890;
  }

  /**
   * Connect to the extension. Tries the HTTP bridge first, then
   * falls back to file-based IPC if the bridge cannot start.
   */
  async connect(): Promise<void> {
    // Try HTTP transport first
    try {
      this.bridgeServer = new BridgeServer({ preferredPort: this.bridgePort });
      const port = await this.bridgeServer.start();

      // Write bridge.json for discoverability
      await this.writeBridgeJson(port, this.bridgeServer.getToken());

      // Listen for results from extension
      this.bridgeServer.onResult((msg: PopcornMessage) => {
        this.handleIncomingMessage(msg);
      });

      // Send handshake via bridge queue
      const hookReady = createMessage('hook_ready', {
        hookVersion: '0.1.0',
        watchDir: 'src/frontend',
      });
      this.bridgeServer.enqueueMessage(hookReady);

      this.activeTransport = 'http';
      this.connected = true;
      log.info(`Connected via HTTP bridge on port ${port}`);
      return;
    } catch (err) {
      log.warn('HTTP bridge failed, falling back to file IPC', {
        error: (err as Error).message,
      });
      this.bridgeServer = null;
    }

    // Fall back to file-based transport
    await this.messenger.connect();
    this.setupMessengerCallbacks();

    // Send handshake
    const hookReady = createMessage('hook_ready', {
      hookVersion: '0.1.0',
      watchDir: 'src/frontend',
    });
    await this.messenger.sendMessage(hookReady);

    this.activeTransport = 'file';
    this.connected = true;
    log.info('Connected via file-based IPC (fallback)');
  }

  /**
   * Disconnect from the extension and clean up all resources.
   */
  disconnect(): void {
    if (this.bridgeServer) {
      this.bridgeServer.stop();
      this.cleanupBridgeJson();
      this.bridgeServer = null;
    }
    this.messenger.disconnect();
    // Reject any pending callbacks
    for (const [, cb] of this.resultCallbacks) {
      cb.reject(new Error('Client disconnected'));
    }
    this.resultCallbacks.clear();
    this.connected = false;
    log.info('Disconnected from extension');
  }

  /**
   * Start a demo and wait for the result.
   * Sends start_demo to the extension, waits for demo_result.
   */
  async startDemo(
    testPlanId: string,
    testPlan: TestPlan,
    acceptanceCriteria: string[],
    triggeredBy: string,
  ): Promise<DemoResult> {
    if (!this.connected) {
      throw new Error('Not connected to extension. Call connect() first.');
    }

    const message = createMessage<StartDemoMessage>('start_demo', {
      testPlanId,
      testPlan,
      acceptanceCriteria,
      triggeredBy,
    });

    // Create a promise that will resolve when we get the result back
    const resultPromise = new Promise<DemoResult>((resolve, reject) => {
      this.resultCallbacks.set(testPlanId, { resolve, reject });

      // Set timeout
      setTimeout(() => {
        const pending = this.resultCallbacks.get(testPlanId);
        if (pending) {
          this.resultCallbacks.delete(testPlanId);
          reject(
            new Error(
              `Demo timed out after ${this.timeoutMs}ms for plan: ${testPlanId}`,
            ),
          );
        }
      }, this.timeoutMs);
    });

    // Send the start_demo message via the active transport
    if (this.activeTransport === 'http' && this.bridgeServer) {
      this.bridgeServer.enqueueMessage(message);
    } else {
      await this.messenger.sendMessage(message);
    }
    log.info('Demo started', { testPlanId, transport: this.activeTransport });

    return resultPromise;
  }

  /** Returns true if the client is connected to the extension. */
  isConnected(): boolean {
    return this.connected;
  }

  /** Returns the active transport type ('http' or 'file'). */
  getTransport(): 'http' | 'file' {
    return this.activeTransport;
  }

  // --------------- private ---------------

  /** Handles an incoming message from either transport. */
  private handleIncomingMessage(msg: PopcornMessage): void {
    if (msg.type === 'demo_result') {
      const testPlanId = msg.payload.testPlanId;
      const pending = this.resultCallbacks.get(testPlanId);
      if (pending) {
        pending.resolve(msg.payload as DemoResult);
        this.resultCallbacks.delete(testPlanId);
      }
    }
  }

  /** Sets up the messenger's onMessage callback for file-based transport. */
  private setupMessengerCallbacks(): void {
    this.messenger.onMessage((msg: PopcornMessage) => {
      this.handleIncomingMessage(msg);
    });
  }

  /** Writes .popcorn/bridge.json for extension discovery. */
  private async writeBridgeJson(port: number, token: string): Promise<void> {
    const popcornDir = path.resolve(this.projectRoot, '.popcorn');
    await fs.mkdir(popcornDir, { recursive: true });

    const bridgePath = path.resolve(popcornDir, 'bridge.json');
    const data = {
      port,
      token,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    };
    await fs.writeFile(bridgePath, JSON.stringify(data, null, 2), 'utf-8');
    log.debug('Wrote bridge.json', { port });
  }

  /** Deletes .popcorn/bridge.json on disconnect. */
  private cleanupBridgeJson(): void {
    const bridgePath = path.resolve(this.projectRoot, '.popcorn', 'bridge.json');
    fs.unlink(bridgePath).catch(() => {
      // Ignore if already removed
    });
  }
}
