/**
 * `popcorn serve` command.
 * Starts a persistent HTTP bridge server so the Chrome extension can
 * always discover the hook and fetch test plans, config, etc.
 *
 * The server stays alive until the user presses Ctrl+C or the process
 * receives SIGINT/SIGTERM.
 */

import { loadConfigFromFile } from '../config.js';
import { BridgeServer } from '../bridge-server.js';
import { createLogger } from '../logger.js';

const log = createLogger('serve');

export async function runServe(projectRoot: string): Promise<void> {
  const config = await loadConfigFromFile(projectRoot);

  const bridge = new BridgeServer({
    config: config as unknown as Record<string, unknown>,
  });

  const port = await bridge.start();

  // Write bridge.json for discoverability (same pattern as ExtensionClient)
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const popcornDir = path.resolve(projectRoot, '.popcorn');
  await fs.mkdir(popcornDir, { recursive: true });
  const bridgePath = path.resolve(popcornDir, 'bridge.json');
  await fs.writeFile(
    bridgePath,
    JSON.stringify(
      { port, token: bridge.getToken(), pid: process.pid, startedAt: new Date().toISOString() },
      null,
      2,
    ),
    'utf-8',
  );

  log.info(`Bridge server running on http://127.0.0.1:${port}`);
  log.info('The Chrome extension can now discover the hook and list test plans.');
  log.info('Press Ctrl+C to stop.\n');

  // Listen for results from the extension and log them
  bridge.onResult((msg) => {
    log.info(`Result received: ${msg.type}`);
  });

  // Handle remote shutdown via POST /shutdown
  bridge.onShutdown(async () => {
    log.info('Remote shutdown requested');
    try {
      await fs.unlink(bridgePath);
    } catch {
      // ignore
    }
    process.exit(0);
  });

  // Graceful shutdown
  const shutdown = async () => {
    log.info('\nShutting down...');
    bridge.stop();
    try {
      await fs.unlink(bridgePath);
    } catch {
      // Ignore if already removed
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep the process alive
  await new Promise<never>(() => {});
}
