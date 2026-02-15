# Popcorn Hook — Developer Reference

The hook is the Node.js half of Popcorn. It fires automatically when Claude Code edits a frontend file, finds (or generates) a test plan, dispatches it to the Chrome extension, and prints a structured result summary.

---

## File Map

| File | Purpose |
|------|---------|
| `hook/src/claude-hook-runner.ts` | PostToolUse hook entry point — reads stdin, dispatches demo |
| `hook/src/cli.ts` | CLI entry (`popcorn init`, `popcorn serve`) |
| `hook/src/commands/init.ts` | Project scaffolding (`runInit()`) |
| `hook/src/commands/serve.ts` | Persistent bridge server daemon (`runServe()`) |
| `hook/src/bridge-server.ts` | HTTP server on localhost:7890-7899 |
| `hook/src/extension-client.ts` | Hook→Extension transport (HTTP-first, file IPC fallback) |
| `hook/src/watcher.ts` | chokidar file watcher with per-file debounce |
| `hook/src/config.ts` | `PopcornConfig` type, `loadConfig()`, `loadConfigFromFile()` |
| `hook/src/plan-generator.ts` | Auto-generate test plans from source file analysis |
| `hook/src/plan-loader.ts` | Load/list test plans from `test-plans/` |
| `hook/src/criteria-loader.ts` | Load acceptance criteria for a test plan |
| `hook/src/import-graph.ts` | Route-aware component analysis for visual testing |
| `hook/src/messenger.ts` | File-based IPC fallback (`.popcorn/outbox/` + `inbox/`) |
| `hook/src/logger.ts` | Prefixed logger, controlled by `POPCORN_LOG_LEVEL` |
| `hook/src/index.ts` | `setup()` / `teardown()` — watcher + client lifecycle |

---

## Setup

### One-time (Popcorn repo)

```bash
cd ~/Development/popcorn
npm install && npm run build && npm link
```

This registers the `popcorn` CLI globally via the root `package.json` bin entry:
```json
{ "bin": { "popcorn": "./hook/dist/cli.js" } }
```

### Per-project

```bash
cd ~/my-project
popcorn init
```

`popcorn init` does four things:

1. **Detects the watch directory** — checks candidates in order: `src/frontend`, `src/components`, `src/pages`, `src/views`, `src/app`, `app`, `pages`, `components`, `src`. Falls back to `src/frontend`.

2. **Creates `test-plans/`** — scans the watch directory for source files (up to 50), detects interactive elements (forms, inputs, buttons, links), and generates test plans. If nothing is found, writes an example `example-login.json`.

3. **Creates `popcorn.config.json`**:
   ```json
   { "watchDir": "src", "testPlansDir": "test-plans", "baseUrl": "http://localhost:3000" }
   ```

4. **Creates/merges `.claude/settings.local.json`** — adds the PostToolUse hook:
   ```json
   {
     "hooks": {
       "PostToolUse": [
         {
           "matcher": "Edit|Write",
           "hooks": [
             {
               "type": "command",
               "command": "node /absolute/path/to/hook/dist/claude-hook-runner.js",
               "timeout": 30,
               "async": true
             }
           ]
         }
       ]
     }
   }
   ```
   The hook runner path is resolved via `import.meta.url` so it always points to the compiled JS, no `ts-node` at runtime.

5. **Starts `popcorn serve`** as a detached background daemon (auto-started after init).

---

## How It Fires

```
Claude Code runs Edit or Write on a file
        │
        ▼
PostToolUse hook fires
(Claude Code pipes JSON to stdin of claude-hook-runner.js)
        │
        ▼
Hook reads HookEvent: { tool_name, tool_input: { file_path }, tool_response }
        │
        ▼
Checks: is file in watchDir OR has "// popcorn-test" marker?
        │  no → exit silently
        ▼
Finds matching test plan (exact name → kebab-case → prefix/substring)
        │  none found → auto-generates via plan-generator.ts
        ▼
Probes ports 7890-7899 for a running daemon (popcorn serve)
        │
        ├─ daemon found → POST /demo (fire-and-forget)
        │
        └─ no daemon → creates ephemeral ExtensionClient
                │
                ▼
            connect() → BridgeServer on 7890-7899
                │  fails → file-based IPC (.popcorn/outbox)
                ▼
            Enqueue start_demo → extension polls → runs demo → returns result
                │
                ▼
            Evaluate acceptance criteria, print summary, disconnect
```

---

## Bridge Server

**Class:** `BridgeServer` in `hook/src/bridge-server.ts`

- Built on Node.js `http` module (zero extra deps)
- Binds to `127.0.0.1` only
- Tries ports 7890 through 7899 (10 attempts)
- Token auth: `crypto.randomBytes(16).toString('hex')` generated on construction

### Routes

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/health` | GET | None | Discovery endpoint. Returns `{ ok, port, version, token }` |
| `/poll` | GET | Token | Drains the outgoing message queue for the extension |
| `/result` | POST | Token | Receives demo results from the extension |
| `/demo` | POST | Token | Accepts a `start_demo` message and enqueues it |
| `/config` | GET | Token | Returns current config |
| `/config` | POST | Token | Updates config, saves to `popcorn.config.json` |
| `/plans` | GET | Token | Lists all test plan names |
| `/plans/:name` | GET | Token | Loads a specific test plan |

Auth is via the `X-Popcorn-Token` header. Returns 401 on mismatch. CORS is `*` (safe — localhost only).

### Discovery file

When the bridge starts, it writes `.popcorn/bridge.json`:
```json
{ "port": 7890, "token": "abc123...", "pid": 12345, "startedAt": "2025-02-14T..." }
```

---

## Extension Client

**Class:** `ExtensionClient` in `hook/src/extension-client.ts`

Dual transport: HTTP bridge (preferred) with automatic file-based IPC fallback.

```typescript
const client = new ExtensionClient({
  projectRoot: '/path/to/project',
  timeoutMs: 30000,    // demo timeout
  bridgePort: 7890,    // preferred port
  config: { ... }      // forwarded to BridgeServer
});

await client.connect();
const result = await client.startDemo(planId, testPlan, criteria, 'hook');
client.disconnect();
```

**Key methods:**
- `connect()` — starts BridgeServer, writes `bridge.json`, falls back to file IPC
- `startDemo(planId, plan, criteria, triggeredBy)` → `Promise<DemoResult>`
- `getTransport()` → `'http' | 'file'`
- `disconnect()` — stops server, cleans up `bridge.json`

---

## File Watcher

**Class:** `Watcher` in `hook/src/watcher.ts`

- Uses `chokidar` with per-file debounce (default 300ms)
- Watches extensions: `.js`, `.ts`, `.jsx`, `.tsx`
- Ignores: `node_modules`, `.git`, `dist`
- Checks for `// popcorn-test` marker in changed files
- Emits `FileChangeEvent`: `{ filePath, relativePath, eventType, hasPopcornMarker, timestamp }`

---

## Config

**File:** `popcorn.config.json` in project root

```typescript
interface PopcornConfig {
  watchDir: string;           // default: "src/frontend"
  extensions: string[];       // default: [".js", ".ts", ".jsx", ".tsx"]
  debounceMs: number;         // default: 300
  ignorePatterns: string[];   // default: ["node_modules", ".git", "dist"]
  testPlansDir: string;       // default: "test-plans"
  popcornMarker: string;      // default: "// popcorn-test"
  bridgePort?: number;        // default: 7890
  baseUrl?: string;           // e.g. "http://localhost:3000"
}
```

Loaded via `loadConfigFromFile(projectRoot)`. Merge order: `overrides > popcorn.config.json > defaults`.

---

## Plan Generator

**File:** `hook/src/plan-generator.ts`

`generatePlanFromFile(filePath)` reads a source file and:

1. Runs regex-based `detectElements()` to find forms, inputs, textareas, selects, buttons, and links
2. Calls `buildSteps()` from `@popcorn/shared` to create an ordered step sequence
3. If no interactive elements are found, builds a visual-check plan (navigate + screenshot) using `analyzeComponentContext()` from `import-graph.ts`
4. Returns a `TestPlan` tagged `['auto-generated']`

Plans are saved to `test-plans/<kebab-name>.json` via `savePlan()`.

---

## Acceptance Criteria

**File:** `hook/src/criteria-loader.ts`

Criteria are stored in `test-plans/criteria/<flow>.criteria.json`:
```json
{ "flow": "login", "criteria": ["redirects to /dashboard", "within 500ms"], "autoGenerated": false }
```

If no criteria file exists, defaults to `["All steps pass"]`.

Pattern-matched evaluators in `@popcorn/shared` (`parsePlainTextCriteria()`):
- `"within 500ms"` → duration check
- `"redirects to /dashboard"` → URL check on final step metadata
- `"shows error message"` → checks for error text in step metadata
- `shows "Success"` → text content check
- `"form submits successfully"` → form step pass check
- `"no errors"` → `noStepErrors()` evaluator
- Unrecognized → `allStepsPassed()` fallback

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `POPCORN_LOG_LEVEL` | `info` | Log verbosity: `debug`, `info`, `warn`, `error` |

---

## Key File Locations (Runtime)

| Path | Purpose |
|------|---------|
| `popcorn.config.json` | Project config |
| `.claude/settings.local.json` | Claude Code hook registration |
| `test-plans/*.json` | Test plan definitions |
| `test-plans/criteria/*.criteria.json` | Acceptance criteria |
| `.popcorn/bridge.json` | Bridge server discovery (port, token, pid) |
| `.popcorn/outbox/` | File-based IPC: hook → extension |
| `.popcorn/inbox/` | File-based IPC: extension → hook |

---

## Build

```bash
# From repo root
npm run build          # builds shared, extension, hook

# Hook only
cd hook && npm run build   # tsc → hook/dist/
```

The hook's `tsconfig.json` outputs to `hook/dist/` with path alias `@popcorn/shared` → `../shared/src/index.ts` and a project reference to `../shared`.

---

## Testing

```bash
npm test               # all workspaces (vitest)
cd hook && npm test    # hook only
```

Hook tests run in Node environment (configured via vitest `environmentMatchGlobs`).

---

## Serve Command

```bash
popcorn serve
```

Starts a persistent `BridgeServer` that stays alive until Ctrl+C. Auto-started by `popcorn init` as a detached background process. Writes `.popcorn/bridge.json` for discovery. The hook runner checks for an existing daemon before creating an ephemeral server — this avoids port conflicts and speeds up repeated demos.
