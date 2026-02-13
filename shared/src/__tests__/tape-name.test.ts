import { describe, it, expect } from 'vitest';
import { generateTapeName } from '../tape-name.js';
import type { TestPlan } from '../test-plan.js';

function makePlan(
  overrides: Partial<TestPlan> & { steps: TestPlan['steps'] },
): TestPlan {
  return {
    planName: 'quick-demo',
    ...overrides,
  };
}

describe('generateTapeName', () => {
  it('preserves a descriptive planName', () => {
    const plan = makePlan({
      planName: 'login-flow',
      steps: [
        { stepNumber: 1, action: 'click', description: 'Click login' },
      ],
    });
    expect(generateTapeName(plan)).toBe('login-flow');
  });

  it('generates name for quick-demo plans', () => {
    const plan = makePlan({
      steps: [
        { stepNumber: 1, action: 'click', description: 'Click button' },
        {
          stepNumber: 2,
          action: 'navigate',
          description: 'Navigate to page',
        },
        { stepNumber: 3, action: 'click', description: 'Click another' },
      ],
    });
    expect(generateTapeName(plan)).toBe('Click + Navigate (3 steps)');
  });

  it('handles all-keypress as Keyboard Navigation', () => {
    const plan = makePlan({
      steps: [
        { stepNumber: 1, action: 'keypress', description: 'Press right' },
        { stepNumber: 2, action: 'keypress', description: 'Press right' },
        { stepNumber: 3, action: 'keypress', description: 'Press right' },
      ],
    });
    expect(generateTapeName(plan)).toBe('Keyboard Navigation (3 steps)');
  });

  it('uses Fill Form when fill is dominant', () => {
    const plan = makePlan({
      steps: [
        { stepNumber: 1, action: 'fill', description: 'Fill name' },
        { stepNumber: 2, action: 'fill', description: 'Fill email' },
        { stepNumber: 3, action: 'click', description: 'Submit' },
      ],
    });
    expect(generateTapeName(plan)).toBe('Fill Form (3 steps)');
  });

  it('excludes utility actions from name', () => {
    const plan = makePlan({
      steps: [
        { stepNumber: 1, action: 'click', description: 'Click' },
        { stepNumber: 2, action: 'wait', description: 'Wait' },
        { stepNumber: 3, action: 'screenshot', description: 'Screenshot' },
      ],
    });
    // Only 1 meaningful step (click), wait/screenshot excluded from naming
    expect(generateTapeName(plan)).toBe('Click (1 step)');
  });

  it('falls back to Demo for only-utility plans', () => {
    const plan = makePlan({
      steps: [
        { stepNumber: 1, action: 'wait', description: 'Wait' },
        { stepNumber: 2, action: 'screenshot', description: 'Screenshot' },
      ],
    });
    expect(generateTapeName(plan)).toBe('Demo (2 steps)');
  });

  it('handles singular step count', () => {
    const plan = makePlan({
      steps: [{ stepNumber: 1, action: 'navigate', description: 'Go' }],
    });
    expect(generateTapeName(plan)).toBe('Navigate (1 step)');
  });

  it('limits to top 2 action types', () => {
    const plan = makePlan({
      steps: [
        { stepNumber: 1, action: 'click', description: 'Click 1' },
        { stepNumber: 2, action: 'click', description: 'Click 2' },
        { stepNumber: 3, action: 'fill', description: 'Fill' },
        { stepNumber: 4, action: 'navigate', description: 'Nav' },
        { stepNumber: 5, action: 'assert', description: 'Assert' },
      ],
    });
    // click(2) > fill(1) = navigate(1) = assert(1); top 2 = Click + Fill
    expect(generateTapeName(plan)).toBe('Click + Fill (5 steps)');
  });
});
