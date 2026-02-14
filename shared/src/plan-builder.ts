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
  mayNavigate?: boolean;
}

/** A single element to explore in the per-element loop. */
export interface ExplorationTarget {
  selector: string;
  selectorFallback?: string;
  type: 'button' | 'link';
  label: string;
  href?: string;
  mayNavigate: boolean;
}

/**
 * An exploration plan consumed by the background's per-element loop.
 * Unlike TestPlan (a flat step list), this separates form-fill steps
 * from clickable targets. The background dynamically handles
 * screenshots, navigation detection, and recovery for each target.
 */
export interface ExplorationPlan {
  baseUrl: string;
  mode: BuildStepsMode;
  targets: ExplorationTarget[];
  formFillSteps: TestStep[];
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
        action: 'wait',
        description: 'Wait for transition',
        condition: 'timeout',
        timeout: 400,
      } as TestStep);
      steps.push({
        stepNumber: stepNum++,
        action: 'screenshot',
        description: `After clicking ${label}`,
      });
    }

    // Phase 2: Click each link, screenshot, go back via browser history
    for (const link of links) {
      const label = link.label ?? link.selector;
      steps.push({
        stepNumber: stepNum++,
        action: 'click',
        description: `Click ${label}`,
        selector: link.selector,
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
      steps.push({
        stepNumber: stepNum++,
        action: 'go_back',
        description: 'Return via browser back',
      });
      steps.push({
        stepNumber: stepNum++,
        action: 'wait',
        description: 'Wait for page restore',
        condition: 'timeout',
        timeout: 300,
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
      const label = btn.label ?? btn.selector;
      steps.push({
        stepNumber: stepNum++,
        action: 'click',
        description: `Click ${label}`,
        selector: btn.selector,
      });
      steps.push({
        stepNumber: stepNum++,
        action: 'wait',
        description: 'Wait for transition',
        condition: 'timeout',
        timeout: 400,
      } as TestStep);
      steps.push({
        stepNumber: stepNum++,
        action: 'screenshot',
        description: `After clicking ${label}`,
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
      steps.push({
        stepNumber: stepNum++,
        action: 'click',
        description: `Click ${label}`,
        selector: link.selector,
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
      steps.push({
        stepNumber: stepNum++,
        action: 'go_back',
        description: 'Return via browser back',
      });
      steps.push({
        stepNumber: stepNum++,
        action: 'wait',
        description: 'Wait for page restore',
        condition: 'timeout',
        timeout: 300,
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

// -- Regex filters shared between buildSteps and buildExplorationPlan --
const PRIMARY_BUTTON_LABELS =
  /submit|save|send|login|sign.?up|register|continue|next|create|confirm|add|delete|remove|search/i;

const PRIMARY_LINK_LABELS =
  /about|dashboard|settings|profile|home|contact|products|features|pricing|docs|help|faq/i;

/**
 * Builds an ExplorationPlan from detected elements.
 * Unlike buildSteps, this does NOT pre-generate wait/screenshot/go_back steps.
 * The background's per-element loop handles those dynamically based on
 * observed outcomes (URL changes, modals, DOM stability).
 *
 * Modes:
 * - `smart`: primary-intent buttons (cap 3) + primary navigation links (cap 3)
 * - `exhaustive`: all buttons + all internal links
 */
export function buildExplorationPlan(
  elements: DetectedElement[],
  baseUrl: string,
  mode: BuildStepsMode = 'smart',
): ExplorationPlan {
  const normaliseUrl = (u: string) => u.replace(/\/+$/, '').replace(/#$/, '');

  // Build form-fill steps (same as buildSteps)
  const formFillSteps: TestStep[] = [];
  let stepNum = 1;

  const inputs = elements.filter((e) => e.type === 'input' || e.type === 'textarea');
  for (const input of inputs) {
    const fieldName = input.label ?? input.name ?? input.selector;
    const value = getPlaceholderValue(input.name, input.inputType);
    formFillSteps.push({
      stepNumber: stepNum++,
      action: 'fill',
      description: `Fill ${fieldName}`,
      selector: input.selector,
      value,
    });
  }

  const selects = elements.filter((e) => e.type === 'select');
  for (const sel of selects) {
    formFillSteps.push({
      stepNumber: stepNum++,
      action: 'select',
      description: `Select option in ${sel.label ?? sel.name ?? sel.selector}`,
      selector: sel.selector,
      value: '',
    });
  }

  const checkboxes = elements.filter((e) => e.type === 'checkbox');
  for (const cb of checkboxes) {
    formFillSteps.push({
      stepNumber: stepNum++,
      action: 'check',
      description: `Check ${cb.label ?? cb.name ?? cb.selector}`,
      selector: cb.selector,
    });
  }

  // Build exploration targets
  const allButtons = elements.filter((e) => e.type === 'button');
  const allLinks = elements.filter((e) => {
    if (e.type !== 'link' || !e.href) return false;
    const resolved = resolveUrl(e.href, baseUrl);
    return normaliseUrl(resolved) !== normaliseUrl(baseUrl);
  });

  let buttons: DetectedElement[];
  let links: DetectedElement[];

  if (mode === 'exhaustive') {
    buttons = allButtons;
    links = allLinks;
  } else {
    // Smart mode: filter by primary intent, cap at 3 each
    const primaryButtons = allButtons.filter((b) =>
      PRIMARY_BUTTON_LABELS.test(b.label || b.name || ''),
    );
    buttons =
      primaryButtons.length > 0 ? primaryButtons.slice(0, 3) : allButtons.slice(0, 1);

    const primaryLinks = allLinks.filter((l) =>
      PRIMARY_LINK_LABELS.test(l.label || l.name || l.href || ''),
    );
    links =
      primaryLinks.length > 0 ? primaryLinks.slice(0, 3) : allLinks.slice(0, 3);
  }

  const targets: ExplorationTarget[] = [];

  for (const btn of buttons) {
    targets.push({
      selector: btn.selector,
      type: 'button',
      label: btn.label ?? btn.selector,
      mayNavigate: btn.mayNavigate ?? false,
    });
  }

  for (const link of links) {
    targets.push({
      selector: link.selector,
      type: 'link',
      label: link.label ?? link.selector,
      href: link.href,
      mayNavigate: true,
    });
  }

  return {
    baseUrl,
    mode,
    targets,
    formFillSteps,
  };
}
