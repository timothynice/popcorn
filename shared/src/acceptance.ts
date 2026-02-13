import type { StepResult, CriterionResult } from './results.js';

export interface AcceptanceCriterion {
  id: string;
  description: string;
  type: 'visual' | 'functional' | 'performance' | 'accessibility';
  evaluate: (stepResults: StepResult[]) => CriterionResult;
}

export interface AcceptancePreset {
  name: string;
  description: string;
  criteria: AcceptanceCriterion[];
}

export function allStepsPassed(): AcceptanceCriterion {
  return {
    id: 'all-steps-passed',
    description: 'All test steps completed successfully',
    type: 'functional',
    evaluate(stepResults) {
      const failed = stepResults.filter((s) => !s.passed);
      return {
        criterionId: 'all-steps-passed',
        passed: failed.length === 0,
        message:
          failed.length === 0
            ? 'All steps passed'
            : `${failed.length} step(s) failed: ${failed.map((s) => `step ${s.stepNumber}`).join(', ')}`,
        evidence: failed.length > 0 ? `Failed steps: ${failed.map((s) => s.stepNumber).join(', ')}` : undefined,
      };
    },
  };
}

export function noStepErrors(): AcceptanceCriterion {
  return {
    id: 'no-step-errors',
    description: 'No steps produced errors',
    type: 'functional',
    evaluate(stepResults) {
      const errored = stepResults.filter((s) => s.error);
      return {
        criterionId: 'no-step-errors',
        passed: errored.length === 0,
        message:
          errored.length === 0
            ? 'No errors encountered'
            : `${errored.length} step(s) had errors`,
        evidence: errored.length > 0 ? errored.map((s) => `Step ${s.stepNumber}: ${s.error}`).join('; ') : undefined,
      };
    },
  };
}

export function completedWithinDuration(maxMs: number): AcceptanceCriterion {
  return {
    id: `completed-within-${maxMs}ms`,
    description: `All steps completed within ${maxMs}ms total`,
    type: 'performance',
    evaluate(stepResults) {
      const totalDuration = stepResults.reduce((sum, s) => sum + s.duration, 0);
      return {
        criterionId: `completed-within-${maxMs}ms`,
        passed: totalDuration <= maxMs,
        message:
          totalDuration <= maxMs
            ? `Completed in ${totalDuration}ms (within ${maxMs}ms limit)`
            : `Took ${totalDuration}ms (exceeded ${maxMs}ms limit)`,
      };
    },
  };
}

/**
 * A pattern definition that maps a regex against criterion text to a
 * specific evaluator factory.  Patterns are checked in priority order;
 * the first match wins.
 */
interface CriterionPattern {
  /** Regex tested against the criterion line (case-insensitive). */
  regex: RegExp;
  /** Build the appropriate evaluator from the regex match. */
  build: (match: RegExpMatchArray, line: string, index: number) => AcceptanceCriterion;
}

