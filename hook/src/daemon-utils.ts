/**
 * Shared utilities for managing Popcorn bridge server daemons.
 * Used by clean, stop, status, and init commands.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

export interface BridgeInfo {
  port: number;
  token: string;
  pid: number;
  startedAt: string;
}

/** Read and parse .popcorn/bridge.json. Returns null if missing or unreadable. */
export async function readBridgeJson(projectRoot: string): Promise<BridgeInfo | null> {
  try {
    const bridgePath = path.resolve(projectRoot, '.popcorn', 'bridge.json');
    const raw = await fs.readFile(bridgePath, 'utf-8');
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (typeof data.pid !== 'number' || typeof data.port !== 'number') return null;
    return data as unknown as BridgeInfo;
  } catch {
    return null;
  }
}

/** Check if a process with the given PID is alive. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Kill the bridge daemon for a project by reading .popcorn/bridge.json PID. Returns true if killed. */
export async function killBridgeDaemon(projectRoot: string): Promise<boolean> {
  const info = await readBridgeJson(projectRoot);
  if (!info) return false;
  if (!isProcessAlive(info.pid)) return false;
  try {
    process.kill(info.pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}
