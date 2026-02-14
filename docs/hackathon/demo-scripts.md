# Popcorn Hackathon Demo Video Scripts

Three complete demo scripts for a 2:45-3:00 hackathon video. Each targets different scoring criteria while showcasing the same product from a different angle.

Best practices applied throughout (sourced from hackathon presentation guides):
- Lead with the most compelling moment, not background
- Show, don't tell -- live product footage over slides
- Every second must earn its place; no filler
- Demonstrate honest progress and real working software
- Map sections explicitly to judging criteria

---

## Version A: "The Speed Run"

**Title:** Popcorn: The Speed Run
**Tagline:** "Your AI writes code. Popcorn proves it works. In under 2 seconds."

### Full Narration

> Every time an AI edits your frontend, someone has to check that it actually works. Open the browser. Click through the flow. Fill the form. Check the redirect. Fifteen seconds if you're fast. Every single time.
>
> Now watch Popcorn do it.
>
> [SILENCE -- only the sound of rapid-fire browser actions]
>
> One point eight seconds. Five actions. Fill username, fill password, click submit, verify redirect to dashboard, screenshot the result. Batched. Automatic. The moment the AI saves the file.
>
> Here's what happened. Claude Opus 4.6 edited a login component. Popcorn's PostToolUse hook fired -- it reads the edit event from stdin, resolves the file path, and checks: is this file in my watch directory? It is. So it scans the JSX for interactive elements. Regex pattern detection finds two inputs and a submit button. It generates a test plan -- navigate, fill, fill, click, assert redirect -- and saves it as JSON. Zero API calls. Zero config. Pure static analysis.
>
> The plan goes to the Chrome extension over an HTTP bridge on localhost port 7890. Token-authenticated. The extension's background service worker picks it up on its next alarm poll -- every three seconds -- and starts executing. Navigate happens in the background via chrome.tabs.update. Then it injects the content script and fires the remaining steps as a batch. Click, fill, select, screenshot -- fourteen action types, all running inside the real browser. Real DOM. Real CSS. Real network requests.
>
> But speed isn't the point. The point is what happens next.
>
> Watch. Claude edits the auth logic. Introduces a bug -- the redirect path is wrong. Popcorn runs. The acceptance criterion says "redirects to /dashboard". Popcorn checks the actual URL in step metadata. Slash-settings, not slash-dashboard. Criterion fails. Structured results go back to Claude with the evidence: expected /dashboard, got /settings.
>
> Claude reads the failure. Fixes the redirect. Saves. Popcorn fires again. This time: all steps pass. Redirects to /dashboard confirmed. Under 500 milliseconds. Two criteria met. Green across the board.
>
> That is the loop. AI edits. Popcorn tests. Failure with evidence. AI fixes. Popcorn confirms. No human in the loop. No manual clicking. No "trust me, it works."
>
> Setup? One command. popcorn init. It detects your source directory, scans for interactive elements, generates test plans, and wires the Claude Code hook. You write plain English acceptance criteria -- "redirects to /dashboard", "within 500ms", "shows error message" -- and Popcorn pattern-matches them to real evaluators.
>
> Three hundred eighty-seven tests. TypeScript strict mode. Zero cloud dependencies. Everything runs on your machine. Popcorn. Autonomous UI testing for the age of AI-generated code.

### Timing Breakdown

