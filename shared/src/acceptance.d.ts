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
export declare function allStepsPassed(): AcceptanceCriterion;
export declare function noStepErrors(): AcceptanceCriterion;
export declare function completedWithinDuration(maxMs: number): AcceptanceCriterion;
export declare function parsePlainTextCriteria(text: string): AcceptanceCriterion[];
export declare function evaluateAllCriteria(stepResults: StepResult[], criteria: AcceptanceCriterion[]): {
    passed: boolean;
    results: CriterionResult[];
};
//# sourceMappingURL=acceptance.d.ts.map