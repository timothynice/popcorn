/**
 * Test plan loader for the Popcorn hook.
 * Reads, validates, and lists test plan JSON files from the
 * configured test-plans directory.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { TestPlan } from '@popcorn/shared';

/**
 * Loads and validates a test plan JSON file.
 *
 * @param planName - Name of the test plan (without .json extension)
 * @param testPlansDir - Absolute path to the test-plans directory
 * @returns The parsed and validated TestPlan
 * @throws If the file is missing, contains invalid JSON, or lacks required fields
 */
export async function loadTestPlan(
  planName: string,
  testPlansDir: string,
): Promise<TestPlan> {
  const fileName = planName.endsWith('.json') ? planName : `${planName}.json`;
  const filePath = path.resolve(testPlansDir, fileName);

  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error(`Test plan not found: ${filePath}`);
    }
    throw new Error(`Failed to read test plan '${planName}': ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in test plan '${planName}': ${filePath}`);
  }

  return validateTestPlan(parsed, planName);
}

/**
 * Lists all available test plan names in the given directory.
 * Returns plan names without the .json extension.
 *
 * @param testPlansDir - Absolute path to the test-plans directory
 * @returns Array of plan names (without .json extension)
 */
export async function listTestPlans(testPlansDir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(testPlansDir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return [];
    }
    throw new Error(`Failed to list test plans: ${(err as Error).message}`);
  }

  return entries
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
}

/**
 * Validates that a parsed JSON object conforms to the TestPlan interface.
 * Checks for required fields: planName, steps (array), baseUrl.
 */
function validateTestPlan(data: unknown, sourceName: string): TestPlan {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error(
      `Test plan '${sourceName}' must be a JSON object`,
    );
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.planName !== 'string' || obj.planName.length === 0) {
    throw new Error(
      `Test plan '${sourceName}' is missing required field 'planName' (non-empty string)`,
    );
  }

  if (!Array.isArray(obj.steps)) {
    throw new Error(
      `Test plan '${sourceName}' is missing required field 'steps' (array)`,
    );
  }

  if (typeof obj.baseUrl !== 'string') {
    throw new Error(
      `Test plan '${sourceName}' is missing required field 'baseUrl' (string)`,
    );
  }

  return data as TestPlan;
}
