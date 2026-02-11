import type {
  StartDemoMessage,
  DemoResult,
  StepResult,
  VideoMetadata,
  ScreenshotCapture,
} from '@popcorn/shared';
import { createMessage } from '@popcorn/shared';
import { createInitialState, transition } from './state.js';
import type { OrchestratorState } from './state.js';

let state: OrchestratorState = createInitialState();

export async function handleStartDemo(
  message: StartDemoMessage,
  tabId: number,
): Promise<DemoResult> {
  const { testPlan, testPlanId, acceptanceCriteria } = message.payload;

  // Transition to running state
  state = transition(state, { type: 'START_DEMO', plan: testPlan });

  try {
    // Send test plan to content script
    const executePlanMessage = {
      type: 'execute_plan',
      payload: {
        steps: testPlan.steps,
      },
    };

    // Execute the test plan
    const response = await chrome.tabs.sendMessage(tabId, executePlanMessage);

    if (!response || !response.results) {
      throw new Error('No results received from content script');
    }

    const stepResults: StepResult[] = response.results;

    // Update state with results
    for (const result of stepResults) {
      state = transition(state, { type: 'STEP_COMPLETE', result });
    }

    // Transition to complete
    state = transition(state, { type: 'DEMO_COMPLETE' });

    // Assemble demo result
    const demoResult = assembleDemoResult(
      testPlanId,
      stepResults,
      state.startTime!,
      acceptanceCriteria,
    );

    // Reset state
    state = transition(state, { type: 'RESET' });

    return demoResult;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    state = transition(state, { type: 'DEMO_ERROR', error: errorMessage });

    // Create error result
    const demoResult = assembleDemoResult(
      testPlanId,
      state.results,
      state.startTime!,
      acceptanceCriteria,
      errorMessage,
    );

    // Reset state
    state = transition(state, { type: 'RESET' });

    return demoResult;
  }
}

function assembleDemoResult(
  testPlanId: string,
  stepResults: StepResult[],
  startTime: number,
  acceptanceCriteria: string[],
  error?: string,
): DemoResult {
  const duration = Date.now() - startTime;
  const passed = error
    ? false
    : stepResults.every((result) => result.passed || result.action === 'assert');

  // Extract screenshots from results
  const screenshots: ScreenshotCapture[] = stepResults
    .filter((result) => result.screenshotDataUrl)
    .map((result) => ({
      stepNumber: result.stepNumber,
      dataUrl: result.screenshotDataUrl!,
      timestamp: result.timestamp,
      label: result.description,
    }));

  // Generate summary
  const totalSteps = stepResults.length;
  const passedSteps = stepResults.filter((r) => r.passed).length;
  const failedSteps = totalSteps - passedSteps;

  let summary: string;
  if (error) {
    summary = `Demo failed with error: ${error}. Completed ${passedSteps}/${totalSteps} steps.`;
  } else if (passed) {
    summary = `Demo completed successfully. All ${totalSteps} steps passed in ${(duration / 1000).toFixed(2)}s.`;
  } else {
    summary = `Demo completed with issues. ${passedSteps}/${totalSteps} steps passed, ${failedSteps} failed.`;
  }

  // Placeholder for video metadata (actual video capture not implemented yet)
  const videoMetadata: VideoMetadata | null = null;

  return {
    testPlanId,
    passed,
    steps: stepResults,
    summary,
    videoMetadata,
    screenshots,
    duration,
    timestamp: Date.now(),
  };
}

export function getState(): OrchestratorState {
  return state;
}

export function resetOrchestratorState(): void {
  state = transition(state, { type: 'RESET' });
}
