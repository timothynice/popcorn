import type { TestStep, StepResult } from '@popcorn/shared';
import { executeAction } from './actions.js';

export async function executeTestPlan(steps: TestStep[]): Promise<StepResult[]> {
  const results: StepResult[] = [];

  for (const step of steps) {
    const result = await executeAction(step);

    // Promote screenshot data URL from metadata to the top-level field
    // so the orchestrator's screenshot extraction logic can find it.
    if (result.metadata?.screenshotDataUrl) {
      result.screenshotDataUrl = result.metadata.screenshotDataUrl as string;
    }

    results.push(result);

    // Stop on critical action errors (but not assertion failures)
    if (!result.passed && step.action !== 'assert') {
      console.error(
        `Critical error at step ${step.stepNumber}: ${result.error}`,
      );
      // Continue with remaining steps but mark them as skipped
      // Actually, let's stop execution here for critical failures
      break;
    }
  }

  return results;
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'execute_plan') {
    const steps: TestStep[] = message.payload.steps;

    executeTestPlan(steps)
      .then((results) => {
        sendResponse({ success: true, results });
      })
      .catch((error) => {
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return true; // Keep channel open for async response
  }

  return false;
});
