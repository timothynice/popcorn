# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Popcorn is an autonomous UI testing tool combining a Chrome extension and a Claude Code hook. When the AI modifies frontend code, Popcorn automatically runs a visual demo in the browser, captures a video replay, and presents a structured summary. See `popcorn_prd.md` for the full product requirements.

**Status:** Core implementation complete. All three packages (shared, extension, hook) are built with 135+ passing tests. The Chrome extension has content scripts for action execution, background service worker for orchestration, video capture via tabCapture API, IndexedDB tape storage, and a React popup dashboard. The Claude Code hook watches for file changes, loads test plans, communicates via file-based IPC, and evaluates acceptance criteria.

## Build & Development Commands

```bash
npm run build    # Build extension and hook
npm run start    # Run extension in dev mode
npm test         # Run unit tests
npm run docs     # Generate documentation
```

After making changes in `extension/` or `hook/`, always run `npm test` and fix failures before proceeding.

## Architecture

The system has two main components that communicate via `chrome.runtime` messaging:

```
Claude Code Hook (hook/)          Chrome Extension (extension/)
  │                                  │
  │ watches src/frontend/ for        │ content script: injects test
  │ .js/.ts/.jsx/.tsx changes        │   harness, executes batched ops
  │                                  │
  │ generates test plan JSON ──────► │ background script: manages state,
  │ with acceptance criteria         │   orchestrates demos
  │                                  │
  │ ◄────── structured results ───── │ popup UI: React-based dashboard
  │   (pass/fail, screenshots,       │   for viewing tapes/replays
  │    video metadata, summary)      │
```

### Directory Layout

- **`shared/`** — Shared TypeScript types and utilities (`@popcorn/shared`): message types, test plan schemas, acceptance criteria, bridge utilities
- **`extension/`** — Chrome extension (Manifest V3): content scripts, background service worker, popup UI, video capture, tape storage
- **`hook/`** — Claude Code hook (Node.js/TypeScript): file watcher, test plan loader, IPC messenger, extension client
- **`test-plans/`** — JSON files defining batched browser operations (click, fill, navigate, screenshot)
- **`test-plans/presets/`** — Preset acceptance criteria for common flows (forms, navigation, authentication)
- **`tapes/`** — Video recordings and structured test reports (git-ignored)
- **`src/frontend/`** — Target directory watched by the hook for UI changes
- **`docs/plans/`** — Implementation plans and architecture documentation

### Data Flow

1. Hook detects file change in `src/frontend/`
2. Hook generates a batched test plan (JSON list of browser operations) and packages acceptance criteria
3. Hook sends `start_demo` message to extension via `chrome.runtime` messaging
4. Extension executes operations rapidly (target: 5+ actions/sec), capturing screenshots in memory
5. Extension records video via tab capture API, stores locally (IndexedDB or File System Access API)
6. Extension returns structured results to hook
7. AI parses results, decides whether to iterate or move on

## Tech Stack & Conventions

- **TypeScript** everywhere, strict mode enabled (`strict: true` in tsconfig.json)
- **ES modules** only (import/export, no CommonJS)
- **npm workspaces** monorepo (`shared`, `extension`, `hook`)
- **React 18** for extension popup UI, using built-in state hooks (no third-party state libraries)
- **CSS Modules** (`*.module.css`) with camelCased class names
- **Vite** for extension build (multi-entry: background IIFE, content IIFE, popup React app)
- **Vitest** for testing with `environmentMatchGlobs` (jsdom for extension, node for hook/shared)
- **Chrome Extension Manifest V3**, requires Chrome 123+
- **MediaRecorder API** + `chrome.tabCapture` for video/screenshot capture
- **IndexedDB** for tape storage (via `TapeStore` class)
- **chokidar** for file watching in the hook with per-file debounce
- **File-based IPC** via `.popcorn/outbox/` and `.popcorn/inbox/` JSON files for hook-extension communication
- Define TypeScript interfaces for all message payloads between hook and extension

## Extension Permissions

Only request: `activeTab`, `storage`, `scripting`, `tabCapture`. All recordings and test data stay local — no external API calls or cloud storage.

## Key Modules

### Shared (`@popcorn/shared`)
- `messages.ts` — `PopcornMessage` union type, `createMessage()`, `isPopcornMessage()` type guard
- `test-plan.ts` — `TestPlan`, `TestStep`, `ActionType` (14 action types: click, fill, navigate, assert, etc.)
- `results.ts` — `DemoResult`, `StepResult`, `VideoMetadata`, `ScreenshotCapture`
- `acceptance.ts` — `AcceptanceCriterion`, evaluators (`allStepsPassed`, `noStepErrors`, `completedWithinDuration`), `parsePlainTextCriteria()`
- `bridge.ts` — `validateMessage()`, `serializeMessage()`, `deserializeMessage()`
- `tape.ts` — `TapeRecord` type for stored recordings

### Extension
- `content/actions.ts` — `executeAction()` dispatcher for all 14 action types with element waiting
- `content/test-harness.ts` — `executeTestPlan()` batch executor, listens for `execute_plan` messages
- `background/state.ts` — State machine: idle → running → capturing → complete → error
- `background/demo-orchestrator.ts` — `handleStartDemo()` orchestration, `assembleDemoResult()`
- `background/external-messaging.ts` — `initExternalMessaging()` for hook communication
- `capture/recorder.ts` — `Recorder` class (MediaRecorder + tabCapture, vp9/vp8)
- `capture/screenshot.ts` — `captureScreenshot()` via `chrome.tabs.captureVisibleTab`
- `storage/tape-store.ts` — `TapeStore` (IndexedDB) + `MockTapeStore` (testing)
- `popup/` — React dashboard with TapeList, TapeCard, TapeDetail, StatusBar, CriteriaEditor

### Hook
- `watcher.ts` — `Watcher` class (chokidar, debounce, `// popcorn-test` marker detection)
- `messenger.ts` — File-based IPC `Messenger` class (`.popcorn/outbox/` and `.popcorn/inbox/`)
- `extension-client.ts` — `ExtensionClient` wrapping Messenger with `startDemo()` → `Promise<DemoResult>`
- `plan-loader.ts` — `loadTestPlan()`, `listTestPlans()` with validation
- `config.ts` — `PopcornConfig`, `loadConfig()`, `getDefaultConfig()`
- `index.ts` — `setup()`, `teardown()`, file change handler, plan matching, summary printer

## Workflow

- When adding new UI flows, create a corresponding test plan in `test-plans/` named after the feature (e.g., `login.json`)
- When modifying `src/frontend/`, generate an updated test plan and acceptance criteria
- After each demo run, parse structured results and video metadata; summarize the outcome for the user
- Files marked with `// popcorn-test` are treated as UI-testable even outside `src/frontend/`
- Use preset criteria from `test-plans/presets/` for common flow types (forms, navigation, authentication)
