import { describe, it, expect } from 'vitest';
import type { StepResult } from '../results.js';
import {
  allStepsPassed,
  noStepErrors,
  completedWithinDuration,
  parsePlainTextCriteria,
  evaluateAllCriteria,
} from '../acceptance.js';

const passingStep: StepResult = {
  stepNumber: 1,
  action: 'click',
  description: 'Click button',
  passed: true,
  duration: 50,
  timestamp: Date.now(),
};

const failingStep: StepResult = {
  stepNumber: 2,
  action: 'assert',
  description: 'Assert visible',
  passed: false,
  duration: 100,
  error: 'Element not found',
  timestamp: Date.now(),
};

describe('allStepsPassed', () => {
  it('passes when all steps pass', () => {
    const criterion = allStepsPassed();
    const result = criterion.evaluate([passingStep]);
    expect(result.passed).toBe(true);
    expect(result.criterionId).toBe('all-steps-passed');
  });

  it('fails when any step fails', () => {
    const criterion = allStepsPassed();
    const result = criterion.evaluate([passingStep, failingStep]);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('1 step(s) failed');
  });
});

describe('noStepErrors', () => {
  it('passes when no errors', () => {
    const result = noStepErrors().evaluate([passingStep]);
    expect(result.passed).toBe(true);
  });

  it('fails when errors exist', () => {
    const result = noStepErrors().evaluate([failingStep]);
    expect(result.passed).toBe(false);
    expect(result.evidence).toContain('Element not found');
  });
});

describe('completedWithinDuration', () => {
  it('passes within limit', () => {
    const result = completedWithinDuration(200).evaluate([passingStep]);
    expect(result.passed).toBe(true);
  });

  it('fails when exceeding limit', () => {
    const result = completedWithinDuration(10).evaluate([passingStep, failingStep]);
    expect(result.passed).toBe(false);
  });
});

