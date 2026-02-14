/**
 * Pure functions for building test plans from detected interactive elements.
 * Shared between the hook (source code analysis) and extension (live DOM scanning).
 */

import type { TestStep } from './test-plan.js';

/** An interactive element detected in source code or live DOM. */
export interface DetectedElement {
  type: 'form' | 'input' | 'button' | 'link' | 'select' | 'textarea' | 'checkbox';
  selector: string;
  name?: string;
  href?: string;
  inputType?: string;
  label?: string;
}

/** Placeholder values for generated test data, keyed by field name patterns. */
export const PLACEHOLDER_VALUES: Record<string, string> = {
  email: 'test@example.com',
  password: 'Test1234!',
  name: 'Test User',
  username: 'testuser',
  phone: '555-0100',
  search: 'test query',
  url: 'https://example.com',
};

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
 * Resolves a potentially relative URL against a base URL.
 * E.g., resolveUrl('/about', 'http://localhost:8080/') => 'http://localhost:8080/about'
 */
export function resolveUrl(href: string, baseUrl: string): string {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return href;
  }
}

/** Build mode: 'smart' filters to primary buttons; 'exhaustive' tests every clickable. */
export type BuildStepsMode = 'smart' | 'exhaustive';

/**
 * Converts detected elements into an ordered list of TestSteps.
 *
 * Modes:
 * - `smart` (default): fill inputs, click primary-intent buttons (cap 3), screenshot
 * - `exhaustive`: for each button/link → click, screenshot, navigate back, wait
 */
export function buildSteps(
  elements: DetectedElement[],
  baseUrl: string,
  mode: BuildStepsMode = 'smart',
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
    const fieldName = input.label ?? input.name ?? input.selector;
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
      description: `Select option in ${sel.label ?? sel.name ?? sel.selector}`,
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
      description: `Check ${cb.label ?? cb.name ?? cb.selector}`,
      selector: cb.selector,
    });
  }

  // Helper to compare URLs ignoring trailing slashes and lone hashes
  const normaliseUrl = (u: string) => u.replace(/\/+$/, '').replace(/#$/, '');

  if (mode === 'exhaustive') {
    const buttons = elements.filter((e) => e.type === 'button');
    const links = elements.filter((e) => {
      if (e.type !== 'link' || !e.href) return false;
      const resolved = resolveUrl(e.href, baseUrl);
      return normaliseUrl(resolved) !== normaliseUrl(baseUrl);
    });

    // Phase 1: Click each button, screenshot
    // No navigate-back between buttons — most button clicks stay on the same page.
    // A single navigate-back after all buttons ensures we're at baseUrl for the link phase.
    for (const btn of buttons) {
      const label = btn.label ?? btn.selector;
      steps.push({
        stepNumber: stepNum++,
        action: 'click',
        description: `Click ${label}`,
        selector: btn.selector,
      });
      steps.push({
        stepNumber: stepNum++,
        action: 'screenshot',
        description: `After clicking ${label}`,
      });
    }

    // Return to base after buttons (in case any button navigated away)
    if (buttons.length > 0) {
      steps.push({
        stepNumber: stepNum++,
        action: 'navigate',
        description: 'Return to page',
        target: baseUrl,
      });
      steps.push({
        stepNumber: stepNum++,
        action: 'wait',
        description: 'Wait for page load',
        condition: 'timeout',
        timeout: 500,
      } as TestStep);
    }

    // Phase 2: Navigate to each link destination, screenshot
    for (const link of links) {
      const label = link.label ?? link.selector;
      const resolvedHref = resolveUrl(link.href!, baseUrl);
      steps.push({
        stepNumber: stepNum++,
        action: 'navigate',
        description: `Navigate to ${label}`,
        target: resolvedHref,
      });
      steps.push({
        stepNumber: stepNum++,
        action: 'wait',
        description: 'Wait for page load',
        condition: 'timeout',
        timeout: 500,
      } as TestStep);
      steps.push({
        stepNumber: stepNum++,
        action: 'screenshot',
        description: `${label} destination`,
      });
    }

    // Navigate back after visiting links
    if (links.length > 0) {
      steps.push({
        stepNumber: stepNum++,
        action: 'navigate',
        description: 'Return to page',
        target: baseUrl,
      });
      steps.push({
        stepNumber: stepNum++,
        action: 'wait',
        description: 'Wait for page load',
        condition: 'timeout',
        timeout: 500,
      } as TestStep);
    }
  } else {
    // Smart: filter by primary intent, cap at 3
    const buttons = elements.filter((e) => e.type === 'button');
    const PRIMARY_LABELS =
      /submit|save|send|login|sign.?up|register|continue|next|create|confirm|add|delete|remove|search/i;
    const primaryButtons = buttons.filter((b) =>
      PRIMARY_LABELS.test(b.label || b.name || ''),
    );
    const toClick =
      primaryButtons.length > 0 ? primaryButtons.slice(0, 3) : buttons.slice(0, 1);
    for (const btn of toClick) {
      steps.push({
        stepNumber: stepNum++,
        action: 'click',
        description: `Click ${btn.label ?? btn.selector}`,
        selector: btn.selector,
      });
    }

    // Follow a few key navigation links (cap at 3)
    const links = elements.filter((e) => {
      if (e.type !== 'link' || !e.href) return false;
      const resolved = resolveUrl(e.href, baseUrl);
      return normaliseUrl(resolved) !== normaliseUrl(baseUrl);
    });
    const PRIMARY_LINK_LABELS =
      /about|dashboard|settings|profile|home|contact|products|features|pricing|docs|help|faq/i;
    const primaryLinks = links.filter((l) =>
      PRIMARY_LINK_LABELS.test(l.label || l.name || l.href || ''),
    );
    const linksToFollow =
      primaryLinks.length > 0 ? primaryLinks.slice(0, 3) : links.slice(0, 3);

    for (const link of linksToFollow) {
      const label = link.label ?? link.selector;
      const resolvedHref = resolveUrl(link.href!, baseUrl);
      steps.push({
        stepNumber: stepNum++,
        action: 'navigate',
        description: `Navigate to ${label}`,
        target: resolvedHref,
      });
      steps.push({
        stepNumber: stepNum++,
        action: 'wait',
        description: 'Wait for page load',
        condition: 'timeout',
        timeout: 500,
      } as TestStep);
      steps.push({
        stepNumber: stepNum++,
        action: 'screenshot',
        description: `${label} page`,
      });
    }

    // Navigate back after following links
    if (linksToFollow.length > 0) {
      steps.push({
        stepNumber: stepNum++,
        action: 'navigate',
        description: 'Return to page',
        target: baseUrl,
      });
      steps.push({
        stepNumber: stepNum++,
        action: 'wait',
        description: 'Wait for page load',
        condition: 'timeout',
        timeout: 500,
      } as TestStep);
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
  }

  // Always end with screenshot
  steps.push({
    stepNumber: stepNum++,
    action: 'screenshot',
    description: 'Capture final state',
  });

  return steps;
}
