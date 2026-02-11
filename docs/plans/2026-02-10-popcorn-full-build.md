# Popcorn Full Build Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build Popcorn — an autonomous UI testing tool that combines a Chrome extension and a Claude Code hook to automatically demo, record, and summarise AI-generated UI changes.

**Architecture:** Two independent TypeScript packages (`extension/` and `hook/`) sharing a common types package (`shared/`). The hook watches `src/frontend/` for file changes and sends batched test plans to the extension via `chrome.runtime` messaging. The extension executes browser operations, records video via tab capture, and returns structured results. A React popup provides a "tapes" dashboard.

**Tech Stack:** TypeScript (strict), React 18, Chrome Extension Manifest V3, Vite (bundler), Vitest (testing), CSS Modules, chokidar (file watching)

---

## Phase 1: Project Scaffolding & Shared Types

### Task 1: Initialize project root with package.json and tooling

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.npmrc`
- Create: `vitest.config.ts`

**Step 1: Create root package.json**

```json
{
  "name": "popcorn",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "workspaces": ["shared", "extension", "hook"],
  "scripts": {
    "build": "npm run build --workspaces",
    "start": "npm run start --workspace=extension",
    "test": "vitest run",
    "test:watch": "vitest",
    "docs": "typedoc --entryPointStrategy packages shared extension hook"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^2.0.0",
    "typedoc": "^0.26.0"
  }
}
```

**Step 2: Create tsconfig.base.json**

Shared base config with `strict: true`, `module: "ESNext"`, `target: "ES2022"`, `moduleResolution: "bundler"`.

**Step 3: Create .gitignore**

Include: `node_modules/`, `dist/`, `tapes/`, `.env`, `*.tsbuildinfo`, coverage.

**Step 4: Run `npm install` to bootstrap**

Run: `npm install`
Expected: Installs dev dependencies, creates node_modules and package-lock.json

**Step 5: Commit**

```bash
git add package.json tsconfig.base.json .gitignore .npmrc vitest.config.ts
git commit -m "chore: initialize monorepo with workspaces and tooling"
```

---

### Task 2: Create shared types package

**Files:**
- Create: `shared/package.json`
- Create: `shared/tsconfig.json`
- Create: `shared/src/index.ts`
- Create: `shared/src/messages.ts`
- Create: `shared/src/test-plan.ts`
- Create: `shared/src/results.ts`
- Test: `shared/src/__tests__/messages.test.ts`

**Step 1: Write the failing test for message types**

```typescript
// shared/src/__tests__/messages.test.ts
import { describe, it, expect } from 'vitest';
import type { StartDemoMessage, DemoResultMessage, PopcornMessage } from '../messages.js';

