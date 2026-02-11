export type ActionType = 'navigate' | 'click' | 'fill' | 'select' | 'check' | 'uncheck' | 'hover' | 'scroll' | 'wait' | 'assert' | 'keypress' | 'drag' | 'upload' | 'screenshot';
export type AssertionType = 'text' | 'visible' | 'hidden' | 'url' | 'count' | 'attribute' | 'value';
export type WaitCondition = 'visible' | 'hidden' | 'networkIdle' | 'timeout';
export interface TestStep {
    stepNumber: number;
    action: ActionType;
    description: string;
    selector?: string;
    selectorFallback?: string;
    target?: string;
    value?: string | boolean | number;
    key?: string;
    assertionType?: AssertionType;
    expected?: unknown;
    condition?: WaitCondition;
    timeout?: number;
    sourceSelector?: string;
    targetSelector?: string;
    filePath?: string;
    position?: {
        x: number;
        y: number;
    };
    name?: string;
}
export interface TestPlanVariant {
    variantName: string;
    description: string;
    divergesAtStep: number;
    steps: TestStep[];
}
export interface TestPlan {
    planName: string;
    description?: string;
    assumptions?: string[];
    baseUrl: string;
    steps: TestStep[];
    tags?: string[];
    estimatedDuration?: string;
    variants?: TestPlanVariant[];
    prerequisites?: string[];
}
//# sourceMappingURL=test-plan.d.ts.map