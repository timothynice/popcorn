/**
 * Main entry point for the Popcorn hook.
 * Wires together the config, file watcher, extension client, plan loader,
 * and logger to form the autonomous UI testing pipeline. When a watched
 * file changes, the hook finds a matching test plan, dispatches it to
 * the Chrome extension via the ExtensionClient, evaluates acceptance
 * criteria, and prints a structured summary.
 */

import path from 'node:path';
import type { PopcornConfig } from './config.js';
import { loadConfigFromFile } from './config.js';
import { Watcher } from './watcher.js';
import type { FileChangeEvent } from './watcher.js';
import { ExtensionClient } from './extension-client.js';
import { loadTestPlan, listTestPlans } from './plan-loader.js';
import { generatePlanFromFile, savePlan } from './plan-generator.js';
import { loadCriteria } from './criteria-loader.js';
import { createLogger } from './logger.js';
import type { Logger } from './logger.js';
import type { DemoResult } from '@popcorn/shared';
import {
  evaluateAllCriteria,
  parsePlainTextCriteria,
} from '@popcorn/shared';

const log: Logger = createLogger('hook');

/** State container for the running hook. */
interface HookState {
  config: PopcornConfig;
  watcher: Watcher;
  client: ExtensionClient;
  projectRoot: string;
  /** Tracks whether a demo is currently in progress, to avoid overlapping runs. */
  demoInFlight: boolean;
}

let hookState: HookState | null = null;

/**
 * Initializes and starts the Popcorn hook.
 * Sets up the file watcher, extension client, and signal handlers.
 *
 * @param overrides - Optional partial config overrides
 * @param projectRoot - Project root directory (defaults to cwd)
 */
export async function setup(
  overrides?: Partial<PopcornConfig>,
  projectRoot?: string,
): Promise<void> {
  const root = projectRoot ?? process.cwd();
  const config = await loadConfigFromFile(root, overrides);

  log.info('Starting hook', { watchDir: config.watchDir, projectRoot: root });

  const client = new ExtensionClient({
    projectRoot: root,
    pollIntervalMs: overrides?.debounceMs ?? undefined,
  });

  try {
    await client.connect();
    log.info('Connected to extension');
  } catch (err) {
    log.error('Failed to connect to extension', {
      error: (err as Error).message,
    });
    throw err;
  }

  const watcher = new Watcher(config, root);

  watcher.onFileChange((event: FileChangeEvent) => {
    handleFileChange(event, config, client, root).catch((err) => {
      log.error('Error handling file change', {
        file: event.relativePath,
        error: (err as Error).message,
      });
    });
  });

  await watcher.start();

  hookState = { config, watcher, client, projectRoot: root, demoInFlight: false };

  // Register signal handlers for graceful shutdown
  const onShutdown = () => {
    teardown().catch(() => {});
  };
  process.on('SIGINT', onShutdown);
  process.on('SIGTERM', onShutdown);

  log.info('Hook started', { watchDir: config.watchDir });
}

/**
 * Stops the hook, cleaning up the watcher and extension client.
 */
export async function teardown(): Promise<void> {
  if (!hookState) return;

  const { watcher, client } = hookState;
  await watcher.stop();
  client.disconnect();
  hookState = null;

  log.info('Hook stopped');
}

/**
 * Handles a file change event: looks for a matching test plan and
 * dispatches it to the extension via the ExtensionClient. Evaluates
 * acceptance criteria and prints a summary when the result returns.
 */
