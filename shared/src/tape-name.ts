import type { TestPlan, ActionType } from './test-plan.js';

/** Actions that are "utility" and not counted as meaningful content actions. */
const UTILITY_ACTIONS: Set<ActionType> = new Set([
  'wait', 'screenshot', 'go_back', 'check_actionability', 'get_page_state',
]);

/** Human-friendly display names for action types. */
const ACTION_LABELS: Record<ActionType, string> = {
  navigate: 'Navigate',
  click: 'Click',
  fill: 'Fill',
  select: 'Select',
  check: 'Check',
  uncheck: 'Uncheck',
  hover: 'Hover',
  scroll: 'Scroll',
  wait: 'Wait',
  assert: 'Assert',
  keypress: 'Keypress',
  drag: 'Drag',
  upload: 'Upload',
  screenshot: 'Screenshot',
  go_back: 'Go Back',
  check_actionability: 'Check Actionability',
  dismiss_modal: 'Dismiss Modal',
  get_page_state: 'Get Page State',
};

/** Plan names that are considered generic and should trigger auto-naming. */
const GENERIC_NAMES = new Set(['quick-demo', '']);

/**
 * Generate a human-readable tape name from a test plan's action content.
 *
 * Examples:
 *  - "Click + Navigate (3 steps)"
 *  - "Fill Form (5 steps)"
 *  - "Keyboard Navigation (4 steps)"
 *
 * If the plan has a descriptive planName (not 'quick-demo' and not empty),
 * it is used as-is.
 */
export function generateTapeName(testPlan: TestPlan): string {
  // If the plan has a meaningful user-provided name, preserve it.
  if (testPlan.planName && !GENERIC_NAMES.has(testPlan.planName)) {
    return testPlan.planName;
  }

  // Count meaningful actions (exclude utility actions).
  const meaningfulSteps = testPlan.steps.filter(
    (s) => !UTILITY_ACTIONS.has(s.action),
  );
  const totalSteps = meaningfulSteps.length || testPlan.steps.length;

  if (meaningfulSteps.length === 0) {
    // Only utility actions — fall back to total count.
    const count = testPlan.steps.length;
    return `Demo (${count} step${count !== 1 ? 's' : ''})`;
  }

  // Tally unique action types, preserving insertion order.
  const actionCounts = new Map<ActionType, number>();
  for (const step of meaningfulSteps) {
    actionCounts.set(step.action, (actionCounts.get(step.action) ?? 0) + 1);
  }

  // Special case: all meaningful actions are keypress.
  if (actionCounts.size === 1 && actionCounts.has('keypress')) {
    return `Keyboard Navigation (${totalSteps} step${totalSteps !== 1 ? 's' : ''})`;
  }

  // Special case: fill is the dominant action (>= 50% of meaningful steps).
  const fillCount = actionCounts.get('fill') ?? 0;
  if (fillCount > 0 && fillCount >= meaningfulSteps.length * 0.5) {
    return `Fill Form (${totalSteps} step${totalSteps !== 1 ? 's' : ''})`;
  }

  // Pick up to 2 most-frequent action types, sorted by count desc.
  const sorted = [...actionCounts.entries()].sort((a, b) => b[1] - a[1]);
  const topActions = sorted.slice(0, 2).map(([action]) => ACTION_LABELS[action]);

  const label = topActions.join(' + ');
  return `${label} (${totalSteps} step${totalSteps !== 1 ? 's' : ''})`;
}
