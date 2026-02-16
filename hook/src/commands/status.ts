/**
 * `popcorn status` command.
 * Shows whether a bridge daemon is running for the current project.
 */

import { readBridgeJson, isProcessAlive } from '../daemon-utils.js';

export interface StatusResult {
  running: boolean;
  pid?: number;
  port?: number;
  startedAt?: string;
  uptime?: string;
}

/** Format milliseconds as a human-readable uptime string. */
export function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export async function runStatus(projectRoot: string): Promise<StatusResult> {
  const info = await readBridgeJson(projectRoot);
  if (!info) return { running: false };

  if (!isProcessAlive(info.pid)) {
    return { running: false, pid: info.pid, port: info.port };
  }

  const uptimeMs = Date.now() - new Date(info.startedAt).getTime();
  return {
    running: true,
    pid: info.pid,
    port: info.port,
    startedAt: info.startedAt,
    uptime: formatUptime(uptimeMs),
  };
}
