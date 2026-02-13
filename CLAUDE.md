# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Popcorn is an autonomous UI testing tool combining a Chrome extension and a Claude Code hook. When the AI modifies frontend code, Popcorn automatically runs a visual demo in the browser, captures a video replay, and presents a structured summary. See `popcorn_prd.md` for the full product requirements.

**Status:** Core implementation complete with HTTP bridge and route-aware visual testing. All three packages (shared, extension, hook) are built with 318 passing tests across 24 test files. The hook communicates with the extension via an HTTP bridge server on localhost (ports 7890-7899), with file-based IPC as automatic fallback. The Chrome extension background polls the hook via `chrome.alarms` + `fetch()`, with hook connection status shown in the popup UI. A `popcorn init` CLI scaffolds new projects automatically. Screenshots are captured automatically during demo runs; video recording requires a user gesture via the popup's "Re-run with Recording" button.

## Build & Development Commands

```bash
npm run build    # Build extension and hook
npm run start    # Run extension in dev mode
npm test         # Run unit tests
npm run docs     # Generate documentation
```

After making changes in `extension/` or `hook/`, always run `npm test` and fix failures before proceeding.

## Architecture

The system has two main components that communicate via HTTP bridge (localhost):

```
Claude Code Hook (hook/)          Chrome Extension (extension/)
  │                                  │
  │ watches configured watchDir for   │ content script: injects test
  │ .js/.ts/.jsx/.tsx changes        │   harness, executes batched ops
  │                                  │
  │ BridgeServer on localhost:7890   │ bridge-client.ts polls via fetch()
  │   GET /health (discovery)        │   + chrome.alarms (every ~3s)
  │   GET /poll ──────────────────►  │
  │   POST /result ◄──────────────── │ background: orchestrates demos
  │                                  │
  │ ExtensionClient (HTTP-first,     │ popup UI: React dashboard with
  │  file IPC fallback)              │   hook connection indicator
```

### Directory Layout

- **`shared/`** — Shared TypeScript types and utilities (`@popcorn/shared`): message types, test plan schemas, acceptance criteria, bridge utilities
- **`extension/`** — Chrome extension (Manifest V3): content scripts, background service worker, popup UI, video capture, tape storage
- **`hook/`** — Claude Code hook (Node.js/TypeScript): file watcher, test plan loader/generator, IPC messenger, extension client, `popcorn init` CLI
- **`test-plans/`** — JSON files defining batched browser operations (click, fill, navigate, screenshot)
- **`test-plans/presets/`** — Preset acceptance criteria for common flows (forms, navigation, authentication)
- **`tapes/`** — Video recordings and structured test reports (git-ignored)
- **`src/frontend/`** — Default target directory watched by the hook (configurable via `watchDir` in `popcorn.config.json`)
- **`docs/plans/`** — Implementation plans and architecture documentation

### Data Flow

1. Hook detects file change in the configured watch directory
2. Hook looks for a matching test plan in `test-plans/`; if none found, auto-generates one from the source code
3. Hook enqueues a `start_demo` message on its HTTP bridge server (localhost:7890-7899). Extension's background service worker polls `GET /poll` via `chrome.alarms` + `fetch()` and receives the message. Falls back to file-based IPC (`.popcorn/outbox/`) if HTTP is unavailable.
4. Background handles navigate/wait steps via `chrome.tabs.update`; remaining steps sent to content script for rapid execution
5. Content script captures screenshots via `chrome.runtime.sendMessage` → background `captureVisibleTab`; video recording requires user gesture (available via popup "Re-run with Recording" button)
6. Extension POSTs structured results (with step metadata) back to the hook via `POST /result` on the bridge server
7. Hook evaluates acceptance criteria using pattern-matched evaluators (e.g., "redirects to /dashboard" checks actual URLs)
8. AI parses results, decides whether to iterate or move on

## Tech Stack & Conventions

- **TypeScript** everywhere, strict mode enabled (`strict: true` in tsconfig.json)
- **ES modules** only (import/export, no CommonJS)
- **npm workspaces** monorepo (`shared`, `extension`, `hook`)
- **React 18** for extension popup UI, using built-in state hooks (no third-party state libraries)
- **CSS Modules** (`*.module.css`) with camelCased class names
- **Vite** for extension build (multi-entry: background ES module, content ES module, offscreen ES module, popup React app)
- **Vitest** for testing with `environmentMatchGlobs` (jsdom for extension, node for hook/shared)
- **Chrome Extension Manifest V3**, requires Chrome 123+
- **MediaRecorder API** + Chrome **Offscreen API** + `chrome.tabCapture` for video/screenshot capture
- **IndexedDB** for tape storage (via `TapeStore` class)
- **chokidar** for file watching in the hook with per-file debounce
- **HTTP bridge** (Node.js built-in `http` module, zero deps) on localhost:7890-7899 with token auth for hook↔extension communication
- **File-based IPC** via `.popcorn/outbox/` and `.popcorn/inbox/` JSON files as automatic fallback when HTTP bridge is unavailable
- **`chrome.alarms`** for background service worker keep-alive polling (~3s interval for unpacked extensions)
- Define TypeScript interfaces for all message payloads between hook and extension

## Extension Permissions

Only request: `activeTab`, `tabs`, `storage`, `scripting`, `tabCapture`, `offscreen`, `alarms`. Uses `host_permissions: ["<all_urls>"]` to enable programmatic `captureVisibleTab` and `scripting.executeScript` on any page. All recordings and test data stay local — no external API calls or cloud storage.

## Key Modules