| Time | Section | Duration | On Screen |
|------|---------|----------|-----------|
| 0:00-0:18 | The Problem | 18s | Split screen. Left: screencast of a human manually clicking through a 5-step login flow. Stopwatch overlay counting up to ~15s. Right: empty, dark, waiting. Cursor movements deliberately slow and realistic. |
| 0:18-0:25 | The Speed Moment | 7s | Right side activates. Popcorn extension popup briefly visible, then the browser explodes with automated actions -- fields filling, button clicking, page redirecting. Stopwatch overlay: 1.8s. Left side fades to 30% opacity. Timer comparison frozen on screen: 15.2s vs 1.8s. |
| 0:25-0:35 | What Just Happened (Actions) | 10s | Zoomed view of the Popcorn popup showing step results. Each step listed with green checkmarks and duration in ms. Brief overlay text: "5 actions / 1.8 seconds". |
| 0:35-1:05 | How It Works (Hook + Plan Gen) | 30s | Terminal split with VS Code. Top: Claude Code editing LoginForm.tsx (cursor moving, code appearing). Bottom: terminal showing [Popcorn] log lines -- "File changed: LoginForm.tsx", "No matching test plan, generating...", "Generated test plan saved: login-form.json". Quick cut to the generated JSON plan (2-second zoom on the steps array). |
| 1:05-1:25 | How It Works (Bridge + Execution) | 20s | Architecture diagram overlay (animated): Hook box on left, arrow labeled "HTTP localhost:7890" to Extension box on right. Arrow labeled "chrome.tabs.update" to browser tab. Arrow labeled "content script batch" to DOM. Intercut with actual Chrome DevTools network tab showing the /poll and /result requests. |
| 1:25-2:05 | The Iteration Loop | 40s | Full-screen VS Code + browser side by side. Claude edits auth.ts -- visible code change (redirect path wrong). Popcorn runs -- browser shows /settings instead of /dashboard. Popup shows red X on redirect criterion. Cut to terminal: "FAIL: Expected redirect to /dashboard, got /settings". Claude fixes the path. Popcorn re-runs. Browser lands on /dashboard. Popup: all green. Terminal: "PASS". Zoom on the structured criteria output with evidence strings. |
| 2:05-2:25 | Setup + Criteria | 20s | Fresh terminal. Type `popcorn init`. Output scrolls: detected watch dir, scanned 4 files, generated 3 test plans, wrote hook config. Quick cut to popcorn.config.json (3 lines visible). Cut to a criteria file: plain English lines -- "redirects to /dashboard", "within 500ms", "no errors". |
| 2:25-2:45 | Close | 20s | Stats overlay on dark background, appearing one at a time: "387 tests", "TypeScript strict", "Zero cloud deps", "One command setup". Final frame: Popcorn logo + tagline. |

### Scoring Criteria Mapping

| Section | Primary Target | Secondary Target |
|---------|---------------|-----------------|
| The Problem / Speed Moment | Demo (30%) -- visual proof, immediate wow factor | |
| How It Works (Hook) | Opus 4.6 Use (25%) -- PostToolUse hook integration | Depth (20%) |
| How It Works (Bridge) | Depth (20%) -- sound engineering | |
| The Iteration Loop | Opus 4.6 Use (25%) -- AI-in-the-loop autonomy | Impact (25%) |
| Setup + Criteria | Impact (25%) -- real-world usability | Depth (20%) |
| Close | Depth (20%) -- engineering quality signals | |

### The Iteration Loop Moment (1:25-2:05)

This is the centerpiece. The camera never cuts away. One continuous sequence:
1. Claude edits `auth.ts` -- viewer sees the exact line changing (`/settings` instead of `/dashboard`)
2. Terminal logs: `[Popcorn] File changed: auth.ts`
3. Browser navigates, fills, clicks -- lands on `/settings`
4. Popup shows criterion result: "Expected redirect to /dashboard not found" with red indicator
5. Claude fixes the line back to `/dashboard`
6. Terminal logs: file change detected again
7. Browser re-runs the same flow -- lands on `/dashboard`
8. Popup: all green. Terminal: `[OK] Redirected to /dashboard (contains "/dashboard")`

The key is that the viewer sees the EVIDENCE -- not just pass/fail, but the actual URL that was checked, matching the exact evaluator logic from `acceptance.ts`.

---

## Version B: "The Trust Machine"

**Title:** Popcorn: The Trust Machine
**Tagline:** "Your AI just rewrote your login. Do you trust it?"

### Full Narration

