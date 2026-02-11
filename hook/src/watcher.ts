/**
 * File watcher for the Popcorn hook.
 * Monitors configured directories for file changes using chokidar,
 * debounces per-file events, and emits structured change notifications.
 */

import chokidar from 'chokidar';
import fs from 'node:fs';
import path from 'node:path';
import type { PopcornConfig } from './config.js';

/** Describes a detected file change event. */
export interface FileChangeEvent {
  /** Absolute path to the changed file. */
  filePath: string;
  /** Relative path from the watch root. */
  relativePath: string;
  /** Type of filesystem event. */
  eventType: 'add' | 'change' | 'unlink';
  /** Whether the file contains the popcorn-test marker. */
  hasPopcornMarker: boolean;
  /** ISO timestamp of the event. */
  timestamp: string;
}

export type FileChangeCallback = (event: FileChangeEvent) => void;

/**
 * Watches a configured directory for file changes, debouncing per-file
 * and filtering by extension. Provides start/stop lifecycle and a
 * callback-based notification API.
 */
export class Watcher {
  private watcher: chokidar.FSWatcher | null = null;
  private callbacks: FileChangeCallback[] = [];
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private config: PopcornConfig;
  private watchPath: string;
  private running = false;

  constructor(config: PopcornConfig, projectRoot?: string) {
    this.config = config;
    const root = projectRoot ?? process.cwd();
    this.watchPath = path.resolve(root, config.watchDir);
  }

  /**
   * Registers a callback to be invoked on debounced file changes.
   */
  onFileChange(callback: FileChangeCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Starts the file watcher. Returns a promise that resolves once
   * the watcher is ready (initial scan complete).
   */
  async start(): Promise<void> {
    if (this.running) return;

    // Build glob patterns for watched extensions
    const extGlobs = this.config.extensions.map(
      (ext) => `**/*${ext}`,
    );

    // Build ignore patterns
    const ignored = this.config.ignorePatterns.map((p) =>
      // Convert simple directory names to glob patterns
      p.includes('/') || p.includes('*') ? p : `**/${p}/**`,
    );

    this.watcher = chokidar.watch(extGlobs, {
      cwd: this.watchPath,
      ignored,
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: false,
    });

    this.watcher.on('add', (filePath) => this.handleEvent(filePath, 'add'));
    this.watcher.on('change', (filePath) => this.handleEvent(filePath, 'change'));
    this.watcher.on('unlink', (filePath) => this.handleEvent(filePath, 'unlink'));

    // Wait for the watcher to be ready
    await new Promise<void>((resolve, reject) => {
      this.watcher!.on('ready', () => resolve());
      this.watcher!.on('error', (err) => reject(err));
    });

    this.running = true;
  }

  /**
   * Stops the watcher and cleans up all resources (timers, listeners).
   */
  async stop(): Promise<void> {
    if (!this.running || !this.watcher) return;

    // Clear all pending debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    await this.watcher.close();
    this.watcher = null;
    this.running = false;
  }

  /** Returns whether the watcher is currently running. */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Handles a raw filesystem event by debouncing per-file.
   * After the debounce window, reads the file to check for the
   * popcorn-test marker and notifies all registered callbacks.
   */
  private handleEvent(relativePath: string, eventType: 'add' | 'change' | 'unlink'): void {
    const absPath = path.resolve(this.watchPath, relativePath);

    // Check extension filter
    const ext = path.extname(relativePath);
    if (!this.config.extensions.includes(ext)) return;

    // Clear existing debounce timer for this file
    const existingTimer = this.debounceTimers.get(absPath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new debounce timer
    const timer = setTimeout(() => {
      this.debounceTimers.delete(absPath);
      const hasMarker = this.checkPopcornMarker(absPath, eventType);

      const event: FileChangeEvent = {
        filePath: absPath,
        relativePath,
        eventType,
        hasPopcornMarker: hasMarker,
        timestamp: new Date().toISOString(),
      };

      for (const cb of this.callbacks) {
        try {
          cb(event);
        } catch {
          // Swallow callback errors to avoid crashing the watcher
        }
      }
    }, this.config.debounceMs);

    this.debounceTimers.set(absPath, timer);
  }

  /**
   * Reads the file to check if it contains the popcorn-test marker.
   * Returns false for deleted files or read errors.
   */
  private checkPopcornMarker(absPath: string, eventType: string): boolean {
    if (eventType === 'unlink') return false;
    try {
      const content = fs.readFileSync(absPath, 'utf-8');
      return content.includes(this.config.popcornMarker);
    } catch {
      return false;
    }
  }
}
