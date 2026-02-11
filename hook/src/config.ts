/**
 * Configuration for the Popcorn hook.
 * Defines which directories to watch, file extensions to track,
 * debounce timing, and where test plans live.
 */

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