### Shared (`@popcorn/shared`)
- `messages.ts` — `PopcornMessage` union type, `createMessage()`, `isPopcornMessage()` type guard
- `test-plan.ts` — `TestPlan`, `TestStep`, `ActionType` (14 action types: click, fill, navigate, assert, etc.)
- `results.ts` — `DemoResult`, `StepResult` (with optional `metadata` for structured action data), `VideoMetadata`, `ScreenshotCapture`, `CriterionResult`
- `acceptance.ts` — `AcceptanceCriterion`, built-in evaluators (`allStepsPassed`, `noStepErrors`, `completedWithinDuration`), `parsePlainTextCriteria()` with pattern-matched evaluators (duration, URL redirect, error display, form submission, text content), `evaluateAllCriteria()`
- `bridge.ts` — `validateMessage()`, `serializeMessage()`, `deserializeMessage()`
- `tape.ts` — `TapeRecord` type for stored recordings

### Extension
- `content/actions.ts` — `executeAction()` dispatcher for all 14 action types, returns `ActionResult { passed, error?, metadata? }` with structured metadata (URLs, text content, assertion values). Screenshot steps message background for `captureVisibleTab`.
- `content/test-harness.ts` — `executeTestPlan()` batch executor, listens for `execute_plan` messages, promotes `screenshotDataUrl` from metadata
- `background/state.ts` — State machine: idle → running → capturing → complete → error
- `background/demo-flow.ts` — `runFullDemo()` pipeline: handles navigate/wait steps in background, injects content script, executes plan, captures video (when `skipRecording` is false), saves tape with `testPlan` for re-run
- `background/demo-orchestrator.ts` — `handleStartDemo()` orchestration, `assembleDemoResult()` (extracts screenshots from step results)
- `background/external-messaging.ts` — `initExternalMessaging()` for Chrome external messaging
- `background/bridge-client.ts` — `initBridgePolling()`, `discoverHookPort()`, `pollForMessages()`, `sendResult()` — polls hook HTTP server via `chrome.alarms` + `fetch()`
- `background/offscreen-manager.ts` — Manages offscreen document lifecycle for video recording
- `capture/recorder.ts` — `Recorder` class (MediaRecorder + Offscreen API + tabCapture, vp9/vp8)
- `capture/offscreen-recorder.ts` — Offscreen document entry point for MediaRecorder capture
- `capture/screenshot.ts` — `captureScreenshot()` via `chrome.tabs.captureVisibleTab`
- `storage/tape-store.ts` — `TapeStore` (IndexedDB) + `MockTapeStore` (testing). `TapeRecord` includes optional `testPlan` for re-run capability.
- `popup/` — React dashboard with TapeList, TapeCard, TapeDetail (with "Re-run with Recording" button), StatusBar, CriteriaEditor

### Hook
- `watcher.ts` — `Watcher` class (chokidar, debounce, `// popcorn-test` marker detection)
- `messenger.ts` — File-based IPC `Messenger` class (`.popcorn/outbox/` and `.popcorn/inbox/`)
- `bridge-server.ts` — `BridgeServer` class (Node.js `http` module): HTTP server on localhost:7890-7899 with `GET /health`, `GET /poll`, `POST /result`, token auth, CORS
- `extension-client.ts` — `ExtensionClient` with HTTP-first transport (BridgeServer) and automatic file-based IPC fallback (Messenger), `startDemo()` → `Promise<DemoResult>`, `getTransport()` for observability
- `plan-loader.ts` — `loadTestPlan()`, `listTestPlans()` with validation
- `plan-generator.ts` — `generatePlanFromFile()` template-based test plan generator, `detectElements()`, `buildSteps()`, `savePlan()`
- `criteria-loader.ts` — `loadCriteria()` loads acceptance criteria for a test plan
- `import-graph.ts` — Import graph analysis: `detectNavigationControl()`, `resolveNavigationSteps()` for route-aware visual testing
- `logger.ts` — `createLogger()` for prefixed console output (`[Popcorn]`)
- `config.ts` — `PopcornConfig`, `loadConfig()`, `loadConfigFromFile()`, `getDefaultConfig()`
- `commands/init.ts` — `runInit()` CLI scaffolding, `detectWatchDir()`, `scanAndGeneratePlans()`, `mergeClaudeSettings()`
- `cli.ts` — CLI entry point (`npx popcorn init`)
- `claude-hook-runner.ts` — PostToolUse hook entry point, auto-generates plans when no match found
- `index.ts` — `setup()`, `teardown()`, file change handler, plan matching, summary printer

## Getting Started

See `SETUP.md` for full installation and usage instructions.

**One-time setup (Popcorn repo):**
```bash
npm install && npm run build && npm link
```

**Per-project setup:**
```bash
cd ~/my-project
popcorn init    # Scaffolds test-plans/, popcorn.config.json, .claude/settings.local.json
```

The `init` command auto-detects your frontend source directory, scans existing files for interactive elements (forms, inputs, buttons), and generates test plans automatically. If no interactive elements are found, it creates an example login plan as a starting point. The hook runner path in `.claude/settings.local.json` is resolved as an absolute path to the compiled `hook/dist/claude-hook-runner.js`.

## Workflow

- Run `popcorn init` on a new project to scaffold everything in one command
- Test plans are auto-generated when a file changes and no matching plan exists — no need to write JSON by hand
- You can also create custom test plans in `test-plans/` named after the feature (e.g., `login.json`)
- Write acceptance criteria in plain English — patterns like "redirects to /dashboard", "within 500ms", "shows error message", and `shows "Success"` are matched to real evaluators
- After each demo run, structured results include step metadata (actual URLs, text content, assertion values) for precise evaluation
- Files marked with `// popcorn-test` are treated as UI-testable even outside the configured watch directory
- Use preset criteria from `test-plans/presets/` for common flow types (forms, navigation, authentication)
