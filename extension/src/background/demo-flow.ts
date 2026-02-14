/**
 * Full demo flow orchestrator for the Popcorn extension.
 * Coordinates recording, test plan execution via content script,
 * tape storage, and result assembly into a single async pipeline.
 */

import type {
  StartDemoMessage,
  DemoResult,
  VideoMetadata,
  StepResult,
  TestStep,
} from '@popcorn/shared';
import { generateTapeName } from '@popcorn/shared';
import { Recorder } from '../capture/recorder.js';
import { captureScreenshot } from '../capture/screenshot.js';
import { assembleDemoResult } from './demo-orchestrator.js';
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
 * A round groups consecutive background-handled steps (navigate/wait)
 * followed by consecutive content-script-safe steps (click/fill/screenshot/etc).
 * The background executes each round in order: first its backgroundSteps,
 * then it injects the content script and sends the contentSteps batch.
 */
interface StepRound {
  backgroundSteps: TestStep[];
  contentSteps: TestStep[];
}

/**
 * Runs the full demo pipeline:
 * 1. Optionally starts tab recording (graceful degradation if unavailable).
 * 2. Groups test plan steps into rounds, executing navigate/wait from the
 *    background and click/fill/screenshot/etc via the content script.
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
  const { testPlan, testPlanId, acceptanceCriteria } = message.payload;
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

  // 2. Group steps into rounds. Each round has background steps (navigate/wait)
  //    followed by content script steps (click/fill/screenshot/assert/etc).
  //    This handles both simple plans (one round) and exhaustive plans
  //    (many rounds with navigate-back between each click).
  const rounds = groupStepRounds(testPlan.steps);
  const allStepResults: StepResult[] = [];
  const startTime = Date.now();

  try {
    for (const round of rounds) {
      // 2a. Execute background steps (navigate/wait) and record results
      for (const step of round.backgroundSteps) {
        const stepStart = Date.now();
        if (step.action === 'navigate' && step.target) {
          console.log(`[Popcorn] Background navigating to: ${step.target}`);
          await navigateTab(tabId, step.target);
        } else if (step.action === 'wait') {
          const waitMs = step.timeout || 1000;
          console.log(`[Popcorn] Background waiting ${waitMs}ms`);
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
        allStepResults.push({
          stepNumber: step.stepNumber,
          description: step.description || step.action,
          action: step.action,
          passed: true,
          timestamp: stepStart,
          duration: Date.now() - stepStart,
        });
      }

      // Skip content script call if this round has no content steps
      if (round.contentSteps.length === 0) continue;

      console.log(
        `[Popcorn] Executing content round: ${round.contentSteps.length} steps`,
        round.contentSteps.map((s) => `${s.stepNumber}:${s.action}`).join(', '),
      );

      // 2b. Inject content script if not already loaded.
      // Re-injecting content.js into the same page causes "Identifier already declared"
      // because bundled const/let at module scope can't be redeclared.
      // Ping first — if the content script responds, skip injection.
      let needsInjection = true;
      try {
        const ping = await chrome.tabs.sendMessage(tabId, { type: 'ping' });
        if (ping) needsInjection = false;
      } catch {
        // No content script listening — needs injection
      }

      if (needsInjection) {
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
      }

      // 2c. Send this round's content steps to the content script
      const response = await chrome.tabs.sendMessage(tabId, {
        type: 'execute_plan',
        payload: { steps: round.contentSteps },
      });

      if (response?.results) {
        const roundResults = response.results as StepResult[];

        // 2d. Capture screenshots for this round IMMEDIATELY (before navigating away)
        for (const stepResult of roundResults) {
          if (stepResult.metadata?.needsBackgroundScreenshot) {
            try {
              const dataUrl = await captureScreenshot(tabId);
              stepResult.screenshotDataUrl = dataUrl;
              if (stepResult.metadata) {
                stepResult.metadata.screenshotDataUrl = dataUrl;
                delete stepResult.metadata.needsBackgroundScreenshot;
              }
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              console.warn(
                `[Popcorn] Per-round screenshot for step ${stepResult.stepNumber} failed:`,
                errMsg,
              );
              stepResult.passed = false;
              stepResult.error = `Screenshot capture failed: ${errMsg}`;
              if (stepResult.metadata) {
                delete stepResult.metadata.needsBackgroundScreenshot;
              }
            }
          }
        }

        allStepResults.push(...roundResults);
      }
    }
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
    // Assemble an error result from whatever we collected
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorResult = assembleDemoResult(
      testPlanId,
      allStepResults,
      startTime,
      acceptanceCriteria ?? [],
      errorMessage,
    );
    // Still save the tape and return
    await saveTapeAndReload(errorResult, null, null, null, testPlan, testPlanId, tabId, deps);
    return errorResult;
  }

  // 3. Assemble demo result from all collected step results
  const demoResult = assembleDemoResult(
    testPlanId,
    allStepResults,
    startTime,
    acceptanceCriteria ?? [],
  );

  // 3a. Capture screenshots from the background for any steps that requested it.
  //     The content script returns a marker (needsBackgroundScreenshot) instead of
  //     attempting nested messaging, which avoids Chrome message channel issues.

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
        stepResult.passed = false;
        stepResult.error = `Screenshot capture failed: ${errMsg}`;
        if (stepResult.metadata) {
          delete stepResult.metadata.needsBackgroundScreenshot;
        }
      }
    }
  }

  // 4. Stop recording and collect video metadata
  let videoMetadata: VideoMetadata | null = null;
  let videoBlob: Blob | null = null;

  if (recordingAvailable) {
    try {
      const { blob, metadata } = await recorder.stop();
      metadata.filename = `demo-${testPlanId}-${Date.now()}.webm`;
      if (blob.size > 0) {
        videoMetadata = metadata;
        videoBlob = blob;
        console.log(`[Popcorn] Recording stopped, ${blob.size} bytes captured`);
      } else {
        console.warn('[Popcorn] Recording captured 0 bytes, discarding empty video');
      }
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

  // 5. Save tape, capture thumbnail, reload tab
  await saveTapeAndReload(resultWithVideo, videoBlob, videoMetadata, null, testPlan, testPlanId, tabId, deps);

  return resultWithVideo;
}

/**
 * Saves a TapeRecord to the store, captures a thumbnail, and reloads the tab.
 * Extracted to avoid duplicating this logic in the success and error paths.
 */
