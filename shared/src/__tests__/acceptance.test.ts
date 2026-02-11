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
