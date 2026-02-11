import type { TestPlan, StepResult } from '@popcorn/shared';

export type DemoState = 'idle' | 'running' | 'capturing' | 'complete' | 'error';

export interface OrchestratorState {
  status: DemoState;
  currentPlan: TestPlan | null;
  currentStepIndex: number;
  results: StepResult[];
  startTime: number | null;
  error: string | null;
}

export type StateAction =
  | { type: 'START_DEMO'; plan: TestPlan }
  | { type: 'STEP_COMPLETE'; result: StepResult }
  | { type: 'DEMO_COMPLETE' }
  | { type: 'DEMO_ERROR'; error: string }
  | { type: 'RESET' };

export function createInitialState(): OrchestratorState {
  return {
    status: 'idle',
    currentPlan: null,
    currentStepIndex: 0,
    results: [],
    startTime: null,
    error: null,
  };
}

export function transition(
  state: OrchestratorState,
  action: StateAction,
): OrchestratorState {
  switch (action.type) {
    case 'START_DEMO':
      return {
        ...state,
        status: 'running',
        currentPlan: action.plan,
        currentStepIndex: 0,
        results: [],
        startTime: Date.now(),
        error: null,
      };

    case 'STEP_COMPLETE':
      return {
        ...state,
        currentStepIndex: state.currentStepIndex + 1,
        results: [...state.results, action.result],
      };

    case 'DEMO_COMPLETE':
      return {
        ...state,
        status: 'complete',
      };

    case 'DEMO_ERROR':
      return {
        ...state,
        status: 'error',
        error: action.error,
      };

    case 'RESET':
      return createInitialState();

    default:
      return state;
  }
}

export function resetState(): OrchestratorState {
  return createInitialState();
}
