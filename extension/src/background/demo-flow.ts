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
  ScreenshotCapture,
  ExplorationPlan,
  ExplorationTarget,
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

  // 2. Group steps into rounds. Rounds split at navigation boundaries (navigate/go_back)
  //    and screenshot boundaries (so the background captures each screenshot before the
  //    next click changes the page).
  const rounds = groupStepRounds(testPlan.steps);
  const allStepResults: StepResult[] = [];
  const startTime = Date.now();

  try {
    for (const round of rounds) {
      // 2a. Execute background steps (navigate/go_back) and record results
      for (const step of round.backgroundSteps) {
        const stepStart = Date.now();
        if (step.action === 'navigate' && step.target) {
          console.log(`[Popcorn] Background navigating to: ${step.target}`);
          await navigateTab(tabId, step.target);
        } else if (step.action === 'go_back') {
          console.log('[Popcorn] Background going back via browser history');
          await goBackTab(tabId);
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

        // 2d. Capture screenshots for this round IMMEDIATELY (before navigating away).
        // Throttle consecutive captures to avoid Chrome's MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND limit.
        let screenshotCount = 0;
        for (const stepResult of roundResults) {
          if (stepResult.metadata?.needsBackgroundScreenshot) {
            try {
              if (screenshotCount > 0) {
                await new Promise((resolve) => setTimeout(resolve, 1100));
              }
              const dataUrl = await captureScreenshot(tabId);
              stepResult.screenshotDataUrl = dataUrl;
              if (stepResult.metadata) {
                stepResult.metadata.screenshotDataUrl = dataUrl;
                delete stepResult.metadata.needsBackgroundScreenshot;
              }
              screenshotCount++;
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              console.warn(
                `[Popcorn] Per-round screenshot for step ${stepResult.stepNumber} failed:`,
                errMsg,
              );
              // Screenshot failure is non-fatal — step stays passed
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
 * - backgroundSteps: navigate/go_back steps handled by the background via
 *   chrome.tabs.update / chrome.tabs.goBack.
 * - contentSteps: click/fill/screenshot/assert/etc steps sent to the
 *   content script as a batch.
 *
 * Rounds are split at two boundaries:
 * 1. **Navigation boundaries** — navigate/go_back start a new round because
 *    they destroy the content script context.
 * 2. **Screenshot boundaries** — a screenshot is always the last content step
 *    in its round. This ensures the background captures the visible tab while
 *    the page is in the correct visual state (before the next click changes it).
 */
export function groupStepRounds(steps: TestStep[]): StepRound[] {
  const rounds: StepRound[] = [];
  let bgSteps: TestStep[] = [];
  let csSteps: TestStep[] = [];

  for (const step of steps) {
    if (step.action === 'navigate' || step.action === 'go_back') {
      // Navigation destroys content script — close current round first
      if (csSteps.length > 0) {
        rounds.push({ backgroundSteps: bgSteps, contentSteps: csSteps });
        bgSteps = [];
        csSteps = [];
      }
      bgSteps.push(step);
    } else {
      csSteps.push(step);
      // Split after screenshot so background captures it before next click
      if (step.action === 'screenshot') {
        rounds.push({ backgroundSteps: bgSteps, contentSteps: csSteps });
        bgSteps = [];
        csSteps = [];
      }
    }
  }

  // Push final round (steps after last screenshot, or plans without screenshots)
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
 * Goes back in browser history for a tab and waits for the page to
 * finish loading. Uses chrome.tabs.goBack which respects browser
 * history (including SPA pushState entries), unlike navigateTab
 * which does a full URL navigation.
 */
async function goBackTab(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve(); // Resolve even on timeout — best-effort
    }, 5000);

    const onUpdated = (
      updatedTabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
    ) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.goBack(tabId, () => {
      // chrome.tabs.goBack uses a callback; check for runtime errors
      if (chrome.runtime.lastError) {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        reject(new Error(chrome.runtime.lastError.message));
      }
    });
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

// ---------------------------------------------------------------------------
// Per-element exploration demo
// ---------------------------------------------------------------------------

/** Tracks last screenshot time to enforce Chrome's ~1/sec rate limit. */
let lastScreenshotTime = 0;
const SCREENSHOT_MIN_INTERVAL = 1100;

/**
 * Captures a screenshot with rate-limit throttling.
 * Waits if needed to respect Chrome's MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND.
 */
export async function throttledScreenshot(tabId: number): Promise<string> {
  const elapsed = Date.now() - lastScreenshotTime;
  if (elapsed < SCREENSHOT_MIN_INTERVAL) {
    await new Promise((r) => setTimeout(r, SCREENSHOT_MIN_INTERVAL - elapsed));
  }
  const dataUrl = await captureScreenshot(tabId);
  lastScreenshotTime = Date.now();
  return dataUrl;
}

/**
 * Waits for a tab to reach 'complete' status, with a timeout fallback.
 * Returns true if the tab completed, false if it timed out (e.g. SPA navigation).
 */
export async function waitForTabComplete(
  tabId: number,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve(false);
    }, timeoutMs);

    const onUpdated = (
      id: number,
      changeInfo: chrome.tabs.TabChangeInfo,
    ) => {
      if (id === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve(true);
      }
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

/**
 * Ensures the content script is loaded in the tab.
 * Pings first to avoid re-injection errors, injects if needed.
 */
export async function ensureContentScript(tabId: number): Promise<void> {
  try {
    const ping = await chrome.tabs.sendMessage(tabId, { type: 'ping' });
    if (ping?.pong) return;
  } catch {
    // Not loaded
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js'],
  });
  // Small delay for content script to initialize
  await new Promise((r) => setTimeout(r, 100));
}

/**
 * Sends a single action step to the content script and returns the result.
 */
export async function sendSingleAction(
  tabId: number,
  step: TestStep,
): Promise<StepResult> {
  const response = await chrome.tabs.sendMessage(tabId, {
    type: 'execute_plan',
    payload: { steps: [step] },
  });
  if (response?.results?.[0]) {
    return response.results[0];
  }
  throw new Error(`No result from content script for step ${step.stepNumber}`);
}

/** Creates a StepResult for background-managed steps. */
function makeStepResult(
  stepNumber: number,
  action: string,
  description: string,
  passed: boolean,
  error?: string,
  metadata?: Record<string, unknown>,
): StepResult {
  return {
    stepNumber,
    action: action as StepResult['action'],
    description,
    passed,
    duration: 0,
    timestamp: Date.now(),
    error,
    metadata,
  };
}

/**
 * Runs a per-element exploration demo. For each target element:
 * 1. Checks actionability
 * 2. Clicks the element
 * 3. Detects what happened (URL change, modal, DOM settle)
 * 4. Takes a screenshot of the new state
 * 5. Recovers (go_back, dismiss modal)
 * 6. Continues to next element
 *
 * Single-element failures are caught and skipped — they don't abort the run.
 */
export async function runExplorationDemo(
  plan: ExplorationPlan,
  tabId: number,
  deps: DemoFlowDeps,
): Promise<DemoResult> {
  const allResults: StepResult[] = [];
  const screenshots: ScreenshotCapture[] = [];
  let stepNum = 1;
  const startTime = Date.now();

  // Start recording if available (popup-triggered demos have user gesture for tabCapture)
  const recorder = new Recorder();
  let recordingAvailable = false;
  if (!deps.skipRecording) {
    try {
      await recorder.start(tabId);
      recordingAvailable = true;
      console.log(`[Popcorn] Exploration recording started for tab ${tabId}`);
    } catch (err) {
      console.warn(
        '[Popcorn] Exploration recording unavailable, continuing without video:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  try {
    // 1. Navigate to base URL
    console.log(`[Popcorn] Exploration: navigating to ${plan.baseUrl}`);
    await navigateTab(tabId, plan.baseUrl);
    allResults.push(makeStepResult(stepNum++, 'navigate', 'Navigate to page', true));

    // 2. Initial screenshot
    try {
      const initialDataUrl = await throttledScreenshot(tabId);
      screenshots.push({
        stepNumber: stepNum,
        dataUrl: initialDataUrl,
        timestamp: Date.now(),
        label: 'Initial page state',
      });
      allResults.push(makeStepResult(stepNum++, 'screenshot', 'Initial page state', true));
    } catch (err) {
      allResults.push(
        makeStepResult(stepNum++, 'screenshot', 'Initial page state', false,
          err instanceof Error ? err.message : String(err)),
      );
    }

    // 3. Run form fill steps (if any)
    if (plan.formFillSteps.length > 0) {
      await ensureContentScript(tabId);
      try {
        const response = await chrome.tabs.sendMessage(tabId, {
          type: 'execute_plan',
          payload: { steps: plan.formFillSteps },
        });
        if (response?.results) {
          allResults.push(...(response.results as StepResult[]));
        }
      } catch (err) {
        console.warn('[Popcorn] Form fill failed:', err);
        allResults.push(
          makeStepResult(stepNum++, 'fill', 'Form fill batch', false,
            err instanceof Error ? err.message : String(err)),
        );
      }
    }

    // 4. Per-element exploration loop
    for (const target of plan.targets) {
      try {
        const result = await exploreElement(target, tabId, stepNum);
        allResults.push(...result.results);
        screenshots.push(...result.screenshots);
        stepNum += result.results.length;
      } catch (err) {
        // Single element failure — log and continue
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn(`[Popcorn] Exploration of "${target.label}" failed: ${errMsg}`);
        allResults.push(
          makeStepResult(stepNum++, 'click', `SKIPPED: ${target.label}`, false, errMsg),
        );
      }
    }

    // 4b. Navigate back to baseUrl for a clean final state
    try {
      const currentTab = await chrome.tabs.get(tabId);
      if (currentTab.url !== plan.baseUrl) {
        await navigateTab(tabId, plan.baseUrl);
        await ensureContentScript(tabId);
      }
    } catch {
      // Best-effort restore
    }

    // 5. Final screenshot
    try {
      const finalDataUrl = await throttledScreenshot(tabId);
      screenshots.push({
        stepNumber: stepNum,
        dataUrl: finalDataUrl,
        timestamp: Date.now(),
        label: 'Final state',
      });
      allResults.push(makeStepResult(stepNum++, 'screenshot', 'Final state', true));
    } catch (err) {
      allResults.push(
        makeStepResult(stepNum++, 'screenshot', 'Final state', false,
          err instanceof Error ? err.message : String(err)),
      );
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[Popcorn] Exploration demo failed:', errMsg);
    allResults.push(makeStepResult(stepNum++, 'navigate', 'Exploration failed', false, errMsg));
    // Stop recorder on error path
    if (recordingAvailable) {
      try { await recorder.stop(); } catch { /* ignore */ }
      recorder.reset();
      recordingAvailable = false;
    }
  }

  // 6. Stop recording and collect video
  let videoMetadata: VideoMetadata | null = null;
  let videoBlob: Blob | null = null;
  if (recordingAvailable) {
    try {
      const { blob, metadata } = await recorder.stop();
      metadata.filename = `exploration-${plan.mode}-${Date.now()}.webm`;
      if (blob.size > 0) {
        videoMetadata = metadata;
        videoBlob = blob;
        console.log(`[Popcorn] Exploration recording stopped, ${blob.size} bytes captured`);
      } else {
        console.warn('[Popcorn] Exploration recording captured 0 bytes, discarding');
      }
    } catch (err) {
      console.warn(
        '[Popcorn] Failed to stop exploration recording:',
        err instanceof Error ? err.message : String(err),
      );
    }
    recorder.reset();
  }

  // 7. Assemble result
  const duration = Date.now() - startTime;
  const passed = allResults.filter((r) => !r.passed).length === 0;
  const summary = passed
    ? `Explored ${plan.targets.length} elements successfully`
    : `Explored ${plan.targets.length} elements with some failures`;

  const demoResult: DemoResult = {
    testPlanId: `exploration-${plan.mode}`,
    passed,
    steps: allResults,
    screenshots,
    duration,
    summary,
    videoMetadata,
  };

  // 8. Save tape
  const testPlanForTape = {
    planName: `exploration-${plan.mode}`,
    description: `${plan.mode} exploration of ${plan.baseUrl}`,
    baseUrl: plan.baseUrl,
    steps: allResults.map((r) => ({
      stepNumber: r.stepNumber,
      action: r.action,
      description: r.description,
    })) as TestStep[],
    tags: ['exploration', plan.mode],
  };

  // Use the first screenshot as thumbnail instead of capturing a new one
  const firstScreenshot = screenshots.length > 0 ? screenshots[0].dataUrl : null;
  await saveTapeAndReload(demoResult, videoBlob, videoMetadata, firstScreenshot, testPlanForTape, testPlanForTape.planName, tabId, deps);

  return demoResult;
}

/**
 * Explores a single element: check actionability → click → observe →
 * screenshot → recover (go_back or dismiss modal).
 */
async function exploreElement(
  target: ExplorationTarget,
  tabId: number,
  startStep: number,
): Promise<{ results: StepResult[]; screenshots: ScreenshotCapture[] }> {
  const results: StepResult[] = [];
  const screenshotCaptures: ScreenshotCapture[] = [];
  let step = startStep;

  // 1. Ensure content script
  await ensureContentScript(tabId);

  // 2. Check actionability
  const actionabilityResult = await sendSingleAction(tabId, {
    stepNumber: step,
    action: 'check_actionability',
    description: `Check ${target.label} is actionable`,
    selector: target.selector,
    selectorFallback: target.selectorFallback,
  });
  results.push(actionabilityResult);
  step++;

  if (!actionabilityResult.passed || actionabilityResult.metadata?.actionable === false) {
    const reason = actionabilityResult.metadata?.reason || 'not actionable';
    console.log(`[Popcorn] Skipping "${target.label}": ${reason}`);
    // Replace the failed check_actionability result with a descriptive skip
    results[results.length - 1] = makeStepResult(
      actionabilityResult.stepNumber, 'check_actionability',
      `Skipped ${target.label} (${reason})`, true,
    );
    return { results, screenshots: screenshotCaptures };
  }

  // 3. Get page state before click
  const pageStateBefore = await sendSingleAction(tabId, {
    stepNumber: step,
    action: 'get_page_state',
    description: 'Record page state before click',
  });
  const urlBefore = (pageStateBefore.metadata?.url as string) || '';
  step++;

  // 4. Click the element
  const clickResult = await sendSingleAction(tabId, {
    stepNumber: step,
    action: 'click',
    description: `Click ${target.label}`,
    selector: target.selector,
    selectorFallback: target.selectorFallback,
  });
  results.push(clickResult);
  step++;

  if (!clickResult.passed) {
    return { results, screenshots: screenshotCaptures };
  }

  // 5. Read what happened
  const urlChanged = clickResult.metadata?.urlChanged as boolean;
  const modalDetected = clickResult.metadata?.modalDetected as { type: string; selector: string; dismissSelector?: string } | null;

  // 6. If URL changed, wait for potential page load
  if (urlChanged && !modalDetected) {
    await waitForTabComplete(tabId, 3000);
    await ensureContentScript(tabId);
  }

  // 7. Screenshot the new state — wait for CSS animations to settle
  await new Promise((r) => setTimeout(r, 300));
  try {
    const dataUrl = await throttledScreenshot(tabId);
    screenshotCaptures.push({
      stepNumber: step,
      dataUrl,
      timestamp: Date.now(),
      label: `After clicking ${target.label}`,
    });
    results.push(makeStepResult(step++, 'screenshot', `After clicking ${target.label}`, true));
  } catch (err) {
    results.push(
      makeStepResult(step++, 'screenshot', `After clicking ${target.label}`, false,
        err instanceof Error ? err.message : String(err)),
    );
  }

  // 8. Dismiss modal if detected (best-effort, never counts as failure)
  if (modalDetected) {
    try {
      await ensureContentScript(tabId);
      const dismissResult = await sendSingleAction(tabId, {
        stepNumber: step,
        action: 'dismiss_modal',
        description: 'Dismiss modal dialog',
      });
      // Only record if dismissal actually did something useful
      if (dismissResult.passed && dismissResult.metadata?.dismissed) {
        results.push(dismissResult);
      }
      step++;
    } catch (err) {
      console.warn('[Popcorn] Modal dismissal failed:', err);
    }
  }

  // 9. If URL changed, go back and verify
  if (urlChanged) {
    try {
      // Check if we landed on an extension or chrome:// page (e.g. PDF viewer)
      const currentTab = await chrome.tabs.get(tabId);
      const currentUrl = currentTab.url || '';
      const isUnscriptable = currentUrl.startsWith('chrome-extension://') ||
        currentUrl.startsWith('chrome://') ||
        currentUrl.startsWith('blob:') ||
        currentUrl.startsWith('about:');
      if (isUnscriptable) {
        // Can't inject content scripts into these pages — navigate directly
        await navigateTab(tabId, urlBefore);
        results.push(makeStepResult(step++, 'navigate', 'Return from extension page', true));
        await ensureContentScript(tabId);
      } else {
        // Normal recovery: go_back, verify, wait
        await goBackTab(tabId);
        results.push(makeStepResult(step++, 'go_back', 'Return via browser back', true));

        await ensureContentScript(tabId);

        // Verify page restored
        const pageStateAfter = await sendSingleAction(tabId, {
          stepNumber: step,
          action: 'get_page_state',
          description: 'Verify page restored',
        });
        step++;

        const urlAfter = pageStateAfter.metadata?.url as string;
        if (urlAfter !== urlBefore) {
          // go_back didn't restore — fallback to direct navigation
          console.warn(`[Popcorn] go_back didn't restore URL (got ${urlAfter}, expected ${urlBefore}), navigating directly`);
          await navigateTab(tabId, urlBefore);
          results.push(makeStepResult(step++, 'navigate', 'Fallback navigate to original page', true));
        }

        // Wait for DOM stability after returning
        await ensureContentScript(tabId);
        await sendSingleAction(tabId, {
          stepNumber: step,
          action: 'wait',
          description: 'Wait for page restore',
          condition: 'domStable',
          timeout: 2000,
        });
        step++;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn('[Popcorn] Recovery after navigation failed:', errMsg);
      // Try hard fallback: navigate directly to original URL
      try {
        await navigateTab(tabId, urlBefore);
        results.push(makeStepResult(step++, 'navigate', `Return to page (${errMsg})`, true));
      } catch {
        results.push(makeStepResult(step++, 'navigate', `Failed to return to page: ${errMsg}`, false));
      }
    }
  }

  return { results, screenshots: screenshotCaptures };
}
