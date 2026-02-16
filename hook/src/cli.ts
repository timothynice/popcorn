#!/usr/bin/env node
/**
 * Popcorn CLI entry point.
 *
 * Usage:
 *   npx popcorn init       Scaffold Popcorn for this project
 *   npx popcorn --help     Show usage
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runInit } from './commands/init.js';
import { runClean } from './commands/clean.js';
import { runServe } from './commands/serve.js';

const args = process.argv.slice(2);
const command = args[0];

async function main(): Promise<void> {
  if (command === 'init') {
    const projectRoot = process.cwd();
    console.log('Initializing Popcorn...\n');

    const result = await runInit(projectRoot);

    if (result.created.length > 0) {
      console.log('Created:');
      for (const item of result.created) {
        console.log(`  + ${item}`);
      }
    }
    if (result.modified.length > 0) {
      console.log('Modified:');
      for (const item of result.modified) {
        console.log(`  ~ ${item}`);
      }
    }
    if (result.skipped.length > 0) {
      console.log('Skipped:');
      for (const item of result.skipped) {
        console.log(`  - ${item}`);
      }
    }

    if (result.generatedPlans.length > 0) {
      console.log('\nAuto-generated test plans:');
      for (const plan of result.generatedPlans) {
        console.log(`  \u26A1 ${plan.path} (${plan.stepCount} steps)`);
      }
    }

    console.log(`\nWatch directory: ${result.watchDir}`);

    // Auto-start the bridge server as a background process
    const started = await startServeDaemon(projectRoot);

    console.log('\nNext steps:');
    console.log('  1. Edit popcorn.config.json if the detected watchDir is wrong');
    if (result.generatedPlans.length > 0) {
      console.log('  2. Review auto-generated plans in test-plans/ and tweak as needed');
    } else {
      console.log('  2. Create test plans in test-plans/ (or let Popcorn auto-generate them)');
    }
    console.log('  3. Install the Popcorn Chrome extension (load extension/dist/ unpacked)');
    console.log('  4. Open your app in Chrome and keep its tab active');
    console.log('  5. Edit a file in your watch directory to trigger a demo');
    if (!started) {
      console.log('');
      console.log('  Note: Could not auto-start bridge server. Run `popcorn serve`');
      console.log('  manually to let the Chrome extension discover your test plans.');
    }
  } else if (command === 'clean') {
    const projectRoot = process.cwd();
    console.log('Cleaning Popcorn from project...\n');

    const result = await runClean(projectRoot);

    if (result.removed.length > 0) {
      console.log('Removed:');
      for (const item of result.removed) {
        console.log(`  - ${item}`);
      }
    }
    if (result.skipped.length > 0) {
      console.log('Skipped:');
      for (const item of result.skipped) {
        console.log(`  ~ ${item}`);
      }
    }

    console.log('\nPopcorn removed. Run `popcorn init` to set up again.');
  } else if (command === 'serve') {
    const projectRoot = process.cwd();
    await runServe(projectRoot);
  } else {
    console.log('Usage: popcorn <command>\n');
    console.log('Commands:');
    console.log('  init     Scaffold Popcorn for this project');
    console.log('  clean    Remove all Popcorn scaffolding from this project');
    console.log('  serve    Start persistent bridge server for Chrome extension');
    if (command && command !== '--help' && command !== '-h') {
      process.exit(1);
    }
  }
}

/**
 * Spawns `popcorn serve` as a detached background process.
 * Returns true if the daemon started successfully.
 */
async function startServeDaemon(projectRoot: string): Promise<boolean> {
  try {
    const thisFile = fileURLToPath(import.meta.url);
    const cliPath = path.resolve(path.dirname(thisFile), 'cli.js');

    const child = spawn(process.execPath, [cliPath, 'serve'], {
      cwd: projectRoot,
      detached: true,
      stdio: 'ignore',
    });

    child.unref();
    console.log(`\nBridge server started (pid ${child.pid}).`);
    console.log('The Chrome extension can now discover your test plans.');
    return true;
  } catch {
    return false;
  }
}

main().catch((err) => {
  console.error(`Error: ${(err as Error).message}`);
  process.exit(1);
});
