# Hook Implementer Memory

## Project Structure
- Monorepo with npm workspaces: `shared`, `extension`, `hook`
- Shared types at `shared/src/` (TestPlan, PopcornMessage, DemoResult, etc.)
- Root vitest config at `vitest.config.ts` includes `hook/**/*.test.ts`
- TypeScript strict mode, ES modules, `tsconfig.base.json` at root
- chokidar v3.6 used for file watching (declared in hook/package.json)

## Hook Architecture
- `hook/src/config.ts` - PopcornConfig interface + getDefaultConfig/loadConfig
- `hook/src/watcher.ts` - Watcher class using chokidar with per-file debounce
- `hook/src/plan-loader.ts` - loadTestPlan/listTestPlans with validation
- `hook/src/messenger.ts` - File-based IPC via `.popcorn/outbox/` and `.popcorn/inbox/`
- `hook/src/extension-client.ts` - ExtensionClient wrapping Messenger with startDemo()
- `hook/src/logger.ts` - Structured logger: createLogger(prefix, minLevel?)
- `hook/src/index.ts` - Main entry: setup/teardown using ExtensionClient + acceptance eval

## Extension Architecture
- `extension/src/background/index.ts` - Background service worker, integration hub
- `extension/src/background/demo-flow.ts` - runFullDemo() orchestrating record/execute/save
- `extension/src/background/demo-orchestrator.ts` - handleStartDemo() for content script exec
- `extension/src/background/external-messaging.ts` - initExternalMessaging()
- `extension/src/background/state.ts` - State machine (idle/running/capturing/complete/error)
- `extension/src/storage/tape-store.ts` - TapeStore (IndexedDB) + MockTapeStore (in-memory)
  - NOTE: TapeRecord in tape-store.ts differs from shared TapeRecord (has videoBlob, thumbnailDataUrl, etc.)
- `extension/src/capture/recorder.ts` - Recorder using MediaRecorder + tabCapture

## Shared Type Imports
```typescript
// Hook modules use relative paths:
import type { TestPlan, PopcornMessage } from '../../shared/src/index.js';
// Extension modules use alias:
import type { TestPlan, PopcornMessage } from '@popcorn/shared';
```

## Testing Patterns
- Tests use vitest with globals enabled
- Extension tests: jsdom environment, chrome mock in extension/vitest.setup.ts
- Hook tests: node environment, real filesystem with temp dirs
- Watcher tests: use fs.mkdtempSync for real temp dirs, sleep() for debounce timing
- Plan-loader tests: temp dir with fixture JSON files
- Messenger tests: temp dir with .popcorn/inbox and .popcorn/outbox subdirs
- Config tests: pure unit tests, no filesystem needed
- Demo-flow tests: mock chrome.tabCapture, chrome.tabs.sendMessage, MediaRecorder
- Integration tests: real Messenger+ExtensionClient, simulated inbox responses

## Known Issues
- Extension tests have pre-existing stderr: jsdom navigation not implemented, chrome mock limitations
- These are not test failures, just warnings

## Key Conventions
- All files use .js extension in imports (ESM)
- Shared package uses `"main": "./src/index.ts"` (source, not compiled)
- Watcher debounce default: 300ms, test debounce: 50ms
- Messenger poll interval default: 500ms, test poll interval: 50ms
- Logger uses [popcorn:<prefix>] format, controlled by POPCORN_LOG_LEVEL env var
- 18 test files, 171 tests total (as of Phase 9 completion)
