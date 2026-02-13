/**
 * Template-based test plan generator for Popcorn.
 *
 * When no matching test plan exists for a changed file, this module
 * scans the source code for JSX/HTML patterns (forms, inputs, buttons, etc.)
 * and generates a reasonable test plan automatically.
 *
 * Uses regex heuristics — not a full parser. Designed for zero-config
 * operation (no API key, no external dependencies, instant execution).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { TestPlan, TestStep } from '@popcorn/shared';
import { analyzeComponentContext } from './import-graph.js';

/** An interactive element detected in source code. */
export interface DetectedElement {
  type: 'form' | 'input' | 'button' | 'link' | 'select' | 'textarea' | 'checkbox';
  selector: string;
  name?: string;
  href?: string;
  inputType?: string;
}

/** Placeholder values for generated test data, keyed by field name patterns. */
const PLACEHOLDER_VALUES: Record<string, string> = {
  email: 'test@example.com',
  password: 'Test1234!',
  name: 'Test User',
  username: 'testuser',
  phone: '555-0100',
  search: 'test query',
  url: 'https://example.com',
};

/**
 * Generates a test plan from a source file by analyzing its JSX/HTML patterns.
 * For interactive components, generates interaction steps (fill, click, etc.).
 * For display-only components, generates a visual-check plan (screenshot capture).
 */
export async function generatePlanFromFile(
  filePath: string,
  options?: { baseUrl?: string; projectRoot?: string },
): Promise<TestPlan | null> {
  const content = await fs.readFile(filePath, 'utf-8');
  const elements = detectElements(content);

  const baseName = path.basename(filePath, path.extname(filePath));
  const planName = toKebabCase(baseName);
  const baseUrl = options?.baseUrl ?? '/';

  // No interactive elements — generate a visual-check plan
  if (elements.length === 0) {
    return buildVisualCheckPlan(filePath, planName, baseName, baseUrl, options?.projectRoot);
  }

  const steps = buildSteps(elements, baseUrl);

  if (steps.length <= 1) {
    // Only a navigate step — fall back to visual-check
    return buildVisualCheckPlan(filePath, planName, baseName, baseUrl, options?.projectRoot);
  }

  return {
    planName,
    description: `Auto-generated test plan for ${baseName}`,
    baseUrl,
    steps,
    tags: ['auto-generated'],
  };
}

/**
 * Builds a visual-check plan, optionally enriched with navigation steps
 * from static import graph analysis when projectRoot is provided.
 */
async function buildVisualCheckPlan(
  filePath: string,
  planName: string,
  baseName: string,
  baseUrl: string,
  projectRoot?: string,
): Promise<TestPlan> {
  const steps: TestStep[] = [];
  let tags = ['auto-generated', 'visual-check'];
  let stepNum = 1;

  // Try static import graph analysis for navigation context
  if (projectRoot) {
    const ctx = await analyzeComponentContext(filePath, projectRoot, baseUrl);
    if (ctx && ctx.navigationSteps.length > 0) {
      // Add navigate to baseUrl first
      steps.push({
        stepNumber: stepNum++,
        action: 'navigate',
        description: 'Open app',
        target: baseUrl,
      });
      steps.push({
        stepNumber: stepNum++,
        action: 'wait',
        description: 'Wait for page load',
        condition: 'timeout',
        timeout: 500,
      });

      // Add navigation steps from import graph analysis
      for (const navStep of ctx.navigationSteps) {
        steps.push({ ...navStep, stepNumber: stepNum++ });
      }
      steps.push({
        stepNumber: stepNum++,
        action: 'wait',
        description: 'Wait for transition',
        condition: 'timeout',
        timeout: 500,
      });

      tags = [...tags, 'navigated'];
    }
  }

  // If no navigation steps were added, use simple wait
  if (steps.length === 0) {
    steps.push({
      stepNumber: stepNum++,
      action: 'wait',
      description: 'Wait for page to render',
      condition: 'timeout',
      timeout: 1000,
    });
  }

  // Always end with screenshot
  steps.push({
    stepNumber: stepNum++,
    action: 'screenshot',
    description: `Capture visual state of ${baseName}`,
  });

  return {
    planName,
    description: `Visual check for ${baseName}`,
    baseUrl,
    steps,
    tags,
  };
}

/**
 * Saves a generated test plan to the test-plans directory.
 * Returns the file path where the plan was saved.
 */
export async function savePlan(
  plan: TestPlan,
  testPlansDir: string,
): Promise<string> {
  await fs.mkdir(testPlansDir, { recursive: true });
  const fileName = `${plan.planName}.json`;
  const filePath = path.resolve(testPlansDir, fileName);
  await fs.writeFile(filePath, JSON.stringify(plan, null, 2) + '\n');
  return filePath;
}

/**
 * Scans source code for JSX/HTML patterns that indicate interactive elements.
 * Uses regex-based heuristics — not a full parser.
 */
