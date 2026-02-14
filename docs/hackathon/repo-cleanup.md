# Repo Cleanup Checklist — Hackathon Submission

Audit date: 2026-02-14
Auditor: Claude Opus 4.6

---

## Build & Test Baseline

- **Build**: Clean across all 3 workspaces (shared, extension, hook). No errors.
- **Tests**: 387 passed across 27 test files (32.77s). Zero failures.
- **Git status**: One uncommitted modification: `extension/src/popup/components/TapeDetail.tsx`. No untracked files.

---

## Critical (Must fix before submission)

- [ ] **No README.md exists.** The repo has no top-level README. For a hackathon this is the single most important file — judges will see it first on GitHub. Create `README.md` with: project tagline, architecture diagram, demo GIF/screenshot, installation steps, how it works, tech stack, and test count. The existing `SETUP.md` and `docs/hackathon/summaries.md` have good raw material.

- [ ] **No LICENSE file.** Add a `LICENSE` file (MIT is standard for hackathon submissions). Without it, the project is technically "all rights reserved" which judges may flag.

- [ ] **`.claude/` agent files are committed with hardcoded absolute paths.** Seven files under `.claude/agents/` and `.claude/agent-memory/` are tracked in git and contain `/Users/TimNice/Development/popcorn/` paths. These are Claude Code internal working files, not part of the product.
  - `.claude/agent-memory/hook-implementer/MEMORY.md`
  - `.claude/agent-memory/video-recorder/MEMORY.md`
  - `.claude/agents/bug-summariser.md`
  - `.claude/agents/hook-implementer.md`
  - `.claude/agents/test-plan-generator.md`
  - `.claude/agents/ui-extension-implementer.md`
  - `.claude/agents/video-recorder.md`
  - **Action**: Add `.claude/agents/` and `.claude/agent-memory/` to `.gitignore`, then `git rm --cached` these 7 files.

- [ ] **Uncommitted change in TapeDetail.tsx.** Either commit or discard the modification to `extension/src/popup/components/TapeDetail.tsx` so the repo is clean on submission.

---

## Important (Should fix)

- [ ] **Root `package.json` is missing metadata fields.** Currently has only `name`, `version`, `private`, `type`, `bin`, `workspaces`, `scripts`, `devDependencies`. Add:
  - `"description"`: "Autonomous visual testing for AI-generated frontend code"
  - `"license"`: "MIT" (or chosen license)
  - `"repository"`: `{ "type": "git", "url": "https://github.com/timothynice/popcorn.git" }`
  - `"author"`: Your name/handle
  - `"keywords"`: `["chrome-extension", "testing", "ai", "claude", "visual-testing", "ui-testing", "automation"]`
  - File: `/Users/TimNice/Development/popcorn/package.json`

- [ ] **Workspace package.json files also missing metadata.** All three (`shared/package.json`, `extension/package.json`, `hook/package.json`) lack `description`, `license`, `author`, and `keywords`. At minimum add `description` and `license` to each.

- [ ] **TypeDoc-generated `docs/` is committed (13 files, ~100KB of JS/CSS/HTML).** This is auto-generated build output (`npm run docs`). Judges likely will not browse it, and it clutters the repo. Options:
  - (a) Remove from git, add `docs/assets/` and `docs/modules/` and `docs/index.html` to `.gitignore`, host via GitHub Pages separately if desired.
  - (b) Keep if you want GitHub Pages API docs — but then add a note in README pointing to them.
  - File list: `docs/index.html`, `docs/assets/*` (7 files), `docs/modules/*` (3 files), `docs/.nojekyll`

- [ ] **`SETUP.md` references `<repo-url>` placeholder.** Line 16: `git clone <repo-url> popcorn`. Replace with the actual GitHub URL `https://github.com/timothynice/popcorn.git`.
  - File: `/Users/TimNice/Development/popcorn/SETUP.md`, line 16

- [ ] **Commit messages are auto-generated and opaque.** Recent commits like `auto: update extension/src/background/demo-flow.ts, ...` tell judges nothing about what was built. Consider at minimum a final "clean up" commit with a clear message before submission, or a summary in the README of the development history.

---

## Nice to Have

- [ ] **`CLAUDE.md` and `MEMORY.md` are committed.** These are Claude Code instruction files. They are not harmful (no secrets), and they actually demonstrate how the tool was built with AI assistance — which could be a positive for hackathon judges. However, `MEMORY.md` (referenced in `.claude/` project config, not the repo root) contains implementation notes that may look rough. Decide: keep as a "built with AI" signal, or add to `.gitignore`.

- [ ] **`popcorn_prd.md` is committed (84 lines).** This is the product requirements doc. Fine to keep for transparency, but consider moving to `docs/` for cleaner root directory.

- [ ] **console.log usage across source files (85 occurrences in 10 files).** Most go through the `createLogger()` wrapper in `hook/src/logger.ts` or are extension console messages — this is fine for a tool that intentionally logs status. No raw `console.log("debug")` style statements found. No action needed unless you want to add a log-level toggle.

- [ ] **No `.editorconfig` or formatting config.** Not strictly needed, but adding a simple `.editorconfig` signals code quality to judges.

- [ ] **Add a demo GIF or screenshot to the repo.** Store in `docs/assets/` or a top-level `media/` directory. A 10-second GIF of Popcorn auto-testing a form would be extremely compelling for the 30%-weighted demo category.

- [ ] **GitHub repo topics.** After pushing, add these topics on the GitHub repo settings page:
  - `chrome-extension`, `testing`, `ai-tools`, `claude`, `visual-testing`, `automation`, `typescript`, `developer-tools`, `hackathon`

---

## Already Good (no action needed)

- **Build is clean.** All 3 workspaces compile without errors.
- **All 387 tests pass.** Zero failures, zero skipped.
- **No TODO/FIXME/HACK/XXX comments anywhere in source.** Clean codebase.
- **No `.DS_Store` files tracked.** `.gitignore` already covers them.
- **No stale compiled files in `shared/src/`.** The known footgun (`.js`/`.d.ts` shadowing `.ts` sources) is not present.
- **No `dist/` directories tracked.** `.gitignore` covers them properly.
- **No `.env` files tracked.** `.gitignore` covers them.
- **No untracked files.** `git status` shows only the one modified file.
- **No hardcoded API keys or secrets in source.** The `token` references are all runtime-generated (`crypto.randomBytes`) for localhost auth. The `password` references are test fixture placeholders (`Test1234!`) in example login plans — appropriate for a testing tool.
- **No sensitive personal data beyond the `.claude/` paths** noted above.
- **TypeScript strict mode** is enforced across the monorepo.
- **`.gitignore` covers the essentials**: `node_modules/`, `dist/`, `tapes/`, `.popcorn/`, `.env`, `*.tsbuildinfo`, `coverage/`, `.DS_Store`, `*.log`.

---

## Suggested Additions to `.gitignore`

```gitignore
# Claude Code agent working files (contain hardcoded paths)
.claude/agents/
.claude/agent-memory/

# TypeDoc generated output (if removing from git)
# docs/assets/
# docs/modules/
# docs/index.html
# docs/.nojekyll
```

---

## Suggested GitHub Repo Description

> Autonomous visual testing for AI-generated frontend code. Chrome extension + Claude Code hook that auto-tests every UI edit with zero human intervention.

## Suggested GitHub Topics

`chrome-extension` `testing` `ai-tools` `claude` `visual-testing` `automation` `typescript` `developer-tools` `monorepo`
