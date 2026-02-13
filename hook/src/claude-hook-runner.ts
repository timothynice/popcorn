#!/usr/bin/env node
/**
 * Claude Code hook entry point for Popcorn.
 *
 * This script is invoked by Claude Code's hook system after a file write
 * (`PostToolUse` for Edit/Write tools). It reads the hook event from stdin,
 * checks if the changed file is in the watched directory or has the
 * popcorn-test marker, and if so, dispatches a demo to the extension
 * via HTTP bridge (with file-based IPC fallback).
 *
 * Set up automatically by `popcorn init`. Usage in .claude/settings.local.json:
 *   "hooks": {
 *     "PostToolUse": [{
 *       "matcher": "Edit|Write",
 *       "hooks": [{ "type": "command", "command": "node /path/to/hook/dist/claude-hook-runner.js", "timeout": 30, "async": true }]
 *     }]
 *   }
 */

import path from 'node:path';
import fs from 'node:fs';
import { loadConfigFromFile } from './config.js';
import { loadTestPlan, listTestPlans } from './plan-loader.js';
import { generatePlanFromFile, savePlan } from './plan-generator.js';
import { loadCriteria } from './criteria-loader.js';
import { ExtensionClient } from './extension-client.js';
import { createLogger } from './logger.js';
import {
  evaluateAllCriteria,
  parsePlainTextCriteria,
} from '@popcorn/shared';
import type { DemoResult } from '@popcorn/shared';

const log = createLogger('claude-hook');

interface HookEvent {
  tool_name: string;
  tool_input: {
    file_path?: string;
    command?: string;
  };
  tool_response: string;
}

async function main(): Promise<void> {
  // Read the hook event from stdin
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  if (!input.trim()) {
    // No input means this was called without a hook event; exit silently
    return;
  }

  let event: HookEvent;
  try {
    event = JSON.parse(input);
  } catch {
    log.debug('Could not parse hook event');
    return;
  }

  const filePath = event.tool_input?.file_path;
  if (!filePath) {
    return;
  }

  const projectRoot = process.cwd();
  const config = await loadConfigFromFile(projectRoot);

  // Check if the file is in the watched directory
  const watchDir = path.resolve(projectRoot, config.watchDir);
  const absFilePath = path.resolve(projectRoot, filePath);
  const isInWatchDir = absFilePath.startsWith(watchDir + path.sep);

  // Check for popcorn-test marker
  let hasMarker = false;
  if (!isInWatchDir) {
    try {
      const ext = path.extname(absFilePath);
      if (config.extensions.includes(ext)) {
        const content = fs.readFileSync(absFilePath, 'utf-8');
        hasMarker = content.includes(config.popcornMarker);
      }
    } catch {
      // File read failed; skip
    }
  }

  if (!isInWatchDir && !hasMarker) {
    return;
  }

  log.info(`File changed: ${filePath}`);

  // Find a matching test plan
  const testPlansDir = path.resolve(projectRoot, config.testPlansDir);
  const baseName = path.basename(filePath, path.extname(filePath));
  let planName = await findMatchingPlan(baseName, testPlansDir);

  if (!planName) {
    log.info(`No matching test plan for '${baseName}', generating one...`);

    const generatedPlan = await generatePlanFromFile(absFilePath, {
      baseUrl: config.baseUrl ?? '/',
      projectRoot,
    });

    if (!generatedPlan) {
      // Should not happen — generator now always returns a plan
      log.info(`Could not generate plan for '${baseName}', skipping`);
      return;
    }

    const isVisualCheck = generatedPlan.tags?.includes('visual-check');
    const savedPath = await savePlan(generatedPlan, testPlansDir);
    log.info(`Generated ${isVisualCheck ? 'visual-check' : 'test'} plan saved: ${savedPath}`);
    planName = generatedPlan.planName;
  }

  // Load the test plan and its criteria
  const testPlan = await loadTestPlan(planName, testPlansDir);
  const acceptanceCriteria = await loadCriteria(planName, testPlansDir);

  // Resolve relative baseUrl against config.baseUrl
  if (config.baseUrl && testPlan.baseUrl) {
    try {
      new URL(testPlan.baseUrl);
      // Already absolute — keep it
    } catch {
      // Relative — resolve against config.baseUrl
      testPlan.baseUrl = new URL(testPlan.baseUrl, config.baseUrl).href;
    }
  }

  log.info(`Dispatching test plan '${planName}'`, {
    triggeredBy: filePath,
    steps: testPlan.steps.length,
    baseUrl: testPlan.baseUrl,
  });

  // Connect to the extension and dispatch the demo
  const client = new ExtensionClient({ projectRoot });

  try {
    await client.connect();

    const result: DemoResult = await client.startDemo(
      testPlan.planName,
      testPlan,
      acceptanceCriteria,
      filePath,
    );

    // Evaluate acceptance criteria
    const criteria = parsePlainTextCriteria(acceptanceCriteria.join('\n'));
    const evaluation = evaluateAllCriteria(result.steps, criteria);

    printSummary(result, evaluation);
  } catch (err) {
    const errorMsg = (err as Error).message;
    log.error('Demo dispatch failed', { error: errorMsg });

    // Provide actionable guidance for the most common failure
    if (errorMsg.includes('No web page open') || errorMsg.includes('No active tab')) {
      log.info('');
      log.info('Tip: Make sure your app is open and its tab is active in Chrome.');
      log.info('     Popcorn runs demos on the currently active tab.');
      log.info('     Or set "baseUrl" in popcorn.config.json to auto-navigate');
      log.info('     (e.g. "http://localhost:3000").');
    }
  } finally {
    client.disconnect();
  }
}

async function findMatchingPlan(
  baseName: string,
  testPlansDir: string,
): Promise<string | null> {
  const available = await listTestPlans(testPlansDir);
  if (available.length === 0) return null;

  if (available.includes(baseName)) return baseName;

  const kebab = baseName
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
  if (available.includes(kebab)) return kebab;

  const lowerBase = baseName.toLowerCase();
  const prefixMatch = available.find((name) => {
    const lowerName = name.toLowerCase();
    return lowerName.includes(lowerBase) || lowerBase.includes(lowerName.replace('example-', ''));
  });
  return prefixMatch ?? null;
}

function printSummary(
  result: DemoResult,
  evaluation: { results: Array<{ passed: boolean; message: string }> },
): void {
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

  if (evaluation.results.length > 0) {
    log.info('Criteria:');
    for (const cr of evaluation.results) {
      const icon = cr.passed ? '[OK]' : '[FAIL]';
      log.info(`  ${icon} ${cr.message}`);
    }
  }

  log.info('---------------------------');
}

main().catch((err) => {
  log.error('Hook runner error', { error: (err as Error).message });
  process.exit(1);
});
