#!/usr/bin/env node
/**
 * Popcorn CLI entry point.
 *
 * Usage:
 *   npx popcorn init       Scaffold Popcorn for this project
 *   npx popcorn --help     Show usage
 */

import { runInit } from './commands/init.js';
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
    console.log('\nNext steps:');
    console.log('  1. Edit popcorn.config.json if the detected watchDir is wrong');
    if (result.generatedPlans.length > 0) {
      console.log('  2. Review auto-generated plans in test-plans/ and tweak as needed');
    } else {
      console.log('  2. Create test plans in test-plans/ (or let Popcorn auto-generate them)');
    }
    console.log('  3. Install the Popcorn Chrome extension (load extension/dist/ unpacked)');
    console.log('  4. Run `popcorn serve` to start the bridge server');
    console.log('  5. Open your app in Chrome and keep its tab active');
    console.log('  6. Edit a file in your watch directory to trigger a demo');
    console.log('');
    console.log('  Tip: Run `popcorn serve` in a terminal to keep the bridge server');
    console.log('  running. This lets the Chrome extension show your test plans and');
    console.log('  stay connected between demo runs.');
  } else if (command === 'serve') {
    const projectRoot = process.cwd();
    await runServe(projectRoot);
  } else {
    console.log('Usage: popcorn <command>\n');
    console.log('Commands:');
    console.log('  init     Scaffold Popcorn for this project');
    console.log('  serve    Start persistent bridge server for Chrome extension');
    if (command && command !== '--help' && command !== '-h') {
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error(`Error: ${(err as Error).message}`);
  process.exit(1);
});
