# Popcorn Setup Guide

Popcorn is an autonomous UI testing tool for Claude Code. When Claude edits a frontend file, Popcorn automatically runs a visual demo in the browser, captures video, and reports results — no manual steps needed.

## Prerequisites

- **Node.js** 18+
- **Chrome** 123+
- **Claude Code** (CLI)

## Installation

### 1. Clone and build

```bash
git clone <repo-url> popcorn
cd popcorn
npm install
npm run build
```

### 2. Register the CLI

```bash
npm link
```

This makes the `popcorn` command available globally on your machine. You only need to do this once (re-run after `npm run build` if you update Popcorn).

### 3. Load the Chrome extension

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `extension/dist/` directory inside your Popcorn clone

The Popcorn icon appears in your toolbar.

## Setting up a project

From your project's root directory:

```bash
cd ~/my-project
popcorn init
```

This scaffolds three things:

| File | Purpose |
|------|---------|
| `test-plans/` | Directory for test plans (auto-generated or hand-written) |
| `popcorn.config.json` | Config with auto-detected `watchDir` and `testPlansDir` |
| `.claude/settings.local.json` | Claude Code PostToolUse hook that triggers Popcorn on file edits |

The init command auto-detects your frontend source directory (`src/components`, `src/pages`, `app`, etc.) and scans existing files for interactive elements (forms, inputs, buttons). If it finds any, it generates test plans automatically. Otherwise, it creates an example login plan as a starting point.

## How it works

Once set up, Popcorn is fully automatic:

1. You work in **Claude Code** on your project as normal
2. Claude edits a frontend file (via `Edit` or `Write` tool)
3. The **PostToolUse hook** fires automatically
4. Popcorn finds or auto-generates a test plan for the changed file
5. The test plan is sent to the **Chrome extension** via HTTP bridge
6. The extension executes the plan in your browser (clicks, fills forms, navigates)
7. Results are sent back to Claude Code with a structured summary

You don't need to run any extra processes or commands. The hook is invoked by Claude Code itself.

### Important: Keep your app tab active

Popcorn runs demos on the **currently active Chrome tab**. Before triggering a demo (or before Claude edits a file), make sure your app is open and its tab is focused in Chrome.

If the active tab isn't on a web page (e.g., you're on `chrome://extensions`), Popcorn will try to navigate to the `baseUrl` from your `popcorn.config.json` as a fallback. If no `baseUrl` is set, the demo will fail with a clear error message.

**Best practice:** Open your app at `http://localhost:3000` (or wherever it runs) and keep that tab active while working with Claude Code.

## Verifying the setup

### Check the extension

Click the Popcorn icon in Chrome's toolbar:
- **Green dot** next to "Hook" = extension is connected to the hook
- **Dim dot** = waiting for the hook (fires on next file edit)

### Check the hook

After Claude edits a watched file, you'll see output like:

```
[Popcorn] File changed: src/components/LoginForm.tsx
[Popcorn] Dispatching test plan 'login-form' (5 steps)
[Popcorn] --- Demo Result ---
[Popcorn] Status: PASSED
[Popcorn] Duration: 340ms
```

### Check the HTTP bridge

```bash
curl -s http://127.0.0.1:7890/health | jq .
```

Returns `{"ok":true,"port":7890,...}` when the hook is active.

## Configuration

Edit `popcorn.config.json` in your project root:

```json
{
  "watchDir": "src/components",
  "testPlansDir": "test-plans",
  "baseUrl": "http://localhost:3000"
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `watchDir` | Auto-detected | Directory to watch for frontend file changes |
| `testPlansDir` | `test-plans` | Where test plan JSON files live |
| `baseUrl` | `http://localhost:3000` | Your dev server URL. Used as fallback when the active tab isn't on a web page. Also used to resolve relative URLs in test plans. |

## Test plans

Test plans are JSON files in `test-plans/` that define what Popcorn does in the browser.

### Auto-generated plans

When Claude edits a file and no matching plan exists, Popcorn scans the file for interactive elements and generates one. The plan is saved to `test-plans/` and tagged `['auto-generated']`.

### Custom plans

Create a JSON file named after the feature (e.g., `test-plans/login.json`):

```json
{
  "planName": "login",
  "description": "Test the login flow",
  "baseUrl": "http://localhost:3000",
  "steps": [
    { "stepNumber": 1, "action": "navigate", "target": "/login", "description": "Go to login page" },
    { "stepNumber": 2, "action": "fill", "selector": "input[name='email']", "value": "test@example.com", "description": "Enter email" },
    { "stepNumber": 3, "action": "fill", "selector": "input[name='password']", "value": "Test1234!", "description": "Enter password" },
    { "stepNumber": 4, "action": "click", "selector": "button[type='submit']", "description": "Click login" },
    { "stepNumber": 5, "action": "assert", "assertionType": "url", "expected": "/dashboard", "description": "Verify redirect" }
  ],
  "tags": ["login"]
}
```

### Plan matching

When a file changes, Popcorn matches by filename:
- `LoginForm.tsx` looks for `login-form.json` (kebab-case conversion)
- Exact matches are tried first, then prefix matching

### The `// popcorn-test` marker

Files outside your `watchDir` are normally ignored. Add `// popcorn-test` anywhere in a file to make Popcorn watch it regardless of location.

## Acceptance criteria

Write criteria in plain English in your test plan. Popcorn pattern-matches them to real evaluators:

| Pattern | What it checks |
|---------|---------------|
| `"within 500ms"` | Demo completes within the specified duration |
| `"redirects to /dashboard"` | Final URL contains the expected path |
| `"shows error message"` | An error-like message appears on screen |
| `shows "Success"` | Specific text appears on the page |
| `"form submits successfully"` | Form submission step passes |
| `"no errors"` | No step errors occurred |

## Troubleshooting

### `popcorn: command not found`

Re-run from the Popcorn repo:
```bash
cd ~/path/to/popcorn
npm run build && npm link
```

### Extension shows dim hook dot

The hook only runs when Claude Code edits a file. The dot turns green during a demo and goes dim between edits. This is normal.

### No demo triggers when Claude edits a file

1. Check that `.claude/settings.local.json` exists in your project with the PostToolUse hook
2. Verify the file Claude edited is in your `watchDir` or has `// popcorn-test`
3. Check that the Chrome extension is loaded and active

### Demo fails with "No web page open"

Popcorn runs demos on the active Chrome tab. If you see this error:

1. Open your app in Chrome (e.g., `http://localhost:3000`)
2. Keep that tab active (clicked / focused)
3. Trigger the demo again

As a fallback, set `"baseUrl"` in `popcorn.config.json` so Popcorn can navigate automatically when the active tab isn't on a web page.

### Port conflict

If another service uses port 7890, Popcorn automatically tries 7891-7899.
