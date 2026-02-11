/**
 * Client for communicating with the Popcorn Chrome extension.
 * For v1, this wraps the file-based Messenger with a higher-level API
 * that handles the handshake protocol and result waiting.
 */

import type {
  PopcornMessage,
  StartDemoMessage,
  DemoResult,
  TestPlan,
} from '@popcorn/shared';
import { createMessage } from '@popcorn/shared';
import { Messenger } from './messenger.js';
import { createLogger } from './logger.js';

const log = createLogger('client');

export interface ExtensionClientOptions {
  projectRoot: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export class ExtensionClient {
  private messenger: Messenger;
  private timeoutMs: number;
  private connected = false;
  private resultCallbacks: Map<
    string,
    { resolve: (result: DemoResult) => void; reject: (err: Error) => void }
  > = new Map();

  constructor(options: ExtensionClientOptions) {
    this.messenger = new Messenger(options.projectRoot, {
      pollIntervalMs: options.pollIntervalMs,
    });
    this.timeoutMs = options.timeoutMs ?? 30000;
  }

  /**
   * Connect to the extension via the file-based IPC bridge.
   * Sends a hook_ready message and waits for extension_ready.
   */
  async connect(): Promise<void> {
    await this.messenger.connect();

    // Listen for responses
    this.messenger.onMessage((msg: PopcornMessage) => {
      if (msg.type === 'demo_result') {
        const testPlanId = msg.payload.testPlanId;
        const pending = this.resultCallbacks.get(testPlanId);
        if (pending) {
          pending.resolve(msg.payload as DemoResult);
          this.resultCallbacks.delete(testPlanId);
        }
      }
    });

    // Send handshake
    const hookReady = createMessage('hook_ready', {
      hookVersion: '0.1.0',
      watchDir: 'src/frontend',
    });
    await this.messenger.sendMessage(hookReady);

    this.connected = true;
    log.info('Connected to extension');
  }

  /**
   * Disconnect from the extension.
   */
  disconnect(): void {
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

    // Send the start_demo message
    await this.messenger.sendMessage(message);
    log.info('Demo started', { testPlanId });

    return resultPromise;
  }

  isConnected(): boolean {
    return this.connected;
  }
}
