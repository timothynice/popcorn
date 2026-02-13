# Video Recorder Agent Memory

## Project Structure
- Root: `/Users/TimNice/Development/popcorn/`
- Shared types: `shared/src/` (VideoMetadata, DemoResult, ScreenshotCapture, StepResult with metadata, etc.)
- Extension source: `extension/src/` (background, content, capture, storage, popup, __tests__)
- Tests: vitest with jsdom environment for extension tests, node for shared/hook
- Global setup: `extension/vitest.setup.ts` mocks `chrome` global
- Alias: `@popcorn/shared` -> `shared/src/index.ts` (configured in `vitest.config.ts`)

## Key Types (from shared/src/results.ts)
- `VideoMetadata`: filename, duration, fileSize, resolution, mimeType, timestamp
- `DemoResult`: testPlanId, passed, steps, summary, videoMetadata, screenshots, criteriaResults, duration, timestamp
- `StepResult`: stepNumber, action, description, passed, duration, error?, screenshotDataUrl?, timestamp, metadata?
- `TapeRecord` (extension/src/storage/tape-store.ts): id, demoName, testPlanId, timestamp, duration, fileSize, resolution, status, passed, summary, videoBlob, thumbnailDataUrl, results

## Capture Implementation
- `extension/src/capture/recorder.ts`: Recorder class using Chrome Offscreen API + tabCapture + MediaRecorder
- `extension/src/capture/screenshot.ts`: captureScreenshot() using chrome.tabs.captureVisibleTab
- **Offscreen API**: Recording moved to offscreen document to comply with Manifest V3 restrictions. Background service worker creates offscreen document, sends stream via messaging.
- **IndexedDB blob transfer**: Video blobs stored/retrieved via IndexedDB rather than Chrome messaging (avoids size limits)
- MIME type priority: vp9 > vp8 > webm (generic) > browser default
- **No timeslice** on MediaRecorder — call `requestData()` before `stop()` to ensure data is captured
- State machine: idle -> recording -> stopped (or error from any state)
- Badge feedback: REC (red) while recording, ✓ (green) on success, ! (orange) on error

## Storage Implementation
- `extension/src/storage/tape-store.ts`: TapeStore (IndexedDB) + MockTapeStore (in-memory Map)
- IndexedDB name: 'popcorn-tapes', object store: 'tapes', keyPath: 'id'
- MockTapeStore is the test-time substitute since jsdom lacks IndexedDB

## Test Patterns
- Tests use `vi.stubGlobal('chrome', ...)` for Chrome API mocks
- Each test file re-declares its own chrome mock (the setup file provides a baseline)
- MediaRecorder and MediaStream are mocked as classes with `vi.stubGlobal`
- Tests import from `@popcorn/shared` via the vitest alias
- 20 test files, 251 tests total across the monorepo

## Conventions
- TypeScript strict mode, ES modules only
- All imports use `.js` extension suffix (ESM convention)
- JSDoc on public functions
- Test files in `extension/src/__tests__/`
