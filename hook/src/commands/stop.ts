/**
 * `popcorn stop` command.
 * Stops the bridge daemon for the current project.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { readBridgeJson, isProcessAlive, killBridgeDaemon } from '../daemon-utils.js';

export interface StopResult {
  stopped: boolean;
  pid?: number;
  port?: number;
  reason: 'killed' | 'not_running' | 'no_bridge_json';
}

export async function runStop(projectRoot: string): Promise<StopResult> {
  const info = await readBridgeJson(projectRoot);
  if (!info) return { stopped: false, reason: 'no_bridge_json' };

  if (!isProcessAlive(info.pid)) {
    // Stale bridge.json — clean it up
    try {
      await fs.unlink(path.resolve(projectRoot, '.popcorn', 'bridge.json'));
    } catch {
      // ignore
    }
    return { stopped: false, pid: info.pid, port: info.port, reason: 'not_running' };
  }

  const killed = await killBridgeDaemon(projectRoot);
  if (killed) {
    try {
      await fs.unlink(path.resolve(projectRoot, '.popcorn', 'bridge.json'));
    } catch {
      // ignore
    }
  }
  return {
    stopped: killed,
    pid: info.pid,
    port: info.port,
    reason: killed ? 'killed' : 'not_running',
  };
}
