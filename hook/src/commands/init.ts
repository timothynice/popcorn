/**
 * `popcorn init` command.
 * Scaffolds everything a new project needs to use Popcorn:
 * - test-plans/ directory with an example plan
 * - popcorn.config.json with auto-detected watchDir
 * - .claude/settings.local.json with PostToolUse hook
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePlanFromFile, savePlan } from '../plan-generator.js';

export interface InitResult {
  /** Paths that were created. */
  created: string[];
  /** Paths that were modified (merged). */
  modified: string[];
  /** Paths that were skipped (already exist). */
  skipped: string[];
  /** The detected (or default) watch directory. */
  watchDir: string;
  /** Test plans auto-generated from existing source files. */
  generatedPlans: GeneratedPlanInfo[];
}

export interface GeneratedPlanInfo {
  /** Relative path to the saved plan file. */
  path: string;
  /** Number of steps in the plan. */
  stepCount: number;
}

/** Common frontend directory patterns, checked in priority order. */
const CANDIDATE_WATCH_DIRS = [
  'src/frontend',
  'src/components',
  'src/pages',
  'src/views',
  'src/app',
  'app',
  'pages',
  'components',
  'src',
];

/** Example login test plan for bootstrapping. */
const EXAMPLE_PLAN = {
  planName: 'example-login',
  description: 'Test the login flow',
  baseUrl: '/',
  steps: [
    { stepNumber: 1, action: 'navigate', target: '/login', description: 'Go to login page' },
    { stepNumber: 2, action: 'fill', selector: "input[name='email']", value: 'test@example.com', description: 'Enter email' },
    { stepNumber: 3, action: 'fill', selector: "input[name='password']", value: 'Test1234!', description: 'Enter password' },
    { stepNumber: 4, action: 'click', selector: "button[type='submit']", description: 'Click login' },
    { stepNumber: 5, action: 'assert', assertionType: 'url', expected: '/dashboard', description: 'Verify redirect' },
  ],
  tags: ['login', 'authentication'],
};

/**
 * Resolves the absolute path to the compiled hook runner script.
 * Uses import.meta.url to locate this file, then navigates to the
 * sibling claude-hook-runner.js in the dist/ directory.
 */
function resolveHookRunnerPath(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const distDir = path.dirname(path.dirname(thisFile));
  return path.resolve(distDir, 'claude-hook-runner.js');
}

/** Builds hook configuration for .claude/settings.local.json with absolute path. */
function buildHookConfig(): Record<string, unknown> {
  const hookRunnerPath = resolveHookRunnerPath();
  return {
    matcher: 'Edit|Write',
    hooks: [
      {
        type: 'command',
        command: `node ${hookRunnerPath}`,
        timeout: 30,
        async: true,
      },
    ],
  };
}

/**
 * Scans the project root for common frontend directories.
 * Returns the first match found, or 'src/frontend' as the default.
 */
export async function detectWatchDir(projectRoot: string): Promise<string> {
  for (const candidate of CANDIDATE_WATCH_DIRS) {
    const fullPath = path.resolve(projectRoot, candidate);
    try {
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        return candidate;
      }
    } catch {
      // Directory does not exist; continue
    }
  }
  return 'src/frontend';
}

/**
 * Runs the full init sequence: creates test-plans/, popcorn.config.json,
 * and .claude/settings.local.json (or merges into existing).
 */
