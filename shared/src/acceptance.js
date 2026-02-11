export function allStepsPassed() {
    return {
        id: 'all-steps-passed',
        description: 'All test steps completed successfully',
        type: 'functional',
        evaluate(stepResults) {
            const failed = stepResults.filter((s) => !s.passed);
            return {
                criterionId: 'all-steps-passed',
                passed: failed.length === 0,
                message: failed.length === 0
                    ? 'All steps passed'
                    : `${failed.length} step(s) failed: ${failed.map((s) => `step ${s.stepNumber}`).join(', ')}`,
                evidence: failed.length > 0 ? `Failed steps: ${failed.map((s) => s.stepNumber).join(', ')}` : undefined,
            };
        },
    };
}
export function noStepErrors() {
    return {
        id: 'no-step-errors',
        description: 'No steps produced errors',
        type: 'functional',
        evaluate(stepResults) {
            const errored = stepResults.filter((s) => s.error);
            return {
                criterionId: 'no-step-errors',
                passed: errored.length === 0,
                message: errored.length === 0
                    ? 'No errors encountered'
                    : `${errored.length} step(s) had errors`,
                evidence: errored.length > 0 ? errored.map((s) => `Step ${s.stepNumber}: ${s.error}`).join('; ') : undefined,
            };
        },
    };
}
export function completedWithinDuration(maxMs) {
    return {
        id: `completed-within-${maxMs}ms`,
        description: `All steps completed within ${maxMs}ms total`,
        type: 'performance',
        evaluate(stepResults) {
            const totalDuration = stepResults.reduce((sum, s) => sum + s.duration, 0);
            return {
                criterionId: `completed-within-${maxMs}ms`,
                passed: totalDuration <= maxMs,
                message: totalDuration <= maxMs
                    ? `Completed in ${totalDuration}ms (within ${maxMs}ms limit)`
                    : `Took ${totalDuration}ms (exceeded ${maxMs}ms limit)`,
            };
        },
    };
}
export function parsePlainTextCriteria(text) {
    return text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line, i) => ({
        id: `custom-${i}`,
        description: line,
        type: 'functional',
        evaluate(stepResults) {
            const allPassed = stepResults.every((s) => s.passed);
            return {
                criterionId: `custom-${i}`,
                passed: allPassed,
                message: allPassed ? `Criterion met: ${line}` : `Criterion may not be met: ${line}`,
            };
        },
    }));
}
export function evaluateAllCriteria(stepResults, criteria) {
    const results = criteria.map((c) => c.evaluate(stepResults));
    return {
        passed: results.every((r) => r.passed),
        results,
    };
}
//# sourceMappingURL=acceptance.js.map