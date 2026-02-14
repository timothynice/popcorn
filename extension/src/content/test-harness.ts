import type { TestStep, StepResult } from '@popcorn/shared';
import { executeAction } from './actions.js';
import { ConsoleCapture } from './console-capture.js';

const consoleCapture = new ConsoleCapture();

export async function executeTestPlan(steps: TestStep[]): Promise<StepResult[]> {
  const results: StepResult[] = [];
  consoleCapture.start();

  try {
    for (const step of steps) {
      const stepStartTime = Date.now();
      const result = await executeAction(step);

      // Attach console logs captured during this step
      result.consoleLogs = consoleCapture.getLogsSince(stepStartTime);

      // Promote screenshot data URL from metadata to the top-level field
      // so the orchestrator's screenshot extraction logic can find it.
      if (result.metadata?.screenshotDataUrl) {
        result.screenshotDataUrl = result.metadata.screenshotDataUrl as string;
      }

      results.push(result);

      // Continue on most failures — the background decides recovery strategy.
      // Only break if a navigate action fails (content script context is about to be destroyed).
      if (!result.passed) {
        console.warn(
          `[Popcorn] Step ${step.stepNumber} (${step.action}) failed: ${result.error}`,
        );
        if (step.action === 'navigate') {
          break;
        }
      }
    }
  } finally {
    consoleCapture.stop();
  }

  return results;
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Ping: background checks if content script is already loaded (avoid re-injection)
  if (message.type === 'ping') {
    sendResponse({ pong: true });
    return false;
  }

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