describe('parsePlainTextCriteria', () => {
  it('parses multiline text into criteria', () => {
    const criteria = parsePlainTextCriteria('Page loads\nForm submits\nRedirect works');
    expect(criteria).toHaveLength(3);
    expect(criteria[0].description).toBe('Page loads');
    expect(criteria[0].id).toBe('custom-0');
    expect(criteria[0].type).toBe('functional');
  });

  it('skips empty lines', () => {
    const criteria = parsePlainTextCriteria('Line 1\n\n\nLine 2');
    expect(criteria).toHaveLength(2);
  });

  it('falls back to allStepsPassed for unrecognized criteria', () => {
    const criteria = parsePlainTextCriteria('Something custom happens');
    expect(criteria).toHaveLength(1);
    const result = criteria[0].evaluate([passingStep]);
    expect(result.passed).toBe(true);
    expect(result.message).toContain('Criterion met');
  });

  it('fallback fails when a step fails', () => {
    const criteria = parsePlainTextCriteria('Something custom happens');
    const result = criteria[0].evaluate([passingStep, failingStep]);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('Criterion may not be met');
  });

  // ── Duration pattern ──────────────────────────────────────────────────
  it('parses "within 500ms" as a duration criterion', () => {
    const criteria = parsePlainTextCriteria('completes within 500ms');
    expect(criteria).toHaveLength(1);
    // 50ms total duration should pass
    const result = criteria[0].evaluate([passingStep]);
    expect(result.passed).toBe(true);
    expect(result.message).toContain('within 500ms');
  });

  it('parses "under 2 seconds" as a duration criterion', () => {
    const criteria = parsePlainTextCriteria('under 2 seconds');
    const result = criteria[0].evaluate([passingStep]); // 50ms
    expect(result.passed).toBe(true);
  });

  it('duration criterion fails when exceeded', () => {
    const criteria = parsePlainTextCriteria('within 10ms');
    const result = criteria[0].evaluate([passingStep, failingStep]); // 150ms total
    expect(result.passed).toBe(false);
  });

  // ── URL redirect pattern ──────────────────────────────────────────────
  it('parses "redirects to /dashboard" as a URL criterion', () => {
    const criteria = parsePlainTextCriteria('redirects to /dashboard');
    const stepWithMeta: StepResult = {
      ...passingStep,
      action: 'navigate',
      metadata: { targetUrl: '/', finalUrl: 'http://localhost/dashboard' },
    };
    const result = criteria[0].evaluate([stepWithMeta]);
    expect(result.passed).toBe(true);
    expect(result.message).toContain('/dashboard');
  });

  it('URL redirect criterion fails when path not found', () => {
    const criteria = parsePlainTextCriteria('redirects to /admin');
    const stepWithMeta: StepResult = {
      ...passingStep,
      action: 'navigate',
      metadata: { targetUrl: '/', finalUrl: 'http://localhost/home' },
    };
    const result = criteria[0].evaluate([stepWithMeta]);
    expect(result.passed).toBe(false);
  });

  it('URL redirect checks metadata in reverse (latest first)', () => {
    const criteria = parsePlainTextCriteria('navigates to /final');
    const steps: StepResult[] = [
      { ...passingStep, metadata: { finalUrl: 'http://localhost/first' } },
      { ...passingStep, stepNumber: 2, metadata: { finalUrl: 'http://localhost/final' } },
    ];
    const result = criteria[0].evaluate(steps);
    expect(result.passed).toBe(true);
  });

  it('URL redirect also checks actualUrl in metadata', () => {
    const criteria = parsePlainTextCriteria('URL contains /settings');
    const stepWithMeta: StepResult = {
      ...passingStep,
      action: 'assert',
      metadata: { assertionType: 'url', actualUrl: 'http://localhost/settings/profile' },
    };
    const result = criteria[0].evaluate([stepWithMeta]);
    expect(result.passed).toBe(true);
  });

  // ── Error display pattern ─────────────────────────────────────────────
  it('parses "shows error message" as an error display criterion', () => {
    const criteria = parsePlainTextCriteria('shows error message');
    const assertStep: StepResult = {
      ...passingStep,
      action: 'assert',
      metadata: { assertionType: 'text', actualText: 'Invalid email error' },
    };
    const result = criteria[0].evaluate([assertStep]);
    expect(result.passed).toBe(true);
  });

  it('error display criterion fails when no error text found', () => {
    const criteria = parsePlainTextCriteria('displays an error');
    const assertStep: StepResult = {
      ...passingStep,
      action: 'assert',
      metadata: { assertionType: 'text', actualText: 'Welcome back!' },
    };
    const result = criteria[0].evaluate([assertStep]);
    expect(result.passed).toBe(false);
  });

  // ── Form submission pattern ───────────────────────────────────────────
  it('parses "form submits successfully" as a form criterion', () => {
    const criteria = parsePlainTextCriteria('form submits successfully');
    const formSteps: StepResult[] = [
      { ...passingStep, action: 'fill' },
      { ...passingStep, stepNumber: 2, action: 'click' },
    ];
    const result = criteria[0].evaluate(formSteps);
    expect(result.passed).toBe(true);
    expect(result.message).toContain('2 form steps passed');
  });

  it('form submission criterion fails when a form step fails', () => {
    const criteria = parsePlainTextCriteria('form submission works');
    const formSteps: StepResult[] = [
      { ...passingStep, action: 'fill' },
      { ...failingStep, action: 'click' },
    ];
    const result = criteria[0].evaluate(formSteps);
    expect(result.passed).toBe(false);
  });

  // ── No errors pattern ─────────────────────────────────────────────────
  it('parses "no errors" as a noStepErrors criterion', () => {
    const criteria = parsePlainTextCriteria('no errors');
    const result = criteria[0].evaluate([passingStep]);
    expect(result.passed).toBe(true);
  });

  it('"no errors" fails when errors exist', () => {
    const criteria = parsePlainTextCriteria('no errors');
    const result = criteria[0].evaluate([failingStep]);
    expect(result.passed).toBe(false);
  });

  // ── All steps pass pattern ────────────────────────────────────────────
  it('parses "all steps pass" as allStepsPassed criterion', () => {
    const criteria = parsePlainTextCriteria('all steps pass');
    const result = criteria[0].evaluate([passingStep]);
    expect(result.passed).toBe(true);
  });

  // ── Text content pattern ──────────────────────────────────────────────
  it('parses shows "Success" as a text content criterion', () => {
    const criteria = parsePlainTextCriteria('shows "Success"');
    const stepWithText: StepResult = {
      ...passingStep,
      action: 'assert',
      metadata: { assertionType: 'text', actualText: 'Operation Success!' },
    };
    const result = criteria[0].evaluate([stepWithText]);
    expect(result.passed).toBe(true);
    expect(result.message).toContain('Found text "Success"');
  });

  it('text content criterion fails when text not found', () => {
    const criteria = parsePlainTextCriteria('displays "Welcome"');
    const stepWithText: StepResult = {
      ...passingStep,
      metadata: { actualText: 'Goodbye' },
    };
    const result = criteria[0].evaluate([stepWithText]);
    expect(result.passed).toBe(false);
  });

  // ── Mixed criteria in one block ───────────────────────────────────────
  it('handles mixed recognized and unrecognized criteria', () => {
    const text = 'redirects to /dashboard\nwithin 500ms\nsomething custom';
    const criteria = parsePlainTextCriteria(text);
    expect(criteria).toHaveLength(3);
    // Each should have unique id
    expect(criteria[0].id).toBe('custom-0');
    expect(criteria[1].id).toBe('custom-1');
    expect(criteria[2].id).toBe('custom-2');
  });
});

describe('evaluateAllCriteria', () => {
  it('returns passed true when all criteria pass', () => {
    const result = evaluateAllCriteria([passingStep], [allStepsPassed(), noStepErrors()]);
    expect(result.passed).toBe(true);
    expect(result.results).toHaveLength(2);
  });

  it('returns passed false when any criterion fails', () => {
    const result = evaluateAllCriteria([failingStep], [allStepsPassed(), noStepErrors()]);
    expect(result.passed).toBe(false);
  });
});
