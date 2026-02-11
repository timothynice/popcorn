/**
 * File-based IPC messenger for the Popcorn hook (v1).
 * Writes outgoing messages as JSON files to .popcorn/outbox/ and
 * polls .popcorn/inbox/ for incoming messages. This approach avoids
 * needing native messaging or WebSocket infrastructure for the initial version.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { PopcornMessage } from '@popcorn/shared';
import { isPopcornMessage } from '@popcorn/shared';
import { createLogger } from './logger.js';

const log = createLogger('messenger');

/** Default polling interval for reading inbox messages (ms). */
const DEFAULT_POLL_INTERVAL_MS = 500;

export type MessageCallback = (msg: PopcornMessage) => void;

/**
 * File-based message transport between the hook and the Chrome extension.
 * Messages are JSON files named by timestamp + random suffix to avoid collisions.
 */
export class Messenger {
  private outboxDir: string;
  private inboxDir: string;
  private pollInterval: number;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private callbacks: MessageCallback[] = [];
  private processedFiles: Set<string> = new Set();
  private connected = false;

  constructor(
    projectRoot: string,
    options?: { pollIntervalMs?: number },
  ) {
    const ipcRoot = path.resolve(projectRoot, '.popcorn');
    this.outboxDir = path.resolve(ipcRoot, 'outbox');
    this.inboxDir = path.resolve(ipcRoot, 'inbox');
    this.pollInterval = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  /**
   * Initializes the messenger by ensuring the IPC directories exist
   * and starting the inbox polling loop.
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    await fs.mkdir(this.outboxDir, { recursive: true });
    await fs.mkdir(this.inboxDir, { recursive: true });

    this.pollTimer = setInterval(() => {
      this.pollInbox().catch((err) => {
        log.debug('Inbox poll error', { error: (err as Error).message });
      });
    }, this.pollInterval);

    this.connected = true;
    log.debug('Messenger connected', { outbox: this.outboxDir, inbox: this.inboxDir });
  }

  /**
   * Stops the inbox polling loop and cleans up resources.
   */
  disconnect(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.processedFiles.clear();
    this.connected = false;
  }

  /**
   * Registers a callback to be invoked when a valid message arrives in the inbox.
   */
  onMessage(callback: MessageCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Writes a message as a JSON file to the outbox directory.
   * Filename is timestamp-based with a random suffix to avoid collisions.
   */
  async sendMessage(msg: PopcornMessage): Promise<void> {
    if (!this.connected) {
      throw new Error('Messenger is not connected. Call connect() first.');
    }

    const fileName = `${Date.now()}-${randomSuffix()}.json`;
    const filePath = path.resolve(this.outboxDir, fileName);
    const json = JSON.stringify(msg, null, 2);
    await fs.writeFile(filePath, json, 'utf-8');
    log.debug('Message sent', { type: msg.type, file: fileName });
  }

  /**
   * Returns the absolute path to the outbox directory.
   * Useful for testing or external tooling.
   */
  getOutboxDir(): string {
    return this.outboxDir;
  }

  /**
   * Returns the absolute path to the inbox directory.
   * Useful for testing or external tooling.
   */
  getInboxDir(): string {
    return this.inboxDir;
  }

  /**
   * Polls the inbox directory for new JSON files, parses them,
   * validates them as PopcornMessages, and dispatches to callbacks.
   * Processed files are tracked to avoid duplicate delivery.
   */
  private async pollInbox(): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.inboxDir);
    } catch {
      return;
    }

    const jsonFiles = entries.filter((f) => f.endsWith('.json'));

    for (const fileName of jsonFiles) {
      if (this.processedFiles.has(fileName)) continue;

      const filePath = path.resolve(this.inboxDir, fileName);
      try {
        const raw = await fs.readFile(filePath, 'utf-8');
        const parsed: unknown = JSON.parse(raw);

        if (!isPopcornMessage(parsed)) {
          // Mark as processed to avoid re-reading invalid files
          this.processedFiles.add(fileName);
          continue;
        }

        this.processedFiles.add(fileName);

        log.debug('Message received', { type: (parsed as PopcornMessage).type, file: fileName });

        for (const cb of this.callbacks) {
          try {
            cb(parsed);
          } catch {
            // Swallow callback errors
          }
        }

        // Remove processed file to keep inbox clean
        await fs.unlink(filePath).catch(() => {});
      } catch {
        // File may have been removed by another process; skip
      }
    }
  }
}

/** Generates a short random suffix for unique filenames. */
function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}
