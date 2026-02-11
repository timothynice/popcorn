# Video Recorder Agent Memory

## Project Structure
- Root: `/Users/TimNice/Development/popcorn/`
- Shared types: `shared/src/` (VideoMetadata, DemoResult, ScreenshotCapture, etc.)
- Extension source: `extension/src/` (background, content, capture, storage, popup, __tests__)
- Tests: vitest with jsdom environment for extension tests, node for shared/hook
- Global setup: `extension/vitest.setup.ts` mocks `chrome` global
- Alias: `@popcorn/shared` -> `shared/src/index.ts` (configured in `vitest.config.ts`)

## Key Types (from shared/src/results.ts)
- `VideoMetadata`: filename, duration, fileSize, resolution, mimeType, timestamp
- `DemoResult`: testPlanId, passed, steps, summary, videoMetadata, screenshots, duration, timestamp
- `TapeRecord` (extension/src/storage/tape-store.ts): id, demoName, testPlanId, timestamp, duration, fileSize, resolution, status, passed, summary, videoBlob, thumbnailDataUrl, results

## Capture Implementation
- `extension/src/capture/recorder.ts`: Recorder class using chrome.tabCapture + MediaRecorder
- `extension/src/capture/screenshot.ts`: captureScreenshot() using chrome.tabs.captureVisibleTab
- MIME type priority: vp9 > vp8 > webm (generic) > browser default
- Timeslice: 1000ms for chunked recording
- State machine: idle -> recording -> stopped (or error from any state)

## Storage Implementation
- `extension/src/storage/tape-store.ts`: TapeStore (IndexedDB) + MockTapeStore (in-memory Map)
- IndexedDB name: 'popcorn-tapes', object store: 'tapes', keyPath: 'id'
- MockTapeStore is the test-time substitute since jsdom lacks IndexedDB

## Test Patterns
- Tests use `vi.stubGlobal('chrome', ...)` for Chrome API mocks
- Each test file re-declares its own chrome mock (the setup file provides a baseline)
- MediaRecorder and MediaStream are mocked as classes with `vi.stubGlobal`
- Tests import from `@popcorn/shared` via the vitest alias

## Conventions
- TypeScript strict mode, ES modules only
- All imports use `.js` extension suffix (ESM convention)
- JSDoc on public functions
- Test files in `extension/src/__tests__/`
