import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Watcher } from '../watcher.js';
import type { FileChangeEvent } from '../watcher.js';
import { getDefaultConfig } from '../config.js';
import type { PopcornConfig } from '../config.js';

/**
 * Helper: creates a temp directory structure for watcher tests.
 * Returns the temp root (which acts as the project root) and
 * the watched subdirectory path.
 */
function createTempWatchDir(): { projectRoot: string; watchedDir: string } {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'popcorn-watcher-'));
  const watchedDir = path.join(projectRoot, 'src', 'frontend');
  fs.mkdirSync(watchedDir, { recursive: true });
  return { projectRoot, watchedDir };
}

/** Helper: waits for a specified number of milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Helper: collects file change events into an array via a callback. */
function collectEvents(watcher: Watcher): FileChangeEvent[] {
  const events: FileChangeEvent[] = [];
  watcher.onFileChange((event) => events.push(event));
  return events;
}

describe('Watcher', () => {
  let projectRoot: string;
  let watchedDir: string;
  let watcher: Watcher;
  let config: PopcornConfig;

  beforeEach(() => {
    const dirs = createTempWatchDir();
    projectRoot = dirs.projectRoot;
    watchedDir = dirs.watchedDir;
    config = getDefaultConfig();
    // Use a short debounce for faster tests
    config.debounceMs = 50;
  });

  afterEach(async () => {
    if (watcher && watcher.isRunning()) {
      await watcher.stop();
    }
    // Clean up temp directory
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('detects file additions in watched directory', async () => {
    watcher = new Watcher(config, projectRoot);
    const events = collectEvents(watcher);
    await watcher.start();

    // Create a .tsx file in the watched directory
    const filePath = path.join(watchedDir, 'Component.tsx');
    fs.writeFileSync(filePath, 'export default function Component() {}');

    // Wait for debounce + processing
    await sleep(300);

    expect(events.length).toBeGreaterThanOrEqual(1);
    const event = events[0];
    expect(event.eventType).toBe('add');
    expect(event.filePath).toBe(filePath);
    expect(event.relativePath).toContain('Component.tsx');
  });

  it('detects file changes in watched directory', async () => {
    // Pre-create the file before starting the watcher
    const filePath = path.join(watchedDir, 'Existing.ts');
    fs.writeFileSync(filePath, 'const x = 1;');

    watcher = new Watcher(config, projectRoot);
    const events = collectEvents(watcher);
    await watcher.start();

    // Modify the file
    fs.writeFileSync(filePath, 'const x = 2;');

    await sleep(300);

    expect(events.length).toBeGreaterThanOrEqual(1);
    const changeEvent = events.find((e) => e.eventType === 'change');
    expect(changeEvent).toBeDefined();
    expect(changeEvent!.filePath).toBe(filePath);
  });

  it('ignores files with non-watched extensions', async () => {
    watcher = new Watcher(config, projectRoot);
    const events = collectEvents(watcher);
    await watcher.start();

    // Create files with non-watched extensions
    fs.writeFileSync(path.join(watchedDir, 'style.css'), 'body {}');
    fs.writeFileSync(path.join(watchedDir, 'data.json'), '{}');
    fs.writeFileSync(path.join(watchedDir, 'readme.md'), '# Hello');

    await sleep(300);

    // None of these extensions should trigger events
    expect(events.length).toBe(0);
  });

  it('debounces rapid changes to the same file', async () => {
    watcher = new Watcher(config, projectRoot);
    const events = collectEvents(watcher);
    await watcher.start();

    const filePath = path.join(watchedDir, 'Rapid.tsx');

    // Write to the same file multiple times in quick succession
    fs.writeFileSync(filePath, 'version 1');
    await sleep(10);
    fs.writeFileSync(filePath, 'version 2');
    await sleep(10);
    fs.writeFileSync(filePath, 'version 3');

    // Wait for debounce to settle
    await sleep(300);

    // Should only get a small number of events due to debouncing,
    // not one event per write. Chokidar may batch the initial add + changes.
    // The key assertion: we should not get 3 separate events.
    expect(events.length).toBeLessThanOrEqual(2);
  });

  it('can be stopped cleanly', async () => {
    watcher = new Watcher(config, projectRoot);
    const events = collectEvents(watcher);
    await watcher.start();

    expect(watcher.isRunning()).toBe(true);

    await watcher.stop();

    expect(watcher.isRunning()).toBe(false);

    // Changes after stop should not trigger events
    fs.writeFileSync(path.join(watchedDir, 'AfterStop.tsx'), 'should not fire');

    await sleep(200);

    expect(events.length).toBe(0);
  });

  it('detects popcorn-test marker in changed files', async () => {
    watcher = new Watcher(config, projectRoot);
    const events = collectEvents(watcher);
    await watcher.start();

    // Create a file with the marker
    const filePath = path.join(watchedDir, 'Marked.tsx');
    fs.writeFileSync(filePath, '// popcorn-test\nexport default function Marked() {}');

    await sleep(300);

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].hasPopcornMarker).toBe(true);
  });

  it('reports no marker for files without it', async () => {
    watcher = new Watcher(config, projectRoot);
    const events = collectEvents(watcher);
    await watcher.start();

    const filePath = path.join(watchedDir, 'NoMarker.tsx');
    fs.writeFileSync(filePath, 'export default function NoMarker() {}');

    await sleep(300);

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].hasPopcornMarker).toBe(false);
  });

  it('is safe to call stop() multiple times', async () => {
    watcher = new Watcher(config, projectRoot);
    await watcher.start();

    await watcher.stop();
    await watcher.stop(); // Should not throw

    expect(watcher.isRunning()).toBe(false);
  });

  it('is safe to call start() when already running', async () => {
    watcher = new Watcher(config, projectRoot);
    await watcher.start();
    await watcher.start(); // Should not throw or create duplicate watchers

    expect(watcher.isRunning()).toBe(true);
  });
});
