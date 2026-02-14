# Popcorn — Hackathon Submission Summaries

## Version A: Impact-First

Every time an AI edits your frontend code, someone has to manually verify it works. Click through flows, eyeball layouts, check redirects — tedious busywork that slows down the very speed AI promises. Popcorn eliminates this entirely.

Popcorn is a Chrome extension and Claude Code hook that creates a closed-loop testing cycle for AI-generated UI code. When Claude Opus 4.6 edits a frontend file, Popcorn automatically detects the change, generates a test plan by scanning JSX/HTML for interactive elements, and dispatches batched browser operations to the extension — executing 5+ actions per second with zero human intervention. Developers write acceptance criteria in plain English ("redirects to /dashboard", "within 500ms"), and pattern-matched evaluators return structured pass/fail results directly to the AI for self-correction.

Built as a "Tool That Should Exist," Popcorn benefits solo developers, AI-first teams, QA engineers, and product managers alike. Everything runs locally — zero cloud dependencies, full privacy. With 387 tests across 27 test files and one-command setup via `popcorn init`, it is production-grade today and ready to become the standard feedback loop for AI-assisted frontend development.

**Word count: 172**

---

## Version B: Technical Depth

Popcorn hooks directly into Claude Opus 4.6's PostToolUse lifecycle. Every time Opus edits a frontend file via `Edit` or `Write`, a hook fires automatically — no watcher daemon, no manual trigger. This tight integration makes the AI both author and first tester of its own code.

The hook auto-generates test plans using regex-based pattern detection against JSX and HTML (forms, inputs, buttons, links), requiring zero API calls. Plans are dispatched over an HTTP bridge on localhost:7890-7899 with token authentication, falling back to file-based IPC automatically. The Chrome extension (Manifest V3) executes batched operations at 5+ actions per second — clicks, form fills, navigation, screenshots, assertions — and returns structured step metadata (actual URLs, rendered text, timing) back to the AI.

Acceptance criteria use plain-English pattern matching: "redirects to /dashboard" triggers a URL evaluator, "within 500ms" triggers a duration check. The TypeScript-strict monorepo spans three npm workspaces with 387 tests across 27 files. The architecture is a "Tool That Should Exist" — closing the gap between AI code generation and AI code verification in a single autonomous loop.

**Word count: 174**

---

## Version C: Demo Teaser

Watch this: Claude Opus 4.6 edits a login form component. Within one second, a Chrome extension springs to life — navigating to the page, filling the email field, typing a password, clicking submit, and asserting the redirect lands on `/dashboard`. Five actions executed in under a second. No human touched the keyboard.

That is Popcorn. A Chrome extension and Claude Code hook that turns every AI file edit into an instant, autonomous visual test. The moment Opus 4.6 writes code, Popcorn auto-generates a test plan from the JSX, dispatches it over a local HTTP bridge, and the extension executes batched browser operations while capturing screenshots. Plain-English criteria like "shows error message" and "within 500ms" are evaluated by pattern-matched functions — and structured results flow back to the AI so it can self-correct.

No cloud. No config. One command (`popcorn init`) scaffolds everything. Backed by 387 tests across 27 test files in a TypeScript-strict monorepo. This is the "Tool That Should Exist" — because AI that writes code should also prove it works, with zero human intervention.

**Word count: 175**

---

## Recommendation

**Pick Version C (Demo Teaser).**

Three reasons:

1. **Demo is the highest-weighted category at 30%.** Version C is written to mirror what judges will see live — action verbs paint the experience before they watch it. This primes their evaluation positively.

2. **It still hits the technical and impact notes.** The HTTP bridge, pattern-matched evaluators, 387 tests, and TypeScript-strict monorepo are all mentioned — just woven into narrative rather than leading with them. Judges who care about depth will find it; judges who care about demo will feel it.

3. **The opening is the most memorable.** "Watch this: Claude Opus 4.6 edits a login form component. Within one second, a Chrome extension springs to life..." is concrete and visual. Hackathon judges read dozens of summaries; the ones that open with action stand out. The closer ("zero human intervention") lands the autonomy message cleanly.

If the submission platform allows a longer description elsewhere to cover technical depth, use Version B's content there and Version C as the primary summary.
