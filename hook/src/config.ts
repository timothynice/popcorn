/**
 * Configuration for the Popcorn hook.
 * Defines which directories to watch, file extensions to track,
 * debounce timing, and where test plans live.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

export interface PopcornConfig {
  /** Directory to watch for frontend file changes, relative to project root. */
  watchDir: string;
  /** File extensions to monitor for changes. */
  extensions: string[];
  /** Debounce interval in ms for per-file change events. */
  debounceMs: number;
  /** Directory/file patterns to ignore during watching. */
  ignorePatterns: string[];
  /** Directory containing test plan JSON files, relative to project root. */
  testPlansDir: string;
  /** Marker comment that flags files as UI-testable outside watchDir. */
  popcornMarker: string;
  /** Preferred starting port for the HTTP bridge server. Default: 7890 */
  bridgePort?: number;
  /** Base URL for the dev server (e.g. "http://localhost:3000"). Used to resolve relative URLs in test plans. */
  baseUrl?: string;
}

/**
 * Returns the default Popcorn configuration.
 */
export function getDefaultConfig(): PopcornConfig {
  return {
    watchDir: 'src/frontend',
    extensions: ['.js', '.ts', '.jsx', '.tsx'],
    debounceMs: 300,
    ignorePatterns: ['node_modules', '.git', 'dist'],
    testPlansDir: 'test-plans',
    popcornMarker: '// popcorn-test',
    bridgePort: 7890,
  };
}

/**
 * Merges partial overrides into the default configuration.
 * Any field not specified in overrides keeps its default value.
 */
export function loadConfig(overrides?: Partial<PopcornConfig>): PopcornConfig {
  const defaults = getDefaultConfig();
  if (!overrides) {
    return defaults;
  }
  return { ...defaults, ...overrides };
}

/**
 * Loads config from popcorn.config.json at the project root,
 * merging with defaults. Programmatic overrides take precedence
 * over file config, which takes precedence over defaults.
 * Falls back to defaults if the file is not found or invalid.
 */
export async function loadConfigFromFile(
  projectRoot: string,
  overrides?: Partial<PopcornConfig>,
): Promise<PopcornConfig> {
  const configPath = path.resolve(projectRoot, 'popcorn.config.json');
  let fileConfig: Partial<PopcornConfig> = {};

  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      fileConfig = parsed as Partial<PopcornConfig>;
    }
  } catch {
    // File not found or invalid — use defaults
  }

  // Overrides > file config > defaults
  return loadConfig({ ...fileConfig, ...overrides });
}
