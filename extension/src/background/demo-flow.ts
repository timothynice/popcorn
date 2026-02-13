/**
 * Full demo flow orchestrator for the Popcorn extension.
 * Coordinates recording, test plan execution via content script,
 * tape storage, and result assembly into a single async pipeline.
 */

import type {
  StartDemoMessage,
  DemoResult,
  VideoMetadata,
  TestStep,
} from '@popcorn/shared';
import { generateTapeName } from '@popcorn/shared';
import { Recorder } from '../capture/recorder.js';
import { captureScreenshot } from '../capture/screenshot.js';
import { handleStartDemo } from './demo-orchestrator.js';
import type { TapeStore, TapeRecord } from '../storage/tape-store.js';

export interface DemoFlowDeps {
  /** TapeStore instance for persisting results. Injected for testability. */
  tapeStore: TapeStore | { save: TapeStore['save']; init: TapeStore['init'] };
  /** Optional callback invoked after a tape is saved, e.g. to notify the popup. */
  onTapeSaved?: (tapeId: string) => void;
  /** When true, skip video recording entirely (e.g. hook-triggered demos with no user gesture). */
  skipRecording?: boolean;
}

/**
 * Runs the full demo pipeline:
 * 1. Optionally starts tab recording (graceful degradation if unavailable).
 * 2. Executes the test plan via the content script through the orchestrator.
 * 3. Stops recording and collects video metadata.
 * 4. Saves a TapeRecord to the TapeStore.
 * 5. Returns the assembled DemoResult.
 *
 * @param message - The start_demo message containing the test plan.
 * @param tabId - Chrome tab ID where the demo will be executed.
 * @param deps - Injected dependencies (tape store).
 * @returns The assembled DemoResult including any video metadata.
 */
export async function runFullDemo(
  message: StartDemoMessage,
  tabId: number,
  deps: DemoFlowDeps,
): Promise<DemoResult> {
  const { testPlan, testPlanId } = message.payload;
  const recorder = new Recorder();
  let recordingAvailable = false;

  // 1. Try to start recording (graceful degradation).
  //    Skip entirely when skipRecording is set (e.g. hook-triggered demos
  //    where no user gesture is available for tabCapture).
  if (!deps.skipRecording) {
    try {
      await recorder.start(tabId);
      recordingAvailable = true;
      console.log(`[Popcorn] Recording started for tab ${tabId}`);
    } catch (err) {
      console.warn(
        '[Popcorn] Recording unavailable, continuing without video:',
        err instanceof Error ? err.message : String(err),
      );
    }
  } else {
    console.log('[Popcorn] Recording skipped (no user gesture available)');
  }

  // 2. Handle navigate steps from the background (content script can't
  //    survive page navigation — setting window.location destroys its context).
  //    We split off leading navigate/wait steps and handle them here, then
  //    pass the remaining steps to the content script via the orchestrator.
  const { navigateSteps, contentSteps } = splitNavigateSteps(testPlan.steps);

  for (const step of navigateSteps) {
    if (step.action === 'navigate' && step.target) {
      console.log(`[Popcorn] Background navigating to: ${step.target}`);
      await navigateTab(tabId, step.target);
    } else if (step.action === 'wait') {
      const waitMs = step.timeout || 1000;
      console.log(`[Popcorn] Background waiting ${waitMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  // 3. Ensure content script is injected (handles extension reload case
  //    and post-navigation re-injection)
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
  } catch (err) {
    console.warn(
      '[Popcorn] Content script injection failed:',
      err instanceof Error ? err.message : String(err),
    );
  }

  // 4. Execute the remaining steps via the content script through the orchestrator.
  //    We create a modified message with only the content-script-safe steps.
  const contentMessage: StartDemoMessage = {
    ...message,
    payload: {
      ...message.payload,
      testPlan: {
        ...testPlan,
        steps: contentSteps,
      },
    },
  };

  let demoResult: DemoResult;
  try {
    demoResult = await handleStartDemo(contentMessage, tabId);
  } catch (err) {
    // If execution fails, still try to stop the recorder
    if (recordingAvailable) {
      try {
        await recorder.stop();
      } catch {
        // Ignore stop errors during error path
      }
      recorder.reset();
    }
    throw err;
  }

  // 4a. Capture screenshots from the background for any steps that requested it.
  //     The content script returns a marker (needsBackgroundScreenshot) instead of
  //     attempting nested messaging, which avoids Chrome message channel issues.
  //     We also update demoResult.screenshots since assembleDemoResult already ran.

  // Ensure the tab is focused so captureVisibleTab works — during hook-triggered
  // demos the tab may not be active (popup or devtools could be in front).
  const hasScreenshotSteps = demoResult.steps.some(
    (s) => s.metadata?.needsBackgroundScreenshot,
  );
  if (hasScreenshotSteps) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.windowId) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
      await chrome.tabs.update(tabId, { active: true });
      // Brief delay for the browser to render the focused tab
      await new Promise((resolve) => setTimeout(resolve, 250));
    } catch {
      // Best-effort focus
    }
  }

  for (const stepResult of demoResult.steps) {
    if (stepResult.metadata?.needsBackgroundScreenshot) {
      try {
        const dataUrl = await captureScreenshot(tabId);
        stepResult.screenshotDataUrl = dataUrl;
        if (stepResult.metadata) {
          stepResult.metadata.screenshotDataUrl = dataUrl;
          delete stepResult.metadata.needsBackgroundScreenshot;
        }
        // Push into the already-assembled screenshots array
        demoResult.screenshots.push({
          stepNumber: stepResult.stepNumber,
          dataUrl,
          timestamp: stepResult.timestamp,
          label: stepResult.description,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[Popcorn] Background screenshot for step ${stepResult.stepNumber} failed:`,
          errMsg,
        );
        // Mark the step as failed so the UI accurately reflects the capture failure
        stepResult.passed = false;
        stepResult.error = `Screenshot capture failed: ${errMsg}`;
        if (stepResult.metadata) {
          delete stepResult.metadata.needsBackgroundScreenshot;
        }
      }
    }
  }

  // 5. Stop recording and collect video metadata
  let videoMetadata: VideoMetadata | null = null;
  let videoBlob: Blob | null = null;

  if (recordingAvailable) {
    try {
      const { blob, metadata } = await recorder.stop();
      metadata.filename = `demo-${testPlanId}-${Date.now()}.webm`;
      videoMetadata = metadata;
      videoBlob = blob;
      console.log(`[Popcorn] Recording stopped, ${blob.size} bytes captured`);
    } catch (err) {
      console.warn(
        '[Popcorn] Failed to stop recording:',
        err instanceof Error ? err.message : String(err),
      );
    }
    recorder.reset();
  }

  // Attach video metadata to the result
  const resultWithVideo: DemoResult = {
    ...demoResult,
    videoMetadata: videoMetadata ?? demoResult.videoMetadata,
  };

  // 6. Capture a final screenshot for the tape thumbnail
  //    Ensure the tab is focused first — captureVisibleTab needs the tab visible.
  let thumbnailDataUrl: string | null = null;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.windowId) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    await chrome.tabs.update(tabId, { active: true });
    await new Promise((resolve) => setTimeout(resolve, 250));
  } catch {
    // Best-effort focus for thumbnail
  }
  try {
    thumbnailDataUrl = await captureScreenshot(tabId);
  } catch {
    // Thumbnail is optional
  }

  // 7. Save tape record
  try {
    const tapeData: Omit<TapeRecord, 'id'> = {
      demoName: generateTapeName(testPlan),
      testPlanId,
      timestamp: Date.now(),
      duration: resultWithVideo.duration,
      fileSize: videoBlob?.size ?? 0,
      resolution: videoMetadata?.resolution ?? { width: 0, height: 0 },
      status: resultWithVideo.passed ? 'complete' : 'error',
      passed: resultWithVideo.passed,
      summary: resultWithVideo.summary,
      videoBlob,
      thumbnailDataUrl,
      results: resultWithVideo,
      testPlan,
    };

    const tapeId = await deps.tapeStore.save(tapeData);
    console.log(`[Popcorn] Tape saved with id: ${tapeId}`);
    deps.onTapeSaved?.(tapeId);
  } catch (err) {
    console.warn(
      '[Popcorn] Failed to save tape:',
      err instanceof Error ? err.message : String(err),
    );
  }

  // 8. Reset app state by reloading the tab so the next demo starts fresh.
  try {
    await reloadTab(tabId);
    console.log('[Popcorn] Tab reloaded to reset app state');
  } catch (err) {
    console.warn(
      '[Popcorn] Failed to reload tab after demo:',
      err instanceof Error ? err.message : String(err),
    );
  }

  return resultWithVideo;
}