const CRITERION_PATTERNS: CriterionPattern[] = [
  // ── Duration / performance ───────────────────────────────────────────
  // "within 500ms", "under 2 seconds", "completes in 1s"
  {
    regex: /(?:within|under|in|less than)\s+(\d+(?:\.\d+)?)\s*(ms|milliseconds?|seconds?|sec|s)\b/i,
    build(match, line, i) {
      const value = parseFloat(match[1]);
      const unit = match[2].toLowerCase();
      const ms = unit.startsWith('ms') || unit.startsWith('millis') ? value : value * 1000;
      return {
        ...completedWithinDuration(ms),
        id: `custom-${i}`,
        description: line,
      };
    },
  },

  // ── URL redirect / navigation ────────────────────────────────────────
  // "redirects to /dashboard", "navigates to /home", "URL contains /settings"
  {
    regex: /(?:redirects?\s+to|navigates?\s+to|url\s+(?:contains?|includes?))\s+(\S+)/i,
    build(match, line, i) {
      const expectedPath = match[1];
      return {
        id: `custom-${i}`,
        description: line,
        type: 'functional' as const,
        evaluate(stepResults: StepResult[]) {
          // Search step metadata in reverse for the latest URL info
          for (let j = stepResults.length - 1; j >= 0; j--) {
            const meta = stepResults[j].metadata;
            if (meta) {
              const finalUrl = (meta.finalUrl as string) ?? (meta.actualUrl as string);
              if (finalUrl && finalUrl.includes(expectedPath)) {
                return {
                  criterionId: `custom-${i}`,
                  passed: true,
                  message: `Redirected to ${finalUrl} (contains "${expectedPath}")`,
                };
              }
            }
          }
          return {
            criterionId: `custom-${i}`,
            passed: false,
            message: `Expected redirect to "${expectedPath}" not found in step metadata`,
          };
        },
      };
    },
  },

  // ── Error message display ────────────────────────────────────────────
  // "shows error message", "displays error", "error is shown"
  {
    regex: /(?:shows?|displays?|renders?|presents?)\s+(?:an?\s+)?error/i,
    build(_match, line, i) {
      return {
        id: `custom-${i}`,
        description: line,
        type: 'functional' as const,
        evaluate(stepResults: StepResult[]) {
          // Look for assert steps that checked for error-related content
          const hasErrorCheck = stepResults.some((s) => {
            if (s.action === 'assert' && s.passed) {
              const meta = s.metadata;
              if (meta) {
                const text = ((meta.actualText as string) ?? '').toLowerCase();
                return text.includes('error') || text.includes('invalid') || text.includes('fail');
              }
            }
            return false;
          });

          // Also pass if any step has error-related metadata that was asserted
          if (hasErrorCheck) {
            return {
              criterionId: `custom-${i}`,
              passed: true,
              message: 'Error message found in assertion results',
            };
          }

          // Fallback: any step error text suggests an error was encountered
          const hasStepError = stepResults.some((s) => s.error);
          return {
            criterionId: `custom-${i}`,
            passed: hasStepError,
            message: hasStepError
              ? 'Error condition detected in step results'
              : 'No error message found in assertions or step results',
          };
        },
      };
    },
  },

  // ── Form submission success ──────────────────────────────────────────
  // "form submits successfully", "form submission works"
  {
    regex: /form\s+(?:submits?|submission)\s+(?:successfully|works|completes)/i,
    build(_match, line, i) {
      return {
        id: `custom-${i}`,
        description: line,
        type: 'functional' as const,
        evaluate(stepResults: StepResult[]) {
          // Check that all form-related steps (fill, select, check, click) passed
          const formActions = ['fill', 'select', 'check', 'click'];
          const formSteps = stepResults.filter((s) => formActions.includes(s.action));
          const allFormPassed = formSteps.length > 0 && formSteps.every((s) => s.passed);
          const noErrors = formSteps.every((s) => !s.error);

          return {
            criterionId: `custom-${i}`,
            passed: allFormPassed && noErrors,
            message: allFormPassed && noErrors
              ? `All ${formSteps.length} form steps passed without errors`
              : `Form submission check failed (${formSteps.filter((s) => !s.passed).length} step(s) failed)`,
          };
        },
      };
    },
  },

  // ── No errors ────────────────────────────────────────────────────────
  // "no errors", "no error", "zero errors"
  {
    regex: /\b(?:no|zero)\s+errors?\b/i,
    build(_match, line, i) {
      return {
        ...noStepErrors(),
        id: `custom-${i}`,
        description: line,
      };
    },
  },

  // ── All steps pass ───────────────────────────────────────────────────
  // "all steps pass", "all steps succeed", "every step passes"
  {
    regex: /\b(?:all|every)\s+steps?\s+(?:pass|succeed|complete)/i,
    build(_match, line, i) {
      return {
        ...allStepsPassed(),
        id: `custom-${i}`,
        description: line,
      };
    },
  },

  // ── Text content visible ─────────────────────────────────────────────
  // "shows welcome message", "displays 'Success'", "text contains login"
  {
    regex: /(?:shows?|displays?|contains?|includes?)\s+(?:(?:the\s+)?(?:text|message)\s+)?['"]([^'"]+)['"]/i,
    build(match, line, i) {
      const expectedText = match[1];
      return {
        id: `custom-${i}`,
        description: line,
        type: 'functional' as const,
        evaluate(stepResults: StepResult[]) {
          for (const s of stepResults) {
            const meta = s.metadata;
            if (meta) {
              const actual = (meta.actualText as string) ?? '';
              if (actual.includes(expectedText)) {
                return {
                  criterionId: `custom-${i}`,
                  passed: true,
                  message: `Found text "${expectedText}" in step ${s.stepNumber}`,
                };
              }
            }
          }
          return {
            criterionId: `custom-${i}`,
            passed: false,
            message: `Expected text "${expectedText}" not found in any step metadata`,
          };
        },
      };
    },
  },
];

export function parsePlainTextCriteria(text: string): AcceptanceCriterion[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, i) => {
      // Try each pattern in priority order
      for (const pattern of CRITERION_PATTERNS) {
        const match = line.match(pattern.regex);
        if (match) {
          return pattern.build(match, line, i);
        }
      }

      // Fallback: unrecognized criteria use allStepsPassed (backward compatible)
      return {
        id: `custom-${i}`,
        description: line,
        type: 'functional' as const,
        evaluate(stepResults: StepResult[]) {
          const allPassed = stepResults.every((s) => s.passed);
          return {
            criterionId: `custom-${i}`,
            passed: allPassed,
            message: allPassed ? `Criterion met: ${line}` : `Criterion may not be met: ${line}`,
          };
        },
      };
    });
}

export function evaluateAllCriteria(
  stepResults: StepResult[],
  criteria: AcceptanceCriterion[],
): { passed: boolean; results: CriterionResult[] } {
  const results = criteria.map((c) => c.evaluate(stepResults));
  return {
    passed: results.every((r) => r.passed),
    results,
  };
}
