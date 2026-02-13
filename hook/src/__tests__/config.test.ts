import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { getDefaultConfig, loadConfig, loadConfigFromFile } from '../config.js';

describe('getDefaultConfig', () => {
  it('returns expected default values', () => {
    const config = getDefaultConfig();

    expect(config.watchDir).toBe('src/frontend');
    expect(config.extensions).toEqual(['.js', '.ts', '.jsx', '.tsx']);
    expect(config.debounceMs).toBe(300);
    expect(config.ignorePatterns).toEqual(['node_modules', '.git', 'dist']);
    expect(config.testPlansDir).toBe('test-plans');
    expect(config.popcornMarker).toBe('// popcorn-test');
    expect(config.bridgePort).toBe(7890);
  });

  it('returns a new object on each call', () => {
    const a = getDefaultConfig();
    const b = getDefaultConfig();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe('loadConfig', () => {
  it('returns defaults when called with no arguments', () => {
    const config = loadConfig();
    expect(config).toEqual(getDefaultConfig());
  });

  it('returns defaults when called with undefined', () => {
    const config = loadConfig(undefined);
    expect(config).toEqual(getDefaultConfig());
  });

  it('merges overrides into defaults', () => {
    const config = loadConfig({
      watchDir: 'custom/dir',
      debounceMs: 500,
    });

    expect(config.watchDir).toBe('custom/dir');
    expect(config.debounceMs).toBe(500);
  });

  it('preserves defaults for unspecified fields', () => {
    const config = loadConfig({ watchDir: 'other' });

    expect(config.watchDir).toBe('other');
    expect(config.extensions).toEqual(['.js', '.ts', '.jsx', '.tsx']);
    expect(config.debounceMs).toBe(300);
    expect(config.ignorePatterns).toEqual(['node_modules', '.git', 'dist']);
    expect(config.testPlansDir).toBe('test-plans');
    expect(config.popcornMarker).toBe('// popcorn-test');
    expect(config.bridgePort).toBe(7890);
  });

  it('allows overriding extensions', () => {
    const config = loadConfig({ extensions: ['.vue'] });
    expect(config.extensions).toEqual(['.vue']);
  });

  it('allows overriding all fields', () => {
    const config = loadConfig({
      watchDir: 'a',
      extensions: ['.svelte'],
      debounceMs: 100,
      ignorePatterns: ['build'],
      testPlansDir: 'plans',
      popcornMarker: '// test-ui',
      bridgePort: 9999,
    });

    expect(config.watchDir).toBe('a');
    expect(config.extensions).toEqual(['.svelte']);
    expect(config.debounceMs).toBe(100);
    expect(config.ignorePatterns).toEqual(['build']);
    expect(config.testPlansDir).toBe('plans');
    expect(config.popcornMarker).toBe('// test-ui');
    expect(config.bridgePort).toBe(9999);
  });
});

describe('loadConfigFromFile', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'popcorn-config-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('reads from popcorn.config.json and merges with defaults', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'popcorn.config.json'),
      JSON.stringify({ watchDir: 'src/components', debounceMs: 500 }),
    );

    const config = await loadConfigFromFile(tmpDir);
    expect(config.watchDir).toBe('src/components');
    expect(config.debounceMs).toBe(500);
    // Defaults preserved for unspecified fields
    expect(config.extensions).toEqual(['.js', '.ts', '.jsx', '.tsx']);
    expect(config.testPlansDir).toBe('test-plans');
  });

  it('falls back to defaults when file is missing', async () => {
    const config = await loadConfigFromFile(tmpDir);
    expect(config).toEqual(getDefaultConfig());
  });

  it('applies overrides on top of file config', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'popcorn.config.json'),
      JSON.stringify({ watchDir: 'from-file', debounceMs: 500 }),
    );

    const config = await loadConfigFromFile(tmpDir, { watchDir: 'from-override' });
    expect(config.watchDir).toBe('from-override'); // override wins
    expect(config.debounceMs).toBe(500); // file value preserved
  });

  it('handles invalid JSON gracefully', async () => {
    await fs.writeFile(path.join(tmpDir, 'popcorn.config.json'), 'not valid json{{{');

    const config = await loadConfigFromFile(tmpDir);
    expect(config).toEqual(getDefaultConfig());
  });

  it('ignores non-object JSON values', async () => {
    await fs.writeFile(path.join(tmpDir, 'popcorn.config.json'), '"a string"');

    const config = await loadConfigFromFile(tmpDir);
    expect(config).toEqual(getDefaultConfig());
  });
});
