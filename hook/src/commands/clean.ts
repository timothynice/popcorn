/**
 * `popcorn clean` command.
 * Removes all Popcorn scaffolding from a project so it can be re-initialized.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { killBridgeDaemon } from '../daemon-utils.js';

export interface CleanResult {
  /** Paths that were removed. */
  removed: string[];
  /** Paths that were skipped (didn't exist). */
  skipped: string[];
}

/**
 * Removes the Popcorn hook entry from .claude/settings.local.json.
 * If the file becomes effectively empty, deletes it.
 * Returns true if the file was modified or removed.
 */
async function cleanClaudeSettings(projectRoot: string): Promise<'removed' | 'modified' | 'skipped'> {
  const settingsPath = path.resolve(projectRoot, '.claude', 'settings.local.json');

  let raw: string;
  try {
    raw = await fs.readFile(settingsPath, 'utf-8');
  } catch {
    return 'skipped';
  }

  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return 'skipped';
  }

  const hooks = settings.hooks as Record<string, unknown> | undefined;
  if (!hooks || !Array.isArray(hooks.PostToolUse)) {
    return 'skipped';
  }

  const postToolUse = hooks.PostToolUse as unknown[];
  const before = postToolUse.length;
  const filtered = postToolUse.filter((entry: unknown) => {
    const e = entry as Record<string, unknown>;
    const entryHooks = e?.hooks;
    if (!Array.isArray(entryHooks)) return true;
    return !entryHooks.some((h: unknown) => {
      const hook = h as Record<string, unknown>;
      return typeof hook?.command === 'string' &&
        (hook.command as string).includes('claude-hook-runner');
    });
  });

  if (filtered.length === before) {
    return 'skipped';
  }

  // Clean up empty structures
  if (filtered.length === 0) {
    delete hooks.PostToolUse;
  } else {
    hooks.PostToolUse = filtered;
  }
  if (Object.keys(hooks).length === 0) {
    delete settings.hooks;
  }

  // If settings is now empty, delete the file
  if (Object.keys(settings).length === 0) {
    await fs.unlink(settingsPath);
    // Try to remove .claude/ if it's now empty
    try {
      await fs.rmdir(path.dirname(settingsPath));
    } catch {
      // Not empty — leave it
    }
    return 'removed';
  }

  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  return 'modified';
}

/**
 * Removes all Popcorn scaffolding from a project.
 */
export async function runClean(projectRoot: string): Promise<CleanResult> {
  const result: CleanResult = { removed: [], skipped: [] };

  // Kill bridge daemon before removing .popcorn/
  await killBridgeDaemon(projectRoot);

  // Directories to remove
  const dirs = ['test-plans', '.popcorn'];
  for (const dir of dirs) {
    const fullPath = path.resolve(projectRoot, dir);
    try {
      await fs.stat(fullPath);
      await fs.rm(fullPath, { recursive: true, force: true });
      result.removed.push(`${dir}/`);
    } catch {
      result.skipped.push(`${dir}/ (not found)`);
    }
  }

  // Files to remove
  const configPath = path.resolve(projectRoot, 'popcorn.config.json');
  try {
    await fs.stat(configPath);
    await fs.unlink(configPath);
    result.removed.push('popcorn.config.json');
  } catch {
    result.skipped.push('popcorn.config.json (not found)');
  }

  // Clean Claude settings
  const settingsAction = await cleanClaudeSettings(projectRoot);
  if (settingsAction === 'removed') {
    result.removed.push('.claude/settings.local.json');
  } else if (settingsAction === 'modified') {
    result.removed.push('.claude/settings.local.json (hook entry removed)');
  } else {
    result.skipped.push('.claude/settings.local.json (no hook found)');
  }

  return result;
}