async function handleFileChange(
  event: FileChangeEvent,
  config: PopcornConfig,
  client: ExtensionClient,
  projectRoot: string,
): Promise<void> {
  log.info(`File ${event.eventType}: ${event.relativePath}`, {
    hasMarker: event.hasPopcornMarker,
  });

  // Only trigger demos for added or changed files
  if (event.eventType === 'unlink') return;

  // Guard against overlapping demos
  if (hookState?.demoInFlight) {
    log.warn('Demo already in progress, skipping', { file: event.relativePath });
    return;
  }

  const testPlansDir = path.resolve(projectRoot, config.testPlansDir);

  // Try to find a matching test plan
  const baseName = path.basename(event.relativePath, path.extname(event.relativePath));
  let planName = await findMatchingPlan(baseName, testPlansDir);

  if (!planName) {
    log.info(`No matching test plan for '${baseName}', generating...`);

    const absFilePath = path.resolve(projectRoot, event.relativePath);
    const generatedPlan = await generatePlanFromFile(absFilePath, {
      baseUrl: '/',
    });

    if (!generatedPlan) {
      log.debug(`No interactive elements in '${baseName}'`);
      return;
    }

    const savedPath = await savePlan(generatedPlan, testPlansDir);
    log.info(`Generated test plan: ${savedPath}`);
    planName = generatedPlan.planName;
  }

  try {
    if (hookState) hookState.demoInFlight = true;

    const testPlan = await loadTestPlan(planName, testPlansDir);
    const acceptanceCriteria = await loadCriteria(planName, testPlansDir);

    log.info(`Dispatching test plan '${planName}'`, {
      triggeredBy: event.relativePath,
      steps: testPlan.steps.length,
    });

    const result: DemoResult = await client.startDemo(
      testPlan.planName,
      testPlan,
      acceptanceCriteria,
      event.relativePath,
    );

    // Evaluate acceptance criteria
    const criteria = parsePlainTextCriteria(acceptanceCriteria.join('\n'));
    const evaluation = evaluateAllCriteria(result.steps, criteria);

    // Merge criteria results into the demo result for display
    const resultWithCriteria: DemoResult = {
      ...result,
      criteriaResults: evaluation.results,
    };

    printDemoSummary(resultWithCriteria);
  } catch (err) {
    log.error(`Demo failed for plan '${planName}'`, {
      error: (err as Error).message,
    });
  } finally {
    if (hookState) hookState.demoInFlight = false;
  }
}

/**
 * Attempts to find a test plan whose name matches the given base filename.
 * Tries exact match, kebab-case conversion, and prefix matching.
 */
async function findMatchingPlan(
  baseName: string,
  testPlansDir: string,
): Promise<string | null> {
  const available = await listTestPlans(testPlansDir);
  if (available.length === 0) return null;

  // Exact match
  if (available.includes(baseName)) return baseName;

  // Convert PascalCase/camelCase to kebab-case and try
  const kebab = toKebabCase(baseName);
  if (available.includes(kebab)) return kebab;

  // Try prefix match
  const lowerBase = baseName.toLowerCase();
  const prefixMatch = available.find((name) => {
    const lowerName = name.toLowerCase();
    return lowerName.includes(lowerBase) || lowerBase.includes(lowerName.replace('example-', ''));
  });
  if (prefixMatch) return prefixMatch;

  return null;
}

/**
 * Converts a PascalCase or camelCase string to kebab-case.
 */
function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

/**
 * Prints a structured summary of a demo result to the console.
 */
function printDemoSummary(result: DemoResult): void {
  const status = result.passed ? 'PASSED' : 'FAILED';

  log.info('--- Popcorn Demo Result ---');
  log.info(`Plan: ${result.testPlanId}`);
  log.info(`Status: ${status}`);
  log.info(`Duration: ${result.duration}ms`);
  log.info(`Summary: ${result.summary}`);

  if (result.steps.length > 0) {
    log.info('Steps:');
    for (const step of result.steps) {
      const icon = step.passed ? '[OK]' : '[FAIL]';
      log.info(`  ${icon} Step ${step.stepNumber}: ${step.description} (${step.duration}ms)`);
      if (step.error) {
        log.warn(`       Error: ${step.error}`);
      }
    }
  }

  if (result.criteriaResults && result.criteriaResults.length > 0) {
    log.info('Criteria:');
    for (const cr of result.criteriaResults) {
      const icon = cr.passed ? '[OK]' : '[FAIL]';
      log.info(`  ${icon} ${cr.message}`);
    }
  }

  log.info('---------------------------');
}

// If run directly (not imported), start the hook
const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].endsWith('/index.ts') || process.argv[1].endsWith('/index.js'));

if (isDirectRun) {
  setup().catch((err) => {
    log.error(`Fatal: ${(err as Error).message}`);
    process.exit(1);
  });
}