describe('message types', () => {
  it('StartDemoMessage has required fields', () => {
    const msg: StartDemoMessage = {
      type: 'start_demo',
      payload: {
        testPlanId: 'login-flow',
        testPlan: { planName: 'login-flow', steps: [], baseUrl: '/' },
        acceptanceCriteria: ['Page loads without errors'],
        triggeredBy: 'src/frontend/Login.tsx',
      },
      timestamp: Date.now(),
    };
    expect(msg.type).toBe('start_demo');
    expect(msg.payload.testPlanId).toBe('login-flow');
  });

  it('DemoResultMessage has required fields', () => {
    const msg: DemoResultMessage = {
      type: 'demo_result',
      payload: {
        testPlanId: 'login-flow',
        passed: true,
        steps: [],
        summary: 'All steps passed',
        videoMetadata: null,
        screenshots: [],
        duration: 1200,
      },
      timestamp: Date.now(),
    };
    expect(msg.type).toBe('demo_result');
    expect(msg.payload.passed).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run shared/src/__tests__/messages.test.ts`
Expected: FAIL — cannot find module '../messages.js'

**Step 3: Implement shared/src/messages.ts with all message type interfaces**

Define: `PopcornMessage`, `StartDemoMessage`, `DemoResultMessage`, `HookReadyMessage`, `HookErrorMessage`

**Step 4: Implement shared/src/test-plan.ts**

Define: `TestPlan`, `TestStep`, `ActionType` (navigate, click, fill, select, check, hover, scroll, wait, assert, keypress, screenshot), `AssertionType`

**Step 5: Implement shared/src/results.ts**

Define: `DemoResult`, `StepResult`, `VideoMetadata`, `ScreenshotCapture`

**Step 6: Create shared/src/index.ts barrel export**

Re-export all types from messages, test-plan, and results.

**Step 7: Run test to verify it passes**

Run: `npx vitest run shared/src/__tests__/messages.test.ts`
Expected: PASS

**Step 8: Commit**

```bash
git add shared/
git commit -m "feat: add shared types package (messages, test plans, results)"
```

---

## Phase 2: Chrome Extension — Foundation

### Task 3: Scaffold Chrome extension with Manifest V3

**Files:**
- Create: `extension/package.json`
- Create: `extension/tsconfig.json`
- Create: `extension/vite.config.ts`
- Create: `extension/manifest.json`
- Create: `extension/src/background/index.ts`
- Create: `extension/src/content/index.ts`
- Create: `extension/src/popup/index.html`
- Create: `extension/src/popup/App.tsx`
- Create: `extension/src/popup/main.tsx`

**Step 1: Create extension/manifest.json (Manifest V3)**

Permissions: `activeTab`, `storage`, `scripting`, `tabCapture`. Background service worker, content script matching `<all_urls>`, popup action.

**Step 2: Create Vite config for extension build**

Multi-entry build: background script, content script, popup. Output to `extension/dist/`.

**Step 3: Create minimal background service worker**

Listen for `chrome.runtime.onMessage`, log received messages. Placeholder for demo orchestration.

**Step 4: Create minimal content script**

Listen for messages from background, log. Placeholder for test harness injection.

**Step 5: Create popup entry with React mount**

Minimal React app: `<h1>Popcorn</h1>` with status indicator.

**Step 6: Build and verify**

Run: `cd extension && npm run build`
Expected: `dist/` directory with manifest.json, background.js, content.js, popup.html, popup.js

**Step 7: Commit**

```bash
git add extension/
git commit -m "feat: scaffold Chrome extension with Manifest V3"
```

---

### Task 4: Implement background script — demo orchestrator

**Files:**
- Create: `extension/src/background/demo-orchestrator.ts`
- Create: `extension/src/background/state.ts`
- Test: `extension/src/__tests__/demo-orchestrator.test.ts`

**Step 1: Write failing test for demo orchestrator**

Test that receiving a `start_demo` message transitions state from `idle` to `running`, dispatches the test plan to the content script, and returns a `demo_result` message.

**Step 2: Run test to verify it fails**

**Step 3: Implement state machine**

States: `idle` → `running` → `capturing` → `complete` → `idle`. Store current test plan, step index, results.

**Step 4: Implement demo orchestrator**

Receives `start_demo`, stores plan in state, sends steps to content script one-by-one (or batched), collects results, assembles `DemoResultMessage`.

**Step 5: Run test to verify it passes**

**Step 6: Commit**

```bash
git commit -m "feat: implement demo orchestrator state machine in background script"
```

---

### Task 5: Implement content script — test harness

**Files:**
- Create: `extension/src/content/test-harness.ts`
- Create: `extension/src/content/actions.ts`
- Test: `extension/src/__tests__/test-harness.test.ts`
- Test: `extension/src/__tests__/actions.test.ts`

**Step 1: Write failing test for action executor**

Test `executeAction({ action: 'click', selector: '#btn' })` returns a `StepResult` with `passed: true` when element exists, and `passed: false` with error message when it doesn't.

**Step 2: Run test to verify it fails**

**Step 3: Implement actions.ts**

Action handlers for each `ActionType`: navigate (window.location), click (querySelector + click), fill (querySelector + value + input event), assert (check conditions), screenshot (html2canvas or placeholder), wait (setTimeout/MutationObserver), select, check, hover, scroll, keypress.

Each handler:
- Takes a `TestStep`
- Returns a `StepResult` with timing, passed/failed, optional screenshot, error message
- Has a timeout (default 5s per action)

**Step 4: Write failing test for test harness batch execution**

Test that `executeTestPlan(plan)` runs all steps in sequence, collecting results, and stops early on critical failures.

**Step 5: Implement test-harness.ts**

Receives batched plan from background, executes actions sequentially via `actions.ts`, captures timing, returns collected `StepResult[]`.

Target: 5+ actions per second (200ms budget per action unless waiting).

**Step 6: Run all tests to verify they pass**

**Step 7: Commit**

```bash
git commit -m "feat: implement content script test harness with batched action execution"
```

---

## Phase 3: Chrome Extension — Video Capture & Storage

### Task 6: Implement video capture via tab capture API

**Files:**
- Create: `extension/src/capture/recorder.ts`
- Create: `extension/src/capture/screenshot.ts`
- Test: `extension/src/__tests__/recorder.test.ts`

**Step 1: Write failing test for recorder lifecycle**

Test: `Recorder` class transitions through states: `idle` → `recording` → `stopped`. Start returns a promise. Stop returns a `Blob`. Handles errors gracefully.

**Step 2: Run test to verify it fails**

**Step 3: Implement recorder.ts**

- Use `chrome.tabCapture.capture()` to get MediaStream
- Create `MediaRecorder` with `video/webm; codecs=vp9` (fallback to vp8)
- Chunked recording via `timeslice: 1000`
- Collect chunks in array, assemble Blob on stop
- Return `VideoMetadata`: duration, resolution, fileSize, mimeType

**Step 4: Implement screenshot.ts**

- Capture visible tab via `chrome.tabs.captureVisibleTab()`
- Return base64 PNG data
- Include timestamp and step number in metadata

**Step 5: Run tests**

**Step 6: Commit**

```bash
git commit -m "feat: implement tab capture video recording and screenshot capture"
```

---

### Task 7: Implement local storage for tapes

**Files:**
- Create: `extension/src/storage/tape-store.ts`
- Create: `extension/src/storage/types.ts`
- Test: `extension/src/__tests__/tape-store.test.ts`

**Step 1: Write failing test for tape storage**

Test: `TapeStore.save(recording)` stores blob + metadata in IndexedDB. `TapeStore.list()` returns all tapes sorted by timestamp. `TapeStore.get(id)` retrieves a specific tape. `TapeStore.delete(id)` removes a tape.

**Step 2: Run test to verify it fails**

**Step 3: Implement tape-store.ts**

- Use IndexedDB (via `idb` library or raw API) with object store `tapes`
- Schema: `{ id, demoName, timestamp, duration, fileSize, resolution, status, videoBlob, thumbnailBlob, screenshots, testPlanId, results }`
- Generate thumbnail from video blob (grab frame at 2s or 25%)
- CRUD operations: save, list, get, delete
- Storage quota check before save

**Step 4: Run tests**

**Step 5: Commit**

```bash
git commit -m "feat: implement IndexedDB tape storage with CRUD operations"
```

---

## Phase 4: Chrome Extension — Popup UI (Tapes Dashboard)

### Task 8: Build tapes dashboard popup

**Files:**
- Create: `extension/src/popup/components/TapeList.tsx`
- Create: `extension/src/popup/components/TapeCard.tsx`
- Create: `extension/src/popup/components/TapeDetail.tsx`
- Create: `extension/src/popup/components/StatusBar.tsx`
- Create: `extension/src/popup/hooks/useTapes.ts`
- Create: `extension/src/popup/hooks/useExtensionState.ts`
- Create: `extension/src/popup/App.module.css`
- Create: `extension/src/popup/components/TapeCard.module.css`
- Create: `extension/src/popup/components/TapeDetail.module.css`
- Modify: `extension/src/popup/App.tsx`
- Test: `extension/src/__tests__/popup/TapeList.test.tsx`

**Step 1: Write failing test for TapeList**

Test: renders tape cards from useTapes hook data. Shows "No tapes yet" when empty. Shows loading state.

**Step 2: Run test to verify it fails**

**Step 3: Implement useTapes hook**

Custom hook that calls `TapeStore.list()`, manages loading/error state, provides `tapes`, `isLoading`, `error`, `refresh`.

**Step 4: Implement TapeCard component**

Displays: thumbnail, demo name, timestamp, duration, pass/fail badge, file size. Click navigates to detail view.

**Step 5: Implement TapeDetail component**

Displays: video player (from Blob URL), step-by-step results list with pass/fail icons, screenshots gallery, acceptance criteria checklist, summary text.

**Step 6: Implement StatusBar component**

Shows current extension state: idle, recording, processing. Shows connected/disconnected status.

**Step 7: Wire up App.tsx**

Simple routing: list view ↔ detail view via state. StatusBar at top, TapeList as main content.

**Step 8: Run tests**

**Step 9: Build and verify visually**

Run: `cd extension && npm run build`
Load unpacked extension in Chrome, verify popup renders.

**Step 10: Commit**

```bash
git commit -m "feat: build tapes dashboard popup with list, detail, and status views"
```

---

## Phase 5: Claude Code Hook

### Task 9: Scaffold hook package

**Files:**
- Create: `hook/package.json`
- Create: `hook/tsconfig.json`
- Create: `hook/src/index.ts`
- Create: `hook/src/watcher.ts`
- Create: `hook/src/config.ts`
- Test: `hook/src/__tests__/watcher.test.ts`

**Step 1: Write failing test for file watcher**

Test: watcher emits `file-changed` events for `.ts`, `.tsx`, `.js`, `.jsx` files in watched directory. Ignores `node_modules`. Debounces rapid changes (300ms). Detects `// popcorn-test` marked files outside watched dir.

**Step 2: Run test to verify it fails**

**Step 3: Implement config.ts**

```typescript
export interface PopcornConfig {
  watchDir: string;        // default: 'src/frontend'
  extensions: string[];    // default: ['.js', '.ts', '.jsx', '.tsx']
  debounceMs: number;      // default: 300
  ignorePatterns: string[]; // default: ['node_modules', '.git', 'dist']
}
```

**Step 4: Implement watcher.ts**

- Use `chokidar` to watch `config.watchDir`
- Filter by configured extensions
- Debounce events per-file (300ms)
- Emit structured events: `{ type: 'file-changed', filePath, timestamp }`
- Support `// popcorn-test` detection: on change events outside watch dir, read first 5 lines to check for marker comment

**Step 5: Run tests**

**Step 6: Commit**

```bash
git commit -m "feat: implement file watcher with debouncing and popcorn-test detection"
```

---

### Task 10: Implement hook messaging and test plan dispatch

**Files:**
- Create: `hook/src/messenger.ts`
- Create: `hook/src/plan-loader.ts`
- Modify: `hook/src/index.ts`
- Test: `hook/src/__tests__/messenger.test.ts`
- Test: `hook/src/__tests__/plan-loader.test.ts`

**Step 1: Write failing test for plan loader**

Test: `loadTestPlan('login')` reads `test-plans/login.json`, validates schema, returns parsed `TestPlan`. Returns error for missing/invalid files.

**Step 2: Run test to verify it fails**

**Step 3: Implement plan-loader.ts**

- Read JSON from `test-plans/` directory
- Validate against `TestPlan` schema from shared types
- Return parsed plan or throw descriptive error

**Step 4: Write failing test for messenger**

Test: `sendStartDemo(plan, criteria)` constructs a valid `StartDemoMessage` and sends it. `onDemoResult(callback)` receives and parses `DemoResultMessage`.

**Step 5: Implement messenger.ts**

- Use `chrome.runtime.sendMessage` (when running as extension) or native messaging (when running as CLI hook)
- For v1: communicate via a local WebSocket or file-based IPC (write JSON to a known path, extension polls or watches)
- Construct `StartDemoMessage` from test plan + acceptance criteria
- Parse `DemoResultMessage` responses

**Step 6: Wire up index.ts — main hook entry point**

```
1. Initialize watcher
2. On file change:
   a. Determine which test plan to use (match by filename/directory)
   b. Load test plan
   c. Send start_demo to extension
   d. Wait for demo_result
   e. Print structured summary to console
3. Handle errors, cleanup on exit
```

**Step 7: Run all tests**

**Step 8: Commit**

```bash
git commit -m "feat: implement hook messaging and test plan dispatch"
```

---

## Phase 6: Integration — Hook ↔ Extension Communication

### Task 11: Implement native messaging bridge

**Files:**
- Create: `shared/src/bridge.ts`
- Create: `extension/src/background/native-messaging.ts`
- Create: `hook/src/extension-client.ts`
- Modify: `extension/manifest.json` (add `externally_connectable` or native messaging host)
- Test: `shared/src/__tests__/bridge.test.ts`

**Step 1: Write failing test for bridge protocol**

Test: messages serialise/deserialise correctly. Validates message schema. Handles malformed messages gracefully.

**Step 2: Run test to verify it fails**

**Step 3: Implement bridge.ts in shared**

- Message validation function: `validateMessage(unknown): PopcornMessage | Error`
- Serialise/deserialise helpers with schema checking
- Connection handshake protocol: hook sends `hook_ready`, extension responds `extension_ready`

**Step 4: Implement extension native messaging listener**

In background script: listen for external connections, validate messages, route `start_demo` to orchestrator, send `demo_result` back.

**Step 5: Implement hook extension client**

Connect to extension via `chrome.runtime.connect` (if available) or fallback to WebSocket/file-based IPC. Send messages, receive responses.

**Step 6: Run integration test**

Verify: hook sends `start_demo` → extension receives it → runs demo → returns `demo_result` → hook receives it.

**Step 7: Commit**

```bash
git commit -m "feat: implement native messaging bridge between hook and extension"
```

---

## Phase 7: Acceptance Criteria System

### Task 12: Implement acceptance criteria engine

**Files:**
- Create: `shared/src/acceptance.ts`
- Create: `extension/src/evaluation/evaluator.ts`
- Create: `test-plans/presets/forms.json`
- Create: `test-plans/presets/navigation.json`
- Create: `test-plans/presets/authentication.json`
- Test: `shared/src/__tests__/acceptance.test.ts`
- Test: `extension/src/__tests__/evaluator.test.ts`

**Step 1: Write failing test for acceptance criteria parsing**

Test: parse plain-text criteria like `"Page loads without console errors"` into structured `AcceptanceCriterion` objects with `type`, `description`, and `evaluator` function.

**Step 2: Run test to verify it fails**

**Step 3: Implement acceptance.ts**

```typescript
export interface AcceptanceCriterion {
  id: string;
  description: string;
  type: 'visual' | 'functional' | 'performance' | 'accessibility';
  evaluate: (stepResults: StepResult[]) => CriterionResult;
}

export interface CriterionResult {
  criterionId: string;
  passed: boolean;
  message: string;
  evidence?: string; // screenshot ref or step ref
}
```

Built-in evaluators: `noConsoleErrors`, `allStepsPassed`, `pageLoaded`, `elementVisible`, `urlMatches`, `responseTime`.

**Step 4: Create preset JSON files**

Forms preset: validates inputs have labels, required fields filled, form submits, success message shown.
Navigation preset: all links resolve, no 404s, breadcrumbs correct.
Authentication preset: login succeeds, session persists, logout works.

**Step 5: Write failing test for evaluator**

Test: `evaluate(stepResults, criteria)` returns structured results — which criteria passed, which failed, overall pass/fail.

**Step 6: Implement evaluator.ts**

Run each criterion against step results, collect results, determine overall pass/fail.

**Step 7: Run tests**

**Step 8: Commit**

```bash
git commit -m "feat: implement acceptance criteria engine with presets"
```

---

## Phase 8: Popup UI — Acceptance Criteria Editor

### Task 13: Add criteria editor to popup

**Files:**
- Create: `extension/src/popup/components/CriteriaEditor.tsx`
- Create: `extension/src/popup/components/CriteriaEditor.module.css`
- Create: `extension/src/popup/components/PresetSelector.tsx`
- Modify: `extension/src/popup/App.tsx`
- Test: `extension/src/__tests__/popup/CriteriaEditor.test.tsx`

**Step 1: Write failing test**

Test: CriteriaEditor renders text area for custom criteria. PresetSelector shows available presets. Selecting a preset populates criteria. Save button stores to chrome.storage.

**Step 2: Implement CriteriaEditor**

Plain-text editor (textarea) for writing acceptance criteria. Shows active criteria count. Save/load from `chrome.storage.local`.

**Step 3: Implement PresetSelector**

Dropdown/chip selector for presets (forms, navigation, authentication). Loading presets from `test-plans/presets/`.

**Step 4: Integrate into App.tsx**

Add tab/view for criteria management alongside tapes dashboard.

**Step 5: Run tests, build, verify**

**Step 6: Commit**

```bash
git commit -m "feat: add acceptance criteria editor and preset selector to popup"
```

---

## Phase 9: End-to-End Integration & Polish

### Task 14: Wire up the full demo flow end-to-end

**Files:**
- Modify: `extension/src/background/demo-orchestrator.ts`
- Modify: `extension/src/content/test-harness.ts`
- Modify: `hook/src/index.ts`
- Create: `test-plans/example-login.json`
- Create: `src/frontend/example/LoginPage.tsx` (sample target)
- Test: `extension/src/__tests__/integration/full-flow.test.ts`

**Step 1: Create example test plan**

`test-plans/example-login.json` with navigate, fill email, fill password, click submit, assert redirect.

**Step 2: Create example target page**

Minimal React login page in `src/frontend/example/` for testing the full flow.

**Step 3: Wire orchestrator to use recorder + evaluator**

Background script: on `start_demo` → start recording → send plan to content → collect results → stop recording → evaluate criteria → save tape → send `demo_result`.

**Step 4: Wire hook to print structured summary**

On receiving `demo_result`: print pass/fail, step details, video file reference, criteria results.

**Step 5: Run full integration test**

Verify: file change detected → plan loaded → demo started → actions executed → video recorded → results evaluated → tape saved → summary printed.

**Step 6: Commit**

```bash
git commit -m "feat: wire up end-to-end demo flow with recording and evaluation"
```

---

### Task 15: Add recording timeline annotations

**Files:**
- Create: `extension/src/capture/annotator.ts`
- Modify: `extension/src/popup/components/TapeDetail.tsx`
- Test: `extension/src/__tests__/annotator.test.ts`

**Step 1: Write failing test for annotator**

Test: `createAnnotations(stepResults, videoDuration)` returns timeline markers with timestamps, descriptions, and pass/fail indicators.

**Step 2: Implement annotator**

Map step results to video timeline positions. Each annotation: `{ time: number, label: string, type: 'action' | 'assertion' | 'failure', stepNumber: number }`.

**Step 3: Update TapeDetail to show annotations**

Render timeline markers below video player. Clicking a marker seeks video to that timestamp. Failures are highlighted in red.

**Step 4: Run tests, build, verify**

**Step 5: Commit**

```bash
git commit -m "feat: add recording timeline annotations with step markers"
```

---

### Task 16: Final polish and error handling

**Files:**
- Modify: various files across extension/ and hook/
- Create: `extension/src/utils/error-handler.ts`
- Create: `hook/src/utils/logger.ts`

**Step 1: Add global error handler to extension**

Catch unhandled errors in background/content scripts. Log to console, send error notifications to popup.

**Step 2: Add structured logger to hook**

Log levels: debug, info, warn, error. Prefix with `[popcorn]`. Structured JSON output for machine parsing.

**Step 3: Add connection status handling**

Popup shows clear status when hook is connected/disconnected. Retry logic for dropped connections.

**Step 4: Run full test suite**

Run: `npm test`
Expected: ALL PASS

**Step 5: Build everything**

Run: `npm run build`
Expected: Clean build, no warnings

**Step 6: Commit**

```bash
git commit -m "feat: add error handling, logging, and connection status"
```

---

## Phase 10: Documentation & Shipping

### Task 17: Update CLAUDE.md and create README

**Files:**
- Modify: `CLAUDE.md` (update status from scaffolding to complete)
- Create: `extension/README.md`
- Create: `hook/README.md`

**Step 1: Update CLAUDE.md**

Change status to "v1 complete". Update build commands if needed. Add any new conventions discovered during implementation.

**Step 2: Create extension README**

Installation instructions, development setup, how to load unpacked extension, architecture overview.

**Step 3: Create hook README**

Installation, configuration options, how the file watcher works, how to add custom test plans.

**Step 4: Commit**

```bash
git commit -m "docs: update CLAUDE.md and add package READMEs"
```

---

## Agent Mapping

Each task maps to a primary agent:

| Task | Primary Agent | Support Agent |
|------|--------------|---------------|
| 1-2 (Scaffolding) | general-purpose | — |
| 3-5 (Extension foundation) | ui-extension-implementer | — |
| 6-7 (Video & storage) | video-recorder | — |
| 8 (Popup UI) | ui-extension-implementer | — |
| 9-10 (Hook) | hook-implementer | — |
| 11 (Bridge) | hook-implementer | ui-extension-implementer |
| 12 (Acceptance) | test-plan-generator | — |
| 13 (Criteria UI) | ui-extension-implementer | — |
| 14 (E2E integration) | general-purpose | all agents for review |
| 15 (Annotations) | video-recorder | ui-extension-implementer |
| 16 (Polish) | general-purpose | bug-summariser |
| 17 (Docs) | general-purpose | — |

## Parallelisation Opportunities

These task groups can run in parallel:
- **Tasks 3-5** (extension) and **Tasks 9-10** (hook) — independent packages
- **Task 6** (video capture) and **Task 8** (popup UI) — independent subsystems
- **Task 12** (acceptance engine) and **Task 13** (criteria UI) — after shared types exist

## Verification Checkpoints

After each phase, run:
1. `npm test` — all tests pass
2. `npm run build` — clean build
3. Code review agent validates against PRD
4. Manual verification in Chrome (load unpacked extension)
