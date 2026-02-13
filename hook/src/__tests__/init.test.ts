import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runInit, detectWatchDir, scanAndGeneratePlans } from '../commands/init.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'popcorn-init-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('detectWatchDir', () => {
  it('returns src/components when that directory exists', async () => {
    await fs.mkdir(path.join(tmpDir, 'src', 'components'), { recursive: true });
    const result = await detectWatchDir(tmpDir);
    expect(result).toBe('src/components');
  });

  it('returns src/frontend as fallback when no candidates found', async () => {
    const result = await detectWatchDir(tmpDir);
    expect(result).toBe('src/frontend');
  });

  it('returns first matching candidate in priority order', async () => {
    // Create both src/frontend and src/components — src/frontend is higher priority
    await fs.mkdir(path.join(tmpDir, 'src', 'frontend'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, 'src', 'components'), { recursive: true });
    const result = await detectWatchDir(tmpDir);
    expect(result).toBe('src/frontend');
  });

  it('detects app directory', async () => {
    await fs.mkdir(path.join(tmpDir, 'app'), { recursive: true });
    const result = await detectWatchDir(tmpDir);
    expect(result).toBe('app');
  });

  it('detects pages directory', async () => {
    await fs.mkdir(path.join(tmpDir, 'pages'), { recursive: true });
    const result = await detectWatchDir(tmpDir);
    expect(result).toBe('pages');
  });
});

describe('runInit', () => {
  it('creates test-plans/example-login.json when directory does not exist', async () => {
    const result = await runInit(tmpDir);

    expect(result.created).toContain('test-plans/example-login.json');
    const planPath = path.join(tmpDir, 'test-plans', 'example-login.json');
    const raw = await fs.readFile(planPath, 'utf-8');
    const plan = JSON.parse(raw);
    expect(plan.planName).toBe('example-login');
    expect(plan.steps).toHaveLength(5);
  });

  it('skips example plan when test-plans/ already has JSON files', async () => {
    const testPlansDir = path.join(tmpDir, 'test-plans');
    await fs.mkdir(testPlansDir, { recursive: true });
    await fs.writeFile(path.join(testPlansDir, 'existing.json'), '{}');

    const result = await runInit(tmpDir);
    expect(result.skipped).toContain('test-plans/ (already has plans)');
    expect(result.created).not.toContain('test-plans/example-login.json');
  });

  it('creates popcorn.config.json with detected watchDir', async () => {
    await fs.mkdir(path.join(tmpDir, 'src', 'components'), { recursive: true });

    const result = await runInit(tmpDir);

    expect(result.created).toContain('popcorn.config.json');
    expect(result.watchDir).toBe('src/components');

    const raw = await fs.readFile(path.join(tmpDir, 'popcorn.config.json'), 'utf-8');
    const config = JSON.parse(raw);
    expect(config.watchDir).toBe('src/components');
    expect(config.testPlansDir).toBe('test-plans');
  });

  it('skips popcorn.config.json if it already exists', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'popcorn.config.json'),
      JSON.stringify({ watchDir: 'custom' }),
    );

    const result = await runInit(tmpDir);
    expect(result.skipped).toContain('popcorn.config.json (already exists)');
  });

  it('creates .claude/settings.local.json with hook config when file does not exist', async () => {
    const result = await runInit(tmpDir);

    expect(result.created).toContain('.claude/settings.local.json');

    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    const raw = await fs.readFile(settingsPath, 'utf-8');
    const settings = JSON.parse(raw);

    expect(settings.hooks.PostToolUse).toHaveLength(1);
    expect(settings.hooks.PostToolUse[0].matcher).toBe('Edit|Write');
    expect(settings.hooks.PostToolUse[0].hooks[0].command).toContain('claude-hook-runner');
  });

  it('merges into existing .claude/settings.local.json without duplicating', async () => {
    // Create existing settings with a different hook
    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(
      settingsPath,
      JSON.stringify({
        hooks: {
          PostToolUse: [{ matcher: 'Other', hooks: [{ type: 'command', command: 'other-tool' }] }],
        },
      }),
    );

    const result = await runInit(tmpDir);

    expect(result.modified).toContain('.claude/settings.local.json');

    const raw = await fs.readFile(settingsPath, 'utf-8');
    const settings = JSON.parse(raw);
    expect(settings.hooks.PostToolUse).toHaveLength(2);
    expect(settings.hooks.PostToolUse[1].hooks[0].command).toContain('claude-hook-runner');
  });

  it('skips hook config if claude-hook-runner already present', async () => {
    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(
      settingsPath,
      JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: 'Edit|Write',
              hooks: [{ type: 'command', command: 'node --loader ts-node/esm hook/src/claude-hook-runner.ts' }],
            },
          ],
        },
      }),
    );

    const result = await runInit(tmpDir);
    expect(result.skipped).toContain('.claude/settings.local.json (hook already configured)');
  });

  it('returns correct watchDir in result', async () => {
    const result = await runInit(tmpDir);
    expect(result.watchDir).toBe('src/frontend'); // default when no dirs exist
  });

  it('returns empty generatedPlans when watch dir does not exist', async () => {
    const result = await runInit(tmpDir);
    expect(result.generatedPlans).toEqual([]);
  });

  it('auto-generates plans from existing source files with interactive elements', async () => {
    const srcDir = path.join(tmpDir, 'src', 'components');
    await fs.mkdir(srcDir, { recursive: true });

    // Write a React component with a form
    await fs.writeFile(
      path.join(srcDir, 'LoginForm.tsx'),
      `export function LoginForm() {
        return (
          <form>
            <input name="email" type="email" />
            <input name="password" type="password" />
            <button type="submit">Login</button>
          </form>
        );
      }`,
    );

    const result = await runInit(tmpDir);

    expect(result.generatedPlans.length).toBeGreaterThanOrEqual(1);
    const loginPlan = result.generatedPlans.find((p) => p.path.includes('login-form'));
    expect(loginPlan).toBeDefined();
    expect(loginPlan!.stepCount).toBeGreaterThan(1);

    // Should NOT have the example plan since real plans were generated
    expect(result.created).not.toContain('test-plans/example-login.json');
    // Generated plan paths should be in created
    expect(result.created).toContain(loginPlan!.path);
  });

  it('writes example plan when source files have no interactive elements', async () => {
    const srcDir = path.join(tmpDir, 'src', 'components');
    await fs.mkdir(srcDir, { recursive: true });

    // Write a utility file with no forms/inputs/buttons
    await fs.writeFile(
      path.join(srcDir, 'utils.ts'),
      `export function add(a: number, b: number) { return a + b; }`,
    );

    const result = await runInit(tmpDir);

    expect(result.generatedPlans).toEqual([]);
    expect(result.created).toContain('test-plans/example-login.json');
  });

  it('does not scan when test-plans/ already has JSON files', async () => {
    const srcDir = path.join(tmpDir, 'src', 'components');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(
      path.join(srcDir, 'Form.tsx'),
      '<form><input name="q" /><button>Search</button></form>',
    );

    // Pre-create a plan so init skips scanning
    const testPlansDir = path.join(tmpDir, 'test-plans');
    await fs.mkdir(testPlansDir, { recursive: true });
    await fs.writeFile(path.join(testPlansDir, 'existing.json'), '{}');

    const result = await runInit(tmpDir);

    expect(result.generatedPlans).toEqual([]);
    expect(result.skipped).toContain('test-plans/ (already has plans)');
  });
});