async function saveTapeAndReload(
  result: DemoResult,
  videoBlob: Blob | null,
  videoMetadata: VideoMetadata | null,
  _thumbnailOverride: string | null,
  testPlan: StartDemoMessage['payload']['testPlan'],
  testPlanId: string,
  tabId: number,
  deps: DemoFlowDeps,
): Promise<void> {
  // Capture a final screenshot for the tape thumbnail
  let thumbnailDataUrl: string | null = _thumbnailOverride;
  if (!thumbnailDataUrl) {
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
  }

  // Save tape record
  try {
    const tapeData: Omit<TapeRecord, 'id'> = {
      demoName: generateTapeName(testPlan),
      testPlanId,
      timestamp: Date.now(),
      duration: result.duration,
      fileSize: videoBlob?.size ?? 0,
      resolution: videoMetadata?.resolution ?? { width: 0, height: 0 },
      status: result.passed ? 'complete' : 'error',
      passed: result.passed,
      summary: result.summary,
      videoBlob,
      thumbnailDataUrl,
      results: result,
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

  // Reset app state by reloading the tab so the next demo starts fresh.
  try {
    await reloadTab(tabId);
    console.log('[Popcorn] Tab reloaded to reset app state');
  } catch (err) {
    console.warn(
      '[Popcorn] Failed to reload tab after demo:',
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Groups test plan steps into execution rounds. Each round contains:
 * - backgroundSteps: navigate/wait steps handled by the background via
 *   chrome.tabs.update (safe — doesn't destroy content script context).
 * - contentSteps: click/fill/screenshot/assert/etc steps sent to the
 *   content script as a batch.
 *
 * This handles both simple plans (single round: navigate → content steps)
 * and exhaustive plans (multiple rounds: navigate → click → screenshot →
 * navigate-back → wait → click → screenshot → navigate-back → ...).
 */
export function groupStepRounds(steps: TestStep[]): StepRound[] {
  const rounds: StepRound[] = [];
  let bgSteps: TestStep[] = [];
  let csSteps: TestStep[] = [];

  for (const step of steps) {
    if (step.action === 'navigate' || step.action === 'wait') {
      // If we have accumulated content steps, close the current round
      if (csSteps.length > 0) {
        rounds.push({ backgroundSteps: bgSteps, contentSteps: csSteps });
        bgSteps = [];
        csSteps = [];
      }
      bgSteps.push(step);
    } else {
      csSteps.push(step);
    }
  }

  // Push final round
  if (bgSteps.length > 0 || csSteps.length > 0) {
    rounds.push({ backgroundSteps: bgSteps, contentSteps: csSteps });
  }

  return rounds;
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
