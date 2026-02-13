# Hook Implementer Memory

## Project Structure
- Monorepo with npm workspaces: `shared`, `extension`, `hook`
- Shared types at `shared/src/` (TestPlan, PopcornMessage, DemoResult, StepResult with metadata, etc.)
- Root vitest config at `vitest.config.ts` includes `hook/**/*.test.ts`
- TypeScript strict mode, ES modules, `tsconfig.base.json` at root
- chokidar v3.6 used for file watching (declared in hook/package.json)

## Hook Architecture
- `hook/src/config.ts` - PopcornConfig interface + getDefaultConfig/loadConfig/loadConfigFromFile (reads popcorn.config.json)
- `hook/src/watcher.ts` - Watcher class using chokidar with per-file debounce
- `hook/src/plan-loader.ts` - loadTestPlan/listTestPlans with validation
- `hook/src/plan-generator.ts` - Template-based test plan generator: generatePlanFromFile(), detectElements(), buildSteps(), savePlan(). Regex heuristics for forms/inputs/buttons/links. No API key needed.
- `hook/src/messenger.ts` - File-based IPC via `.popcorn/outbox/` and `.popcorn/inbox/`
- `hook/src/bridge-server.ts` - HTTP bridge server (Node http module, zero deps). BridgeServer class with /health, /poll, /result routes. Token auth, CORS, port range 7890-7899.
- `hook/src/extension-client.ts` - ExtensionClient: HTTP-first (BridgeServer) with file-based (Messenger) fallback. Writes .popcorn/bridge.json for discovery. getTransport() returns 'http' or 'file'.
- `hook/src/logger.ts` - Structured logger: createLogger(prefix, minLevel?)
- `hook/src/claude-hook-runner.ts` - PostToolUse hook entry point. Auto-generates plans when no match found.
- `hook/src/commands/init.ts` - `popcorn init` CLI: runInit(), detectWatchDir(), scanAndGeneratePlans(), mergeClaudeSettings()
- `hook/src/cli.ts` - CLI entry point (npx popcorn init)
- `hook/src/index.ts` - Main entry: setup/teardown using ExtensionClient + acceptance eval

## HTTP Bridge Architecture
- `BridgeServer` uses Node.js built-in `http` module (no Express/external deps)
- Routes: GET /health (no auth, returns port+token), GET /poll (drains queue, requires token), POST /result (receives PopcornMessage, requires token)
- Auth: X-Popcorn-Token header with crypto.randomBytes(16).toString('hex')
- CORS: Allow-Origin *, Allow-Headers Content-Type + X-Popcorn-Token, Allow-Methods GET/POST/OPTIONS
- Port discovery: tries preferredPort through preferredPort+9, binds 127.0.0.1 only
- ExtensionClient.connect() tries HTTP first, falls back to file IPC on failure
- bridge.json written to .popcorn/bridge.json: { port, token, pid, startedAt }
- bridge.json cleaned up on disconnect

## Extension Architecture
- `extension/src/background/index.ts` - Background service worker, integration hub
- `extension/src/background/demo-flow.ts` - runFullDemo() orchestrating record/execute/save
- `extension/src/background/demo-orchestrator.ts` - handleStartDemo() for content script exec
- `extension/src/background/external-messaging.ts` - initExternalMessaging()
- `extension/src/background/state.ts` - State machine (idle/running/capturing/complete/error)
- `extension/src/storage/tape-store.ts` - TapeStore (IndexedDB) + MockTapeStore (in-memory)
  - NOTE: TapeRecord in tape-store.ts differs from shared TapeRecord (has videoBlob, thumbnailDataUrl, etc.)
- `extension/src/capture/recorder.ts` - Recorder using MediaRecorder + Offscreen API + tabCapture

## Shared Types
- `StepResult` now has optional `metadata?: Record<string, unknown>` for structured action data
- `acceptance.ts` has `CRITERION_PATTERNS[]` - priority-ordered regex -> evaluator factory array
- `ActionResult` interface in `extension/src/content/actions.ts`: `{ passed, error?, metadata? }`

## Shared Type Imports
```typescript
// Hook modules use alias (resolved by vitest.config.ts):
import type { TestPlan, PopcornMessage } from '@popcorn/shared';
// Extension modules use the same alias:
import type { TestPlan, PopcornMessage } from '@popcorn/shared';
```

## Testing Patterns
- Tests use vitest with globals enabled
- Extension tests: jsdom environment, chrome mock in extension/vitest.setup.ts
- Hook tests: node environment, real filesystem with temp dirs
- Watcher tests: use fs.mkdtempSync for real temp dirs, sleep() for debounce timing
- Plan-loader tests: temp dir with fixture JSON files
- Plan-generator tests: inline source code strings, temp dir for savePlan()
- Init tests: temp dir with source files to test scanAndGeneratePlans()
- Messenger tests: temp dir with .popcorn/inbox and .popcorn/outbox subdirs
- Config tests: temp dir for loadConfigFromFile, pure unit tests for loadConfig
- Bridge-server tests: unique ports per test (18900+), afterEach stops all servers, uses fetch()
- Extension-client tests: unique ports (19100+), tests HTTP connect, fallback, bridge.json lifecycle, polling
- Integration tests: use HTTP bridge (19200+), poll via fetch, post results via fetch
- Demo-flow tests: mock chrome.tabCapture, chrome.tabs.sendMessage, MediaRecorder

## Known Issues
- Extension tests have pre-existing stderr: jsdom navigation not implemented, chrome mock limitations
- These are not test failures, just warnings
- Stale `.js`/`.d.ts` files in `shared/src/` shadow `.ts` sources -- delete them if vitest uses old code

## Key Conventions
- All files use .js extension in imports (ESM)
- Shared package: `"main": "./dist/index.js"`, vitest alias points to `shared/src/index.ts`
- Watcher debounce default: 300ms, test debounce: 50ms
- Messenger poll interval default: 500ms, test poll interval: 50ms
- Bridge default port: 7890, config field: bridgePort
- Logger uses [popcorn:<prefix>] format, controlled by POPCORN_LOG_LEVEL env var
- Auto-generated plans tagged `['auto-generated']`
- 21 test files, 267 tests total