> [5 seconds of silence. Close-up of code appearing character by character in a dark editor. It's authentication logic.]
>
> Your AI just rewrote your login flow. New validation. New redirect logic. New error handling. Do you trust it?
>
> [2-second pause]
>
> You shouldn't have to. Watch.
>
> [Browser comes alive -- Popcorn executing]
>
> That's Popcorn. An autonomous testing agent that lives between your AI and your users. When Claude Opus 4.6 edits a frontend file, Popcorn intercepts the save, understands what changed, and proves it works -- all before the AI moves on to the next task.
>
> Let me show you the full picture.
>
> Claude is editing a signup form. It writes new password validation -- minimum eight characters, one uppercase, one number. The moment it saves, Popcorn's PostToolUse hook activates. This hook is wired directly into Claude Code's tool lifecycle. It sees every edit and every write. It's not polling a file system on a timer. It's listening to the AI itself.
>
> The hook reads the source file. No AST parser, no language server -- regex pattern detection identifies two input fields, a password field, and a submit button. It generates a test plan in milliseconds: navigate to the form, fill the email, fill a weak password, click submit, assert that an error appears. Then fill a strong password, click submit, assert redirect to the welcome page.
>
> This plan travels over a localhost HTTP bridge to the Chrome extension. The extension executes it in a real browser. Not a headless simulator. Not a virtual DOM. The actual Chrome tab your users will see. Real CSS rendering. Real form validation. Real network behavior.
>
> And here's where trust gets built.
>
> Popcorn finds that the weak password -- "abc" -- submits successfully. No validation error. The criterion said "shows error message." Popcorn checked every step's metadata for error-related text content. Found none. Criterion failed. The structured result goes back to Claude: criterion "shows error message" not met. No error text found in assertions.
>
> Claude reads this. It sees its own mistake -- the validation regex was checking length but not enforcing it as a gate on submission. It fixes the handler. Saves again. Popcorn runs again. This time: "abc" triggers "Password must be at least 8 characters." Criterion passed: error message found in assertion results. Strong password submits, redirects to /welcome. All criteria green.
>
> The AI didn't just write code. It wrote code, tested it, found its own bug, and fixed it. Autonomously. Popcorn is the verification layer that makes that possible.
>
> This matters because AI-generated code is about to be everywhere. Not just prototypes -- production authentication, payment flows, medical forms. The question isn't whether AI can write this code. It can. The question is whether we can trust it. And trust doesn't come from the model's confidence score. Trust comes from evidence. Screenshots. Step-by-step results. Actual URLs checked against expected URLs. Actual text matched against plain English criteria.
>
> Popcorn gives Claude eyes. And it gives you proof.
>
> One command to set up. `popcorn init`. Plain English criteria. No cloud. No API keys. Everything local. Three hundred eighty-seven tests passing. And every time your AI edits a file, Popcorn is watching.

### Timing Breakdown

| Time | Section | Duration | On Screen |
|------|---------|----------|-----------|
| 0:00-0:12 | The Question | 12s | Dark screen. Code appearing in a monospaced font, character by character, as if being typed by an AI. Auth logic: if/else, redirect calls, password checks. Slow, deliberate. Then the text overlay fades in: "Do you trust it?" Held for 2 full seconds. No music. |
| 0:12-0:18 | The Answer | 6s | Hard cut to the browser. Popcorn extension icon pulses. Fields fill automatically. Page redirects. Quick, clean, decisive. Contrast with the slow tension of the opening. |
| 0:18-0:35 | What Is Popcorn | 17s | Clean diagram: Claude Code on the left, a shield/lens icon (Popcorn) in the center, Users on the right. Arrows showing the flow: AI edits -> Popcorn verifies -> Users receive tested code. Overlaid with the narration. Simple, no animation excess. |
| 0:35-1:05 | The Hook Integration | 30s | VS Code showing Claude editing a signup form component. Code changes are visible and readable -- password validation being added. Cut to terminal: `[Popcorn] File changed: SignupForm.tsx`. Brief code highlight on the hook runner: stdin read, file path extraction, watch directory check. Then the plan-generator output: detected elements listed (email input, password input, submit button). Generated plan JSON briefly visible. |
| 1:05-1:25 | Real Browser Execution | 20s | Full-screen Chrome. The signup form is visible. Popcorn fills the email field (visible typing animation from the content script). Fills a weak password "abc". Clicks submit. Camera lingers on the form -- no error appears. The form submitted. Then a red overlay annotation: "No validation error shown." |
| 1:25-2:00 | The Iteration Loop (Trust Built) | 35s | Split screen: left is code editor, right is browser. Left: Claude's edit cursor appears on the validation function. The fix is visible -- adding a return/prevent-default before submission when validation fails. File saves (flash indicator). Right: Popcorn re-runs. Fills "abc". This time an error message appears below the password field. Camera zooms slowly into the error text. Then fills a strong password. Form submits. Redirects to /welcome. Cut to the Popcorn popup: every criterion has a green indicator. The evidence strings are readable: "Error message found in assertion results", "Redirected to /welcome". |
| 2:00-2:20 | Why This Matters | 20s | No product footage. Simple white text on dark background, appearing in sequence with narration: "AI-generated code is going to production." "Authentication. Payments. Medical forms." "Trust doesn't come from confidence scores." "Trust comes from evidence." Each line appears, holds for 3 seconds, fades. |
| 2:20-2:45 | Setup + Close | 25s | Terminal: `popcorn init` typed and executed. Output scrolls. Cut to a criteria file being edited -- plain English lines typed in real time. Then the final frame: Popcorn logo. Tagline: "Your AI writes code. Popcorn proves it works." Stats line below: "387 tests. Zero cloud deps. One command." |

### Scoring Criteria Mapping

| Section | Primary Target | Secondary Target |
|---------|---------------|-----------------|
| The Question | Demo (30%) -- emotional hook, tension | |
| What Is Popcorn | Impact (25%) -- frames the real-world problem | |
| The Hook Integration | Opus 4.6 Use (25%) -- PostToolUse deep integration | Depth (20%) |
| Real Browser Execution | Demo (30%) -- working product, visible | Depth (20%) |
| The Iteration Loop | Opus 4.6 Use (25%) -- autonomous fix cycle | Demo (30%) |
| Why This Matters | Impact (25%) -- stakes, who benefits | |
| Setup + Close | Depth (20%) -- simplicity as engineering | Impact (25%) |

### The Iteration Loop Moment (1:25-2:00)

This version emphasizes the TRUST narrative. The iteration isn't just a technical cycle -- it's the AI catching its own mistake:

1. Claude writes password validation (visible in editor)
2. Popcorn tests with weak password "abc" -- form submits without error (BUG)
3. Criterion "shows error message" evaluates: checks all step metadata for error/invalid/fail text. Finds none. Returns: "No error message found in assertions or step results"
4. Result returns to Claude via HTTP bridge POST /result
5. Claude sees the structured failure, understands the bug (validation doesn't prevent submission)
6. Claude edits the handler -- adds early return on validation failure
7. Popcorn re-tests: "abc" now shows "Password must be at least 8 characters"
8. Criterion evaluates: finds "Password must be at least 8 characters" in metadata.actualText. Returns: "Error message found in assertion results"

The narrative arc: AI made a mistake -> machine caught it -> AI fixed it -> machine confirmed. No human needed. Trust earned through evidence.

---

## Version C: "Zero Config Future"

**Title:** Popcorn: Zero Config
**Tagline:** "One command. Autonomous UI testing."

### Full Narration

> [Terminal cursor blinking]
>
> popcorn init.
>
> [Enter key. Output scrolls.]
>
> That just did four things. Detected your frontend source directory. Scanned every file for interactive elements -- forms, inputs, buttons, links. Generated test plans for each one. And wired a Claude Code hook so that every time the AI edits a file, those plans run automatically in a real browser.
>
> No configuration file to write. No test framework to learn. No selectors to maintain. One command. Done.
>
> Let me show you what "done" actually means.
>
> [Screen transitions to code editor with Claude working]
>
> This is a React app. Claude Opus 4.6 is adding a contact form. Name field, email field, message textarea, submit button. The moment Claude saves ContactForm.tsx, Popcorn's PostToolUse hook fires. It runs as a subprocess -- reads the hook event from stdin, gets the file path, checks if it's in the watch directory.
>
> No matching test plan exists yet. So Popcorn generates one. It reads the file. Regex patterns find the input with name "name", the input with name "email", the textarea, the submit button. It builds steps: navigate, fill name with test data, fill email with test data, fill message, click submit. Saves the plan as JSON. Total time: twelve milliseconds.
>
> The plan goes to the Chrome extension over localhost HTTP. The extension executes: real browser, real DOM, real rendering. Fields fill. Button clicks. Page responds. Results come back with step metadata -- actual URLs, actual text content, actual form state.
>
> Now watch what happens when something breaks.
>
> Claude refactors the form. Changes the email input name from "email" to "userEmail". The existing test plan still references input name "email". Popcorn runs. Step three fails: selector input[name="email"] not found. Duration: forty-two milliseconds to failure. The structured error goes back to Claude: "Element not found: input[name='email']."
>
> Claude reads the failure. Realizes the selector is stale. But Popcorn also re-scans the file and generates an updated plan with the new selector. Next run: all steps pass.
>
> This is what autonomous means. Not "set up once and pray." Generate, test, fail, regenerate, retest. The plans evolve with the code because they're derived from the code.
>
> Let me show you the engineering.
>
> [Quick technical montage]
>
> TypeScript strict mode everywhere. Three npm workspace packages -- shared types, Chrome extension, Node.js hook. The extension is Manifest V3 with a Vite multi-entry build. The hook uses Node's built-in HTTP module -- zero external dependencies for the bridge server. Communication is token-authenticated. The extension polls via chrome.alarms every three seconds. If HTTP fails, it falls back to file-based IPC automatically. The plan generator uses fourteen action types. Acceptance criteria are plain English, pattern-matched to evaluators -- "within 500ms" becomes a duration check, "redirects to /dashboard" becomes a URL assertion, "shows error message" scans step metadata for error text.
>
> Three hundred eighty-seven tests across twenty-seven test files. Vitest with environment-matched globs -- jsdom for the extension, Node for the hook. Every message type has a TypeScript interface. Every action returns structured metadata. Every criterion produces evidence.
>
> One command. Autonomous testing. No cloud. No API keys. Just Popcorn.

### Timing Breakdown

| Time | Section | Duration | On Screen |
|------|---------|----------|-----------|
| 0:00-0:15 | The Command | 15s | Full-screen terminal. Dark background, monospaced font. The cursor blinks twice. Then `popcorn init` is typed (visible keystrokes, not instant). Enter. Output appears line by line: "Detected watch directory: src/", "Scanning 12 files...", "Generated 4 test plans", "Hook configured in .claude/settings.local.json". Each line holds for ~2s. Clean, minimal, no decoration. |
| 0:15-0:30 | What That Did | 15s | Four-panel grid, each panel lighting up as described: (1) folder tree with src/ highlighted, (2) file contents with regex highlights on `<input`, `<button`, `<form`, (3) JSON test plan with steps visible, (4) .claude/settings.local.json with the hook command. Quick, informational, no narration filler. |
| 0:30-1:00 | Live Demo -- Plan Generation | 30s | VS Code on left, browser on right. Claude editing ContactForm.tsx -- the code appears naturally (AI typing). Terminal at bottom shows Popcorn log: "File changed: ContactForm.tsx", "No matching test plan, generating...", "Detected: input[name='name'], input[name='email'], textarea, button[type='submit']", "Generated plan: contact-form.json (12ms)". Browser on right comes alive: navigates, fills fields (visible text appearing in inputs), clicks submit. Popup overlay shows green checkmarks. |
| 1:00-1:40 | The Iteration Loop (Selector Evolution) | 40s | Continuous shot. Left: Claude refactors -- visibly changes `name="email"` to `name="userEmail"` in the JSX. Save indicator flashes. Bottom terminal: "[Popcorn] File changed: ContactForm.tsx". Right: browser runs -- first two fields fill, then a red flash on the third step. Popup shows: step 3 FAIL, "Element not found: input[name='email']". Brief pause (the failure sinks in). Then terminal: "[Popcorn] Re-generating plan..." New plan generated with updated selector. Browser re-runs. All fields fill correctly with new selector. Popup: all green. Terminal: "PASS - All steps passed." |
| 1:40-2:10 | Engineering Deep Dive | 30s | Fast-paced montage. Each item appears for 3-4 seconds with a code snippet or diagram: (1) Architecture diagram: three boxes (shared/extension/hook) with arrows, (2) Bridge server code snippet showing HTTP routes and token auth, (3) Plan generator showing regex patterns, (4) Acceptance criteria file with pattern-match arrows to evaluator functions, (5) Vitest config showing environment globs, (6) Content script action dispatcher switch statement (14 cases visible). No lingering. Technical confidence. |
| 2:10-2:30 | Quality Signals | 20s | Terminal running `npm test`. Output scrolls: "27 test files, 387 tests passed." Then `npm run build` -- "Build complete." Then a brief view of tsconfig.json with `"strict": true` highlighted. Cut to package.json showing three workspaces. Cut to bridge-server.ts import -- `import http from 'node:http'` (zero deps). Each shot is 4 seconds, matter-of-fact. |
| 2:30-2:50 | Close | 20s | Return to the terminal from the opening. Same dark background. Text appears: "One command. Autonomous testing." Below: "popcorn init". Logo fades in. Silence for the last 3 seconds. |

### Scoring Criteria Mapping

| Section | Primary Target | Secondary Target |
|---------|---------------|-----------------|
| The Command | Demo (30%) -- immediate, tangible | Depth (20%) |
| What That Did | Depth (20%) -- engineering explained | |
| Live Demo -- Plan Generation | Demo (30%) -- working product | Opus 4.6 Use (25%) |
| The Iteration Loop | Opus 4.6 Use (25%) -- autonomous regeneration | Impact (25%) |
| Engineering Deep Dive | Depth (20%) -- real craft, real code | |
| Quality Signals | Depth (20%) -- 387 tests, strict TS, zero deps | |
| Close | Impact (25%) -- simplicity as the pitch | |

### The Iteration Loop Moment (1:00-1:40)

This version's iteration loop is about PLAN EVOLUTION, not just code fixes:

1. Claude changes `name="email"` to `name="userEmail"` in ContactForm.tsx
2. Popcorn fires with the existing plan -- step 3 uses selector `input[name="email"]`
3. Content script's `executeAction()` tries `document.querySelector('input[name="email"]')` -- returns null
4. Step result: `{ passed: false, error: "Element not found: input[name='email']", duration: 42 }`
5. Structured failure returns to Claude via `POST /result` on the bridge
6. Meanwhile, `generatePlanFromFile()` re-scans ContactForm.tsx -- `detectElements()` now finds `input[name="userEmail"]`
7. New plan saved with updated selector
8. Next run uses the fresh plan -- `input[name="userEmail"]` resolves correctly
9. All steps pass

The narrative point: test plans aren't brittle artifacts you maintain. They're derived from source code and regenerate automatically when the code changes. Zero maintenance. Zero selector rot.

---

## Comparative Summary

| Aspect | Version A: Speed Run | Version B: Trust Machine | Version C: Zero Config |
|--------|---------------------|-------------------------|----------------------|
| **Opening hook** | Split-screen speed comparison (15s vs 1.8s) | Tension question ("Do you trust it?") | Terminal command (popcorn init) |
| **Emotional register** | Excitement, energy | Gravitas, building trust | Quiet confidence, technical respect |
| **Primary scoring target** | Demo (30%) | Opus 4.6 Use (25%) + Impact (25%) | Depth (20%) |
| **Iteration loop focus** | URL redirect bug caught by criteria | Password validation bug caught by criteria | Selector staleness caught by regeneration |
| **Technical depth** | Bridge architecture + batched execution | PostToolUse hook lifecycle + criteria evaluation | Plan generator + regex detection + full test suite |
| **Audience reaction** | "That's fast" | "That's important" | "That's well built" |
| **Risk** | Feels like a benchmark, not a product | Slower pace may lose impatient judges | Technical depth may not land with non-engineers |
| **Total duration** | 2:45 | 2:45 | 2:50 |

## Production Notes

**For all versions:**
- Record actual product footage first, then record narration to match
- Use screen recording at 60fps for the browser execution sequences (they're fast)
- Terminal font size should be at least 16pt for readability at 1080p
- Popcorn popup should be pinned/visible during execution sequences
- The iteration loop is the single most important sequence in every version -- rehearse it until it's flawless
- Keep background music minimal and low; narration clarity is paramount
- End card should include a link to the repo or demo

**Recommended combination:** If judges watch multiple submissions, lead with Version B (emotional hook, broadest appeal), then reference Version A's speed comparison as supplementary material. Version C works best for a technically sophisticated judging panel.