export function detectElements(content: string): DetectedElement[] {
  const elements: DetectedElement[] = [];

  // Detect <form> elements
  if (/<form[\s>]/i.test(content)) {
    elements.push({ type: 'form', selector: 'form' });
  }

  // Detect <input> elements with name or id attributes
  const inputRegex = /<input\b([^>]*?)(?:\/>|>)/gi;
  let match: RegExpExecArray | null;
  while ((match = inputRegex.exec(content)) !== null) {
    const attrs = match[1];
    const name = extractAttr(attrs, 'name');
    const id = extractAttr(attrs, 'id');
    const type = extractAttr(attrs, 'type') ?? 'text';

    if (type === 'hidden') continue;

    if (type === 'checkbox' || type === 'radio') {
      const selector = id ? `#${id}` : name ? `input[name="${name}"]` : null;
      if (selector) {
        elements.push({ type: 'checkbox', selector, name: name ?? undefined, inputType: type });
      }
    } else if (type === 'submit') {
      const selector = id ? `#${id}` : 'input[type="submit"]';
      elements.push({ type: 'button', selector, name: name ?? undefined });
    } else {
      const selector = id ? `#${id}` : name ? `input[name="${name}"]` : null;
      if (selector) {
        elements.push({ type: 'input', selector, name: name ?? undefined, inputType: type });
      }
    }
  }

  // Detect <textarea> elements
  const textareaRegex = /<textarea\b([^>]*?)>/gi;
  while ((match = textareaRegex.exec(content)) !== null) {
    const attrs = match[1];
    const name = extractAttr(attrs, 'name');
    const id = extractAttr(attrs, 'id');
    const selector = id ? `#${id}` : name ? `textarea[name="${name}"]` : 'textarea';
    elements.push({ type: 'textarea', selector, name: name ?? undefined });
  }

  // Detect <select> elements
  const selectRegex = /<select\b([^>]*?)>/gi;
  while ((match = selectRegex.exec(content)) !== null) {
    const attrs = match[1];
    const name = extractAttr(attrs, 'name');
    const id = extractAttr(attrs, 'id');
    const selector = id ? `#${id}` : name ? `select[name="${name}"]` : 'select';
    elements.push({ type: 'select', selector, name: name ?? undefined });
  }

  // Detect <button> elements
  const buttonRegex = /<button\b([^>]*?)>/gi;
  while ((match = buttonRegex.exec(content)) !== null) {
    const attrs = match[1];
    const id = extractAttr(attrs, 'id');
    const type = extractAttr(attrs, 'type');
    const selector = id
      ? `#${id}`
      : type === 'submit'
        ? 'button[type="submit"]'
        : 'button';
    elements.push({ type: 'button', selector });
  }

  // Detect <a href="..."> links with navigation targets
  const linkRegex = /<a\b([^>]*?)>/gi;
  while ((match = linkRegex.exec(content)) !== null) {
    const attrs = match[1];
    const href = extractAttr(attrs, 'href');
    const id = extractAttr(attrs, 'id');
    if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
      const selector = id ? `#${id}` : `a[href="${href}"]`;
      elements.push({ type: 'link', selector, href: href ?? undefined });
    }
  }

  return elements;
}

/**
 * Extracts an HTML attribute value from an attribute string.
 * Handles single quotes, double quotes, and JSX curly brace expressions.
 */
export function extractAttr(attrString: string, attrName: string): string | null {
  const regex = new RegExp(
    `${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|\\{["\`']([^"'\`]*)["\`']\\})`,
    'i',
  );
  const m = regex.exec(attrString);
  return m ? (m[1] ?? m[2] ?? m[3] ?? null) : null;
}

/**
 * Selects an appropriate placeholder value based on the field name or input type.
 */
export function getPlaceholderValue(name?: string, inputType?: string): string {
  if (name) {
    const lower = name.toLowerCase();
    for (const [key, value] of Object.entries(PLACEHOLDER_VALUES)) {
      if (lower.includes(key)) return value;
    }
  }
  if (inputType === 'email') return PLACEHOLDER_VALUES.email;
  if (inputType === 'password') return PLACEHOLDER_VALUES.password;
  if (inputType === 'tel') return PLACEHOLDER_VALUES.phone;
  if (inputType === 'url') return PLACEHOLDER_VALUES.url;
  return 'test value';
}

/**
 * Converts detected elements into an ordered list of TestSteps.
 * Strategy: navigate first, fill inputs, select options, click buttons, assert.
 */
export function buildSteps(
  elements: DetectedElement[],
  baseUrl: string,
): TestStep[] {
  const steps: TestStep[] = [];
  let stepNum = 1;

  // Step 1: Navigate to page
  steps.push({
    stepNumber: stepNum++,
    action: 'navigate',
    description: 'Navigate to page',
    target: baseUrl,
  });

  // Fill inputs and textareas
  const inputs = elements.filter((e) => e.type === 'input' || e.type === 'textarea');
  for (const input of inputs) {
    const fieldName = input.name ?? input.selector;
    const value = getPlaceholderValue(input.name, input.inputType);
    steps.push({
      stepNumber: stepNum++,
      action: 'fill',
      description: `Fill ${fieldName}`,
      selector: input.selector,
      value,
    });
  }

  // Select dropdowns
  const selects = elements.filter((e) => e.type === 'select');
  for (const sel of selects) {
    steps.push({
      stepNumber: stepNum++,
      action: 'select',
      description: `Select option in ${sel.name ?? sel.selector}`,
      selector: sel.selector,
      value: '',
    });
  }

  // Check checkboxes
  const checkboxes = elements.filter((e) => e.type === 'checkbox');
  for (const cb of checkboxes) {
    steps.push({
      stepNumber: stepNum++,
      action: 'check',
      description: `Check ${cb.name ?? cb.selector}`,
      selector: cb.selector,
    });
  }

  // Click buttons
  const buttons = elements.filter((e) => e.type === 'button');
  for (const btn of buttons) {
    steps.push({
      stepNumber: stepNum++,
      action: 'click',
      description: `Click ${btn.selector}`,
      selector: btn.selector,
    });
  }

  // Add basic assertion if there's a form
  const hasForm = elements.some((e) => e.type === 'form');
  if (hasForm) {
    steps.push({
      stepNumber: stepNum++,
      action: 'assert',
      description: 'Verify page after form submission',
      assertionType: 'visible',
      selector: 'body',
    });
  }

  return steps;
}

function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}
