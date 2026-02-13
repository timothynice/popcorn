# Local CLI Wiring (Approach B)

**Date:** 2026-02-12
**Goal:** Make `popcorn init` runnable from any local project via `npm link`.

## Problem

`npx popcorn init` won't work because the package isn't published to npm. The `bin` field exists in `hook/package.json` but npm can't resolve it from an external project. The hook runner path in `.claude/settings.local.json` is hardcoded relative to the Popcorn repo.

## Design

### 1. Root `package.json` — add `bin`

Add `"bin": { "popcorn": "./hook/dist/cli.js" }` so `npm link` registers the `popcorn` command globally.

### 2. `commands/init.ts` — dynamic absolute path for hook runner

When writing `.claude/settings.local.json`, resolve the hook runner path dynamically from the CLI's own location using `import.meta.url`. This produces an absolute path to the compiled `hook/dist/claude-hook-runner.js`, removing the `ts-node` dependency for end users.

Before: `node --loader ts-node/esm hook/src/claude-hook-runner.ts`
After: `node /absolute/path/to/popcorn/hook/dist/claude-hook-runner.js`

### 3. User setup (one time)

```bash
cd ~/Development/popcorn
npm run build
npm link
```

### 4. Usage from any project

```bash
cd ~/my-project
popcorn init
```

## What doesn't change

- Extension loading (manual `chrome://extensions` load unpacked)
- HTTP bridge, polling, all runtime behavior
- Test plans, acceptance criteria, auto-generation

## Migration to Approach A (future)

When we publish to npm, replace absolute paths with paths relative to `node_modules/popcorn/` and remove the `npm link` requirement.