export async function runInit(projectRoot: string): Promise<InitResult> {
  const result: InitResult = { created: [], modified: [], skipped: [], watchDir: '', generatedPlans: [] };

  // 1. Detect watch directory
  const watchDir = await detectWatchDir(projectRoot);
  result.watchDir = watchDir;

  // 2. Create test-plans/ — scan existing code or write example plan
  const testPlansDir = path.resolve(projectRoot, 'test-plans');
  await fs.mkdir(testPlansDir, { recursive: true });

  const existing = await safeReaddir(testPlansDir);

  if (!existing.some((f) => f.endsWith('.json'))) {
    // No existing plans — scan the watch directory for source files
    const generated = await scanAndGeneratePlans(projectRoot, watchDir, testPlansDir);
    result.generatedPlans = generated;

    if (generated.length === 0) {
      // No interactive elements found — write the example plan as a starting point
      const examplePlanPath = path.resolve(testPlansDir, 'example-login.json');
      await fs.writeFile(examplePlanPath, JSON.stringify(EXAMPLE_PLAN, null, 2) + '\n');
      result.created.push('test-plans/example-login.json');
    } else {
      for (const plan of generated) {
        result.created.push(plan.path);
      }
    }
  } else {
    result.skipped.push('test-plans/ (already has plans)');
  }

  // 3. Create popcorn.config.json
  const configPath = path.resolve(projectRoot, 'popcorn.config.json');
  if (!(await fileExists(configPath))) {
    const config = {
      watchDir,
      testPlansDir: 'test-plans',
      baseUrl: 'http://localhost:3000',
    };
    await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
    result.created.push('popcorn.config.json');
  } else {
    result.skipped.push('popcorn.config.json (already exists)');
  }

  // 4. Create or merge .claude/settings.local.json
  const claudeSettingsPath = path.resolve(projectRoot, '.claude', 'settings.local.json');
  await mergeClaudeSettings(claudeSettingsPath, result);

  return result;
}

/** File extensions to scan during init. */
const WATCHED_EXTENSIONS = ['.js', '.ts', '.jsx', '.tsx'];

/** Maximum number of source files to scan to avoid long init times. */
const MAX_SCAN_FILES = 50;

/**
 * Scans existing source files in the watch directory and generates
 * test plans for any that contain interactive elements.
 */
export async function scanAndGeneratePlans(
  projectRoot: string,
  watchDir: string,
  testPlansDir: string,
): Promise<GeneratedPlanInfo[]> {
  const fullWatchDir = path.resolve(projectRoot, watchDir);
  const results: GeneratedPlanInfo[] = [];

  let files: string[];
  try {
    const entries = await fs.readdir(fullWatchDir, { recursive: true });
    files = entries
      .filter((entry): entry is string => typeof entry === 'string')
      .filter((f) => WATCHED_EXTENSIONS.some((ext) => f.endsWith(ext)))
      .slice(0, MAX_SCAN_FILES);
  } catch {
    // Watch directory doesn't exist yet — nothing to scan
    return results;
  }

  for (const relFile of files) {
    const fullPath = path.resolve(fullWatchDir, relFile);

    // Skip directories that might match the extension filter
    try {
      const stat = await fs.stat(fullPath);
      if (!stat.isFile()) continue;
    } catch {
      continue;
    }

    const plan = await generatePlanFromFile(fullPath);
    if (plan) {
      const savedPath = await savePlan(plan, testPlansDir);
      const relativePlanPath = path.relative(projectRoot, savedPath);
      results.push({ path: relativePlanPath, stepCount: plan.steps.length });
    }
  }

  return results;
}

/**
 * Creates or merges the Claude Code hook configuration into
 * .claude/settings.local.json. Skips if already configured.
 */
async function mergeClaudeSettings(
  settingsPath: string,
  result: InitResult,
): Promise<void> {
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });

  let settings: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(settingsPath, 'utf-8');
    settings = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // File doesn't exist or is invalid — start fresh
  }

  // Navigate to hooks.PostToolUse
  const hooks = (settings.hooks ?? {}) as Record<string, unknown>;
  const postToolUse = hooks.PostToolUse;

  if (Array.isArray(postToolUse)) {
    // Check if our hook is already configured
    const alreadyConfigured = postToolUse.some(
      (entry: unknown) => {
        const e = entry as Record<string, unknown>;
        const entryHooks = e?.hooks;
        if (!Array.isArray(entryHooks)) return false;
        return entryHooks.some(
          (h: unknown) => {
            const hook = h as Record<string, unknown>;
            return typeof hook?.command === 'string' &&
              (hook.command as string).includes('claude-hook-runner');
          },
        );
      },
    );

    if (alreadyConfigured) {
      result.skipped.push('.claude/settings.local.json (hook already configured)');
      return;
    }

    // Append to existing PostToolUse array
    postToolUse.push(buildHookConfig());
    result.modified.push('.claude/settings.local.json');
  } else {
    // Create PostToolUse
    (hooks as Record<string, unknown>).PostToolUse = [buildHookConfig()];
    settings.hooks = hooks;
    result.created.push('.claude/settings.local.json');
  }

  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n');
}

async function safeReaddir(dirPath: string): Promise<string[]> {
  try {
    return await fs.readdir(dirPath);
  } catch {
    return [];
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}