describe('scanAndGeneratePlans', () => {
  it('returns empty array when watch directory does not exist', async () => {
    const testPlansDir = path.join(tmpDir, 'test-plans');
    const result = await scanAndGeneratePlans(tmpDir, 'nonexistent', testPlansDir);
    expect(result).toEqual([]);
  });

  it('returns empty array when watch directory is empty', async () => {
    const srcDir = path.join(tmpDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    const testPlansDir = path.join(tmpDir, 'test-plans');
    const result = await scanAndGeneratePlans(tmpDir, 'src', testPlansDir);
    expect(result).toEqual([]);
  });

  it('generates plans for files with interactive elements', async () => {
    const srcDir = path.join(tmpDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(
      path.join(srcDir, 'Signup.tsx'),
      `<form><input name="username" /><input name="email" type="email" /><button type="submit">Sign Up</button></form>`,
    );

    const testPlansDir = path.join(tmpDir, 'test-plans');
    const result = await scanAndGeneratePlans(tmpDir, 'src', testPlansDir);

    expect(result.length).toBe(1);
    expect(result[0].path).toContain('signup');
    expect(result[0].stepCount).toBeGreaterThan(1);

    // Verify the file was actually created
    const planFiles = await fs.readdir(testPlansDir);
    expect(planFiles.some((f) => f.includes('signup'))).toBe(true);
  });

  it('skips files without interactive elements', async () => {
    const srcDir = path.join(tmpDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, 'constants.ts'), 'export const API_URL = "/api";');
    await fs.writeFile(
      path.join(srcDir, 'ContactForm.jsx'),
      '<form><input name="message" /><button>Send</button></form>',
    );

    const testPlansDir = path.join(tmpDir, 'test-plans');
    const result = await scanAndGeneratePlans(tmpDir, 'src', testPlansDir);

    // Only the form file should produce a plan
    expect(result.length).toBe(1);
    expect(result[0].path).toContain('contact-form');
  });

  it('scans nested subdirectories', async () => {
    const srcDir = path.join(tmpDir, 'src', 'pages', 'auth');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(
      path.join(srcDir, 'Register.tsx'),
      '<form><input name="name" /><button type="submit">Register</button></form>',
    );

    const testPlansDir = path.join(tmpDir, 'test-plans');
    const result = await scanAndGeneratePlans(tmpDir, 'src', testPlansDir);

    expect(result.length).toBe(1);
    expect(result[0].path).toContain('register');
  });
});