/**
 * Splits test plan steps into background-handled navigate/wait steps
 * and content-script-safe steps. Navigate steps that use window.location
 * destroy the content script context, so we handle them from the background
 * using chrome.tabs.update instead.
 *
 * Splits at the boundary: all leading navigate/wait steps go to the
 * background; everything from the first non-navigate/non-wait step
 * onward goes to the content script.
 */
function splitNavigateSteps(steps: TestStep[]): {
  navigateSteps: TestStep[];
  contentSteps: TestStep[];
} {
  const navigateSteps: TestStep[] = [];
  let splitIndex = 0;

  for (const step of steps) {
    if (step.action === 'navigate' || step.action === 'wait') {
      navigateSteps.push(step);
      splitIndex++;
    } else {
      break;
    }
  }

  return {
    navigateSteps,
    contentSteps: steps.slice(splitIndex),
  };
}

/**
 * Navigates a tab to a URL using chrome.tabs.update and waits for the
 * page to finish loading. This is the safe way to navigate — unlike
 * setting window.location in a content script, this doesn't destroy
 * the content script execution context.
 *
 * If the tab is already at the target URL (ignoring trailing slashes),
 * the navigation is skipped to avoid an unnecessary reload.
 */
async function navigateTab(tabId: number, url: string): Promise<void> {
  // Check if already at the target URL — skip navigation if so
  try {
    const tab = await chrome.tabs.get(tabId);
    const normalise = (u: string) => u.replace(/\/+$/, '');
    if (tab.url && normalise(tab.url) === normalise(url)) {
      console.log(`[Popcorn] Tab already at ${url}, skipping navigation`);
      return;
    }
  } catch {
    // If we can't get tab info, proceed with navigation
  }

  return new Promise((resolve) => {
    const onUpdated = (
      updatedTabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
    ) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.update(tabId, { url });
  });
}

/**
 * Reloads a tab and waits for the page to finish loading.
 * Used to reset SPA state when URL-based navigation would be a no-op
 * (e.g. after a demo that changed internal state without changing the URL).
 */
export async function reloadTab(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    const onUpdated = (
      updatedTabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
    ) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.reload(tabId);
  });
}
