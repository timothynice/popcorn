/**
 * Full demo flow orchestrator for the Popcorn extension.
 * Coordinates recording, test plan execution via content script,
 * tape storage, and result assembly into a single async pipeline.
 */

import type {
  StartDemoMessage,
  DemoResult,
  VideoMetadata,
} from '@popcorn/shared';
import { Recorder } from '../capture/recorder.js';
import { captureScreenshot } from '../capture/screenshot.js';
import { handleStartDemo } from './demo-orchestrator.js';
import type { TapeStore, TapeRecord } from '../storage/tape-store.js';

export interface DemoFlowDeps {
  /** TapeStore instance for persisting results. Injected for testability. */
  tapeStore: TapeStore | { save: TapeStore['save']; init: TapeStore['init'] };
  /** Optional callback invoked after a tape is saved, e.g. to notify the popup. */
  onTapeSaved?: (tapeId: string) => void;
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

  // 1. Try to start recording (graceful degradation)
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

  // 2. Ensure content script is injected (handles extension reload case
  //    where existing tabs lose their content scripts)
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

  // 3. Execute the test plan via the orchestrator
  let demoResult: DemoResult;
  try {
    demoResult = await handleStartDemo(message, tabId);
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

  // 4. Stop recording and collect video metadata
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

  // 5. Capture a final screenshot for the tape thumbnail
  let thumbnailDataUrl: string | null = null;
  try {
    thumbnailDataUrl = await captureScreenshot(tabId);
  } catch {
    // Thumbnail is optional
  }

  // 6. Save tape record
  try {
    const tapeData: Omit<TapeRecord, 'id'> = {
      demoName: testPlan.planName,
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

  return resultWithVideo;
}
