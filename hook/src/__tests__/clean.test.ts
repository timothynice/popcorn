import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runClean } from '../commands/clean.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'popcorn-clean-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('runClean', () => {
  it('removes all scaffolded files and directories', async () => {
    // Set up scaffolding
    await fs.mkdir(path.join(tmpDir, 'test-plans'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'test-plans', 'login.json'), '{}');
    await fs.mkdir(path.join(tmpDir, '.popcorn'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'popcorn.config.json'), '{}');
    await fs.mkdir(path.join(tmpDir, '.claude'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'settings.local.json'),
      JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: 'Edit|Write',
              hooks: [{ type: 'command', command: 'node /path/to/claude-hook-runner.js' }],
            },
          ],
        },
      }),
    );

    const result = await runClean(tmpDir);

    expect(result.removed).toContain('test-plans/');
    expect(result.removed).toContain('.popcorn/');
    expect(result.removed).toContain('popcorn.config.json');
    expect(result.removed).toContain('.claude/settings.local.json');

    // Verify files are gone
    await expect(fs.stat(path.join(tmpDir, 'test-plans'))).rejects.toThrow();
    await expect(fs.stat(path.join(tmpDir, '.popcorn'))).rejects.toThrow();
    await expect(fs.stat(path.join(tmpDir, 'popcorn.config.json'))).rejects.toThrow();
    await expect(fs.stat(path.join(tmpDir, '.claude', 'settings.local.json'))).rejects.toThrow();
  });

  it('is idempotent — running on empty project skips everything', async () => {
    const result = await runClean(tmpDir);

    expect(result.removed).toHaveLength(0);
    expect(result.skipped.length).toBeGreaterThan(0);
  });

  it('handles partial scaffolding — only removes what exists', async () => {
    await fs.writeFile(path.join(tmpDir, 'popcorn.config.json'), '{}');

    const result = await runClean(tmpDir);

    expect(result.removed).toContain('popcorn.config.json');
    expect(result.skipped).toContain('test-plans/ (not found)');
    expect(result.skipped).toContain('.popcorn/ (not found)');
  });

  it('removes hook entry but preserves other settings', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'settings.local.json'),
      JSON.stringify({
        permissions: { allow: ['Read'] },
        hooks: {
          PostToolUse: [
            {
              matcher: 'Edit|Write',
              hooks: [{ type: 'command', command: 'node /path/to/claude-hook-runner.js' }],
            },
          ],
        },
      }),
    );

    const result = await runClean(tmpDir);

    expect(result.removed).toContain('.claude/settings.local.json (hook entry removed)');

    // File should still exist with the other settings
    const raw = await fs.readFile(path.join(tmpDir, '.claude', 'settings.local.json'), 'utf-8');
    const settings = JSON.parse(raw);
    expect(settings.permissions).toEqual({ allow: ['Read'] });
    expect(settings.hooks).toBeUndefined();
  });

  it('preserves other PostToolUse hooks when removing popcorn hook', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'settings.local.json'),
      JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: 'Edit|Write',
              hooks: [{ type: 'command', command: 'node /path/to/claude-hook-runner.js' }],
            },
            {
              matcher: 'Edit',
              hooks: [{ type: 'command', command: 'eslint --fix' }],
            },
          ],
        },
      }),
    );

    const result = await runClean(tmpDir);

    const raw = await fs.readFile(path.join(tmpDir, '.claude', 'settings.local.json'), 'utf-8');
    const settings = JSON.parse(raw);
    expect(settings.hooks.PostToolUse).toHaveLength(1);
    expect(settings.hooks.PostToolUse[0].hooks[0].command).toBe('eslint --fix');
  });
});
