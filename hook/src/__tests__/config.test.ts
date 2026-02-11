import { describe, it, expect } from 'vitest';
import { getDefaultConfig, loadConfig } from '../config.js';

describe('getDefaultConfig', () => {
  it('returns expected default values', () => {
    const config = getDefaultConfig();

    expect(config.watchDir).toBe('src/frontend');
    expect(config.extensions).toEqual(['.js', '.ts', '.jsx', '.tsx']);
    expect(config.debounceMs).toBe(300);
    expect(config.ignorePatterns).toEqual(['node_modules', '.git', 'dist']);
    expect(config.testPlansDir).toBe('test-plans');
    expect(config.popcornMarker).toBe('// popcorn-test');
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
    });

    expect(config.watchDir).toBe('a');
    expect(config.extensions).toEqual(['.svelte']);
    expect(config.debounceMs).toBe(100);
    expect(config.ignorePatterns).toEqual(['build']);
    expect(config.testPlansDir).toBe('plans');
    expect(config.popcornMarker).toBe('// test-ui');
  });
});
