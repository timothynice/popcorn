# Route-Aware Visual Testing — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Auto-navigate to the correct page/state before screenshotting a changed component, so visual-check plans always capture the component under test.

**Architecture:** Static import graph analysis (regex, not AST) traces from changed file upward through imports to find the parent page and detect how the component is rendered (array, route, conditional, or direct). Navigation steps are prepended to the visual-check plan. When static analysis fails, the extension falls back to multi-state screenshot capture by clicking through discovered navigation controls.

**Tech Stack:** Node.js `fs` + regex for import scanning (zero new deps). Existing `TestStep` types for navigation steps. Extension content script for runtime fallback.

---

## Task 1: NavigationHint Types

**Files:**
- Create: `hook/src/import-graph.ts`

**Step 1: Write the type definitions**

```typescript
// hook/src/import-graph.ts

import type { TestStep } from '@popcorn/shared';

/** A file that imports the target component. */
export interface Importer {
  filePath: string;
  source: string;
}

/** How the component is rendered in its parent. */
export type NavigationHint =
  | { type: 'array'; index: number; arrayName: string; totalItems: number }
  | { type: 'route'; path: string }
  | { type: 'conditional'; stateVar: string; value: string }
  | { type: 'direct' };

/** Result of analyzing a component's rendering context. */
export interface ComponentContext {
  hint: NavigationHint;
  parentFilePath: string;
  navigationSteps: TestStep[];
}
```

**Step 2: Commit**

```bash
git add hook/src/import-graph.ts
git commit -m "feat(hook): add NavigationHint types for import graph analysis"
```

---

## Task 2: findImporters() — Scan for Files That Import a Component

**Files:**
- Modify: `hook/src/import-graph.ts`
- Test: `hook/src/__tests__/import-graph.test.ts`

**Step 1: Write failing tests**

```typescript
// hook/src/__tests__/import-graph.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { findImporters } from '../import-graph.js';

describe('findImporters', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'popcorn-ig-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('finds a file that imports the target component', async () => {
    await fs.mkdir(path.join(tmpDir, 'components'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'components', 'SlideProduct.tsx'),
      'export default function SlideProduct() { return <div/>; }',
    );
    await fs.writeFile(
      path.join(tmpDir, 'Index.tsx'),
      `import SlideProduct from './components/SlideProduct';\nconst SLIDES = [SlideProduct];`,
    );

    const importers = await findImporters(
      path.join(tmpDir, 'components', 'SlideProduct.tsx'),
      tmpDir,
    );

    expect(importers).toHaveLength(1);
    expect(importers[0].filePath).toContain('Index.tsx');
    expect(importers[0].source).toContain('SlideProduct');
  });

  it('returns empty array when no file imports the target', async () => {
    await fs.writeFile(path.join(tmpDir, 'Orphan.tsx'), 'export default 1;');
    await fs.writeFile(path.join(tmpDir, 'Other.tsx'), 'export default 2;');

    const importers = await findImporters(
      path.join(tmpDir, 'Orphan.tsx'),
      tmpDir,
    );

    expect(importers).toHaveLength(0);
  });

  it('ignores node_modules and .git directories', async () => {
    await fs.mkdir(path.join(tmpDir, 'node_modules', 'pkg'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'node_modules', 'pkg', 'index.js'),
      `import Foo from '../../Foo';`,
    );
    await fs.writeFile(path.join(tmpDir, 'Foo.tsx'), 'export default 1;');

    const importers = await findImporters(
      path.join(tmpDir, 'Foo.tsx'),
      tmpDir,
    );

    expect(importers).toHaveLength(0);
  });

  it('handles aliased imports like @/ paths', async () => {
    await fs.mkdir(path.join(tmpDir, 'src', 'components'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'src', 'components', 'Card.tsx'),
      'export default function Card() {}',
    );
    await fs.writeFile(
      path.join(tmpDir, 'src', 'Page.tsx'),
      `import Card from '@/components/Card';\nexport default function Page() { return <Card/>; }`,
    );

    const importers = await findImporters(
      path.join(tmpDir, 'src', 'components', 'Card.tsx'),
      tmpDir,
    );

    expect(importers).toHaveLength(1);
    expect(importers[0].filePath).toContain('Page.tsx');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/TimNice/Development/popcorn && npx vitest run hook/src/__tests__/import-graph.test.ts`
Expected: FAIL — `findImporters` is not exported

**Step 3: Implement findImporters()**

Add to `hook/src/import-graph.ts`:

```typescript
import fs from 'node:fs/promises';
import path from 'node:path';

const SOURCE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'build']);

/**
 * Scans the project for files that import the target component.
 * Uses regex, not AST parsing. Scans up to 2 directory levels above the target.
 */
export async function findImporters(
  targetFilePath: string,
  projectRoot: string,
): Promise<Importer[]> {
  const baseName = path.basename(targetFilePath, path.extname(targetFilePath));
  // Match: import ... from '...<baseName>' (with or without extension)
  const importPattern = new RegExp(
    `import\\s+.*from\\s+['"][^'"]*\\b${escapeRegex(baseName)}['"]`,
  );

  const importers: Importer[] = [];
  const sourceFiles = await collectSourceFiles(projectRoot);

  for (const filePath of sourceFiles) {
    if (filePath === targetFilePath) continue;

    const source = await fs.readFile(filePath, 'utf-8');
    if (importPattern.test(source)) {
      importers.push({ filePath, source });
    }
  }

  return importers;
}

async function collectSourceFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentDir: string, depth: number): Promise<void> {
    if (depth > 5) return; // Don't recurse too deep

    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry.name)) continue;

      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1);
      } else if (entry.isFile() && SOURCE_EXTENSIONS.includes(path.extname(entry.name))) {
        files.push(fullPath);
      }
    }
  }

  await walk(dir, 0);
  return files;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/TimNice/Development/popcorn && npx vitest run hook/src/__tests__/import-graph.test.ts`
Expected: PASS (all 4 tests)

**Step 5: Commit**

```bash
git add hook/src/import-graph.ts hook/src/__tests__/import-graph.test.ts
git commit -m "feat(hook): add findImporters() to scan for component parents"
```

---

## Task 3: detectRenderingPattern() — Identify Array, Route, Conditional, or Direct Rendering

**Files:**
- Modify: `hook/src/import-graph.ts`
- Modify: `hook/src/__tests__/import-graph.test.ts`

**Step 1: Write failing tests**

Append to `hook/src/__tests__/import-graph.test.ts`:

```typescript
import { detectRenderingPattern } from '../import-graph.js';

describe('detectRenderingPattern', () => {
  it('detects array rendering with correct index', () => {
    const source = `
      import SlideProduct from './SlideProduct';
      const SLIDES = [SlideOpening, SlideProblem, SlideShift, SlideProduct, SlideProof, SlideClosing];
    `;
    const hint = detectRenderingPattern(source, 'SlideProduct');
    expect(hint).toEqual({
      type: 'array',
      index: 3,
      arrayName: 'SLIDES',
      totalItems: 6,
    });
  });

  it('detects array rendering at index 0', () => {
    const source = `const TABS = [HomeTab, SettingsTab];`;
    const hint = detectRenderingPattern(source, 'HomeTab');
    expect(hint).toEqual({
      type: 'array',
      index: 0,
      arrayName: 'TABS',
      totalItems: 2,
    });
  });

  it('detects React Router route', () => {
    const source = `
      <Route path="/product" element={<SlideProduct />} />
    `;
    const hint = detectRenderingPattern(source, 'SlideProduct');
    expect(hint).toEqual({ type: 'route', path: '/product' });
  });

  it('detects route with nested path', () => {
    const source = `<Route path="/settings/profile" element={<ProfilePage />} />`;
    const hint = detectRenderingPattern(source, 'ProfilePage');
    expect(hint).toEqual({ type: 'route', path: '/settings/profile' });
  });

  it('detects conditional rendering', () => {
    const source = `{activeTab === 'product' && <SlideProduct />}`;
    const hint = detectRenderingPattern(source, 'SlideProduct');
    expect(hint).toEqual({
      type: 'conditional',
      stateVar: 'activeTab',
      value: 'product',
    });
  });

  it('returns direct for simple JSX usage', () => {
    const source = `
      export default function Page() {
        return <div><SlideProduct /></div>;
      }
    `;
    const hint = detectRenderingPattern(source, 'SlideProduct');
    expect(hint).toEqual({ type: 'direct' });
  });

  it('returns null when component is not found in source', () => {
    const source = `export default function Page() { return <div/>; }`;
    const hint = detectRenderingPattern(source, 'SlideProduct');
    expect(hint).toBeNull();
  });

  it('handles multiline array declarations', () => {
    const source = `
      const SLIDES = [
        SlideOpening,
        SlideProblem,
        SlideProduct,
      ];
    `;
    const hint = detectRenderingPattern(source, 'SlideProduct');
    expect(hint).toEqual({
      type: 'array',
      index: 2,
      arrayName: 'SLIDES',
      totalItems: 3,
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/TimNice/Development/popcorn && npx vitest run hook/src/__tests__/import-graph.test.ts`
Expected: FAIL — `detectRenderingPattern` is not exported

**Step 3: Implement detectRenderingPattern()**

Add to `hook/src/import-graph.ts`:

```typescript
/**
 * Detects how a component is rendered in its parent source code.
 * Runs pattern detectors in priority: array → route → conditional → direct.
 * Returns null if the component name is not found at all in the source.
 */
export function detectRenderingPattern(
  source: string,
  componentName: string,
): NavigationHint | null {
  // Quick check: is the component even referenced?
  if (!source.includes(componentName)) return null;

  // Priority 1: Array rendering — const SOMETHING = [..., Component, ...]
  const arrayHint = detectArrayPattern(source, componentName);
  if (arrayHint) return arrayHint;

  // Priority 2: Route rendering — <Route path="..." element={<Component />} />
  const routeHint = detectRoutePattern(source, componentName);
  if (routeHint) return routeHint;

  // Priority 3: Conditional rendering — condition && <Component />
  const conditionalHint = detectConditionalPattern(source, componentName);
  if (conditionalHint) return conditionalHint;

  // Default: direct rendering (component in JSX with no wrapper)
  const jsxPattern = new RegExp(`<${escapeRegex(componentName)}[\\s/>]`);
  if (jsxPattern.test(source)) {
    return { type: 'direct' };
  }

  return null;
}

function detectArrayPattern(
  source: string,
  componentName: string,
): NavigationHint | null {
  // Match: const NAME = [items] — supports multiline via [\s\S]
  const arrayRegex = /const\s+(\w+)\s*=\s*\[([\s\S]*?)\]/g;
  let match: RegExpExecArray | null;

  while ((match = arrayRegex.exec(source)) !== null) {
    const arrayName = match[1];
    const arrayContent = match[2];

    // Split by comma, trim whitespace, filter empties
    const items = arrayContent
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const index = items.indexOf(componentName);
    if (index >= 0) {
      return {
        type: 'array',
        index,
        arrayName,
        totalItems: items.length,
      };
    }
  }

  return null;
}

function detectRoutePattern(
  source: string,
  componentName: string,
): NavigationHint | null {
  // Match: <Route path="/..." element={<ComponentName />} /> or element={<ComponentName>}
  const routeRegex = new RegExp(
    `<Route\\s+[^>]*path=["']([^"']+)["'][^>]*element=\\{<${escapeRegex(componentName)}[\\s/>]`,
  );
  const match = routeRegex.exec(source);
  if (match) {
    return { type: 'route', path: match[1] };
  }

  // Also try reversed order: element before path
  const routeRegexReversed = new RegExp(
    `<Route\\s+[^>]*element=\\{<${escapeRegex(componentName)}[\\s/>][^>]*path=["']([^"']+)["']`,
  );
  const matchReversed = routeRegexReversed.exec(source);
  if (matchReversed) {
    return { type: 'route', path: matchReversed[1] };
  }

  return null;
}

function detectConditionalPattern(
  source: string,
  componentName: string,
): NavigationHint | null {
  // Match: variable === 'value' && <ComponentName
  const conditionalRegex = new RegExp(
    `(\\w+)\\s*===?\\s*['"]([\\w-]+)['"]\\s*&&\\s*<${escapeRegex(componentName)}`,
  );
  const match = conditionalRegex.exec(source);
  if (match) {
    return { type: 'conditional', stateVar: match[1], value: match[2] };
  }

  return null;
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/TimNice/Development/popcorn && npx vitest run hook/src/__tests__/import-graph.test.ts`
Expected: PASS (all 12 tests)

**Step 5: Commit**

```bash
git add hook/src/import-graph.ts hook/src/__tests__/import-graph.test.ts
git commit -m "feat(hook): add detectRenderingPattern() for array/route/conditional detection"
```

---

## Task 4: detectNavigationControl() — Find How to Navigate to Array Items

**Files:**
- Modify: `hook/src/import-graph.ts`
- Modify: `hook/src/__tests__/import-graph.test.ts`

**Step 1: Write failing tests**

Append to `hook/src/__tests__/import-graph.test.ts`:

```typescript
import { detectNavigationControl } from '../import-graph.js';

describe('detectNavigationControl', () => {
  it('detects ProgressBar with onNavigate prop', () => {
    const source = `<ProgressBar current={currentSlide} total={SLIDES.length} onNavigate={(i) => goTo(i)} />`;
    const control = detectNavigationControl(source, 'SLIDES');
    expect(control).toEqual({
      type: 'indexed-click',
      selectorTemplate: '[data-slide-index="{index}"], .progress-dot:nth-child({n})',
    });
  });

  it('detects next/prev button pattern', () => {
    const source = `<button onClick={next}>Next</button><button onClick={prev}>Previous</button>`;
    const control = detectNavigationControl(source, 'SLIDES');
    expect(control).toEqual({
      type: 'sequential-click',
      nextSelector: 'button',
    });
  });

  it('detects keyboard navigation via onKeyDown', () => {
    const source = `onKeyDown={(e) => { if (e.key === 'ArrowRight') next(); }}`;
    const control = detectNavigationControl(source, 'SLIDES');
    expect(control).toEqual({ type: 'keypress', key: 'ArrowRight' });
  });

  it('returns default keypress fallback when no control found', () => {
    const source = `export default function Page() { return <div/>; }`;
    const control = detectNavigationControl(source, 'SLIDES');
    expect(control).toEqual({ type: 'keypress', key: 'ArrowRight' });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/TimNice/Development/popcorn && npx vitest run hook/src/__tests__/import-graph.test.ts`
Expected: FAIL — `detectNavigationControl` is not exported

**Step 3: Implement detectNavigationControl()**

Add types and function to `hook/src/import-graph.ts`:

```typescript
/** How to navigate between items in an array-rendered component. */
export type NavigationControl =
  | { type: 'indexed-click'; selectorTemplate: string }
  | { type: 'sequential-click'; nextSelector: string }
  | { type: 'keypress'; key: string };

/**
 * Detects the navigation control for an array-rendered component.
 * Scans the parent source for ProgressBar, next/prev buttons, or keyboard handlers.
 * Falls back to ArrowRight keypress.
 */
export function detectNavigationControl(
  source: string,
  _arrayName: string,
): NavigationControl {
  // Pattern 1: ProgressBar / dots with onNavigate or onClick with index
  if (/onNavigate|onDotClick|onIndicatorClick/i.test(source)) {
    return {
      type: 'indexed-click',
      selectorTemplate: '[data-slide-index="{index}"], .progress-dot:nth-child({n})',
    };
  }

  // Pattern 2: Next/prev buttons
  if (/onClick=\{[^}]*(next|forward|goNext)/i.test(source)) {
    return { type: 'sequential-click', nextSelector: 'button' };
  }

  // Pattern 3: Keyboard navigation
  if (/ArrowRight|ArrowDown/.test(source)) {
    return { type: 'keypress', key: 'ArrowRight' };
  }

  // Default fallback: arrow key navigation (very common for slides/carousels)
  return { type: 'keypress', key: 'ArrowRight' };
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/TimNice/Development/popcorn && npx vitest run hook/src/__tests__/import-graph.test.ts`
Expected: PASS (all 16 tests)

**Step 5: Commit**

```bash
git add hook/src/import-graph.ts hook/src/__tests__/import-graph.test.ts
git commit -m "feat(hook): add detectNavigationControl() for array navigation heuristics"
```

---

## Task 5: resolveNavigationSteps() — Convert Hints to TestStep[]

**Files:**
- Modify: `hook/src/import-graph.ts`
- Modify: `hook/src/__tests__/import-graph.test.ts`

**Step 1: Write failing tests**

Append to `hook/src/__tests__/import-graph.test.ts`:

```typescript
import { resolveNavigationSteps } from '../import-graph.js';
import type { NavigationHint, NavigationControl } from '../import-graph.js';

describe('resolveNavigationSteps', () => {
  it('generates navigate step for route hint', () => {
    const hint: NavigationHint = { type: 'route', path: '/product' };
    const steps = resolveNavigationSteps(hint, 'http://localhost:8080', null, 'ProductPage');

    expect(steps).toHaveLength(1);
    expect(steps[0].action).toBe('navigate');
    expect(steps[0].target).toBe('http://localhost:8080/product');
  });

  it('generates indexed click steps for array hint with indexed control', () => {
    const hint: NavigationHint = { type: 'array', index: 3, arrayName: 'SLIDES', totalItems: 6 };
    const control: NavigationControl = {
      type: 'indexed-click',
      selectorTemplate: '.progress-dot:nth-child({n})',
    };
    const steps = resolveNavigationSteps(hint, 'http://localhost:8080', control, 'SlideProduct');

    expect(steps).toHaveLength(1);
    expect(steps[0].action).toBe('click');
    expect(steps[0].selector).toBe('.progress-dot:nth-child(4)');
  });

  it('generates repeated keypress steps for array hint with keypress control', () => {
    const hint: NavigationHint = { type: 'array', index: 3, arrayName: 'SLIDES', totalItems: 6 };
    const control: NavigationControl = { type: 'keypress', key: 'ArrowRight' };
    const steps = resolveNavigationSteps(hint, 'http://localhost:8080', control, 'SlideProduct');

    expect(steps).toHaveLength(3);
    steps.forEach((step) => {
      expect(step.action).toBe('keypress');
      expect(step.key).toBe('ArrowRight');
    });
  });

  it('generates no steps for direct hint', () => {
    const hint: NavigationHint = { type: 'direct' };
    const steps = resolveNavigationSteps(hint, 'http://localhost:8080', null, 'Component');

    expect(steps).toHaveLength(0);
  });

  it('generates repeated sequential clicks for array with sequential control', () => {
    const hint: NavigationHint = { type: 'array', index: 2, arrayName: 'STEPS', totalItems: 5 };
    const control: NavigationControl = { type: 'sequential-click', nextSelector: '.next-btn' };
    const steps = resolveNavigationSteps(hint, 'http://localhost:8080', control, 'StepThree');

    expect(steps).toHaveLength(2);
    steps.forEach((step) => {
      expect(step.action).toBe('click');
      expect(step.selector).toBe('.next-btn');
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/TimNice/Development/popcorn && npx vitest run hook/src/__tests__/import-graph.test.ts`
Expected: FAIL — `resolveNavigationSteps` is not exported

**Step 3: Implement resolveNavigationSteps()**

Add to `hook/src/import-graph.ts`:

```typescript
/**
 * Converts a NavigationHint + NavigationControl into concrete TestStep[] to
 * prepend to a visual-check plan.
 */
export function resolveNavigationSteps(
  hint: NavigationHint,
  baseUrl: string,
  control: NavigationControl | null,
  componentName: string,
): TestStep[] {
  const steps: TestStep[] = [];

  switch (hint.type) {
    case 'route': {
      const url = baseUrl.replace(/\/$/, '') + hint.path;
      steps.push({
        stepNumber: 0, // Caller will re-number
        action: 'navigate',
        description: `Navigate to ${hint.path} (${componentName})`,
        target: url,
      });
      break;
    }

    case 'array': {
      if (!control || control.type === 'keypress') {
        // Repeat keypress N times (index times since we start at 0)
        const key = control?.key ?? 'ArrowRight';
        for (let i = 0; i < hint.index; i++) {
          steps.push({
            stepNumber: 0,
            action: 'keypress',
            description: `Press ${key} to advance (${i + 1}/${hint.index})`,
            key,
          });
        }
      } else if (control.type === 'indexed-click') {
        // Single click on the indexed control (1-based for nth-child)
        const selector = control.selectorTemplate
          .replace('{index}', String(hint.index))
          .replace('{n}', String(hint.index + 1));
        steps.push({
          stepNumber: 0,
          action: 'click',
          description: `Navigate to item ${hint.index + 1} (${componentName})`,
          selector,
        });
      } else if (control.type === 'sequential-click') {
        // Click "next" N times
        for (let i = 0; i < hint.index; i++) {
          steps.push({
            stepNumber: 0,
            action: 'click',
            description: `Click next (${i + 1}/${hint.index})`,
            selector: control.nextSelector,
          });
        }
      }
      break;
    }

    case 'conditional': {
      // We can't reliably click a trigger without more context.
      // Generate a hint comment but no action — falls through to multi-state.
      break;
    }

    case 'direct': {
      // No navigation needed
      break;
    }
  }

  return steps;
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/TimNice/Development/popcorn && npx vitest run hook/src/__tests__/import-graph.test.ts`
Expected: PASS (all 21 tests)

**Step 5: Commit**

```bash
git add hook/src/import-graph.ts hook/src/__tests__/import-graph.test.ts
git commit -m "feat(hook): add resolveNavigationSteps() to generate TestStep[] from hints"
```

---

## Task 6: analyzeComponentContext() — Top-Level Orchestrator

**Files:**
- Modify: `hook/src/import-graph.ts`
- Modify: `hook/src/__tests__/import-graph.test.ts`

**Step 1: Write failing tests**

Append to `hook/src/__tests__/import-graph.test.ts`:

```typescript
import { analyzeComponentContext } from '../import-graph.js';

describe('analyzeComponentContext', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'popcorn-ctx-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns navigation steps for array-rendered component', async () => {
    await fs.mkdir(path.join(tmpDir, 'components', 'slides'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'components', 'slides', 'SlideProduct.tsx'),
      'export default function SlideProduct() { return <div/>; }',
    );
    await fs.writeFile(
      path.join(tmpDir, 'pages', 'Index.tsx').replace('pages/', ''),
      [
        `import SlideProduct from './components/slides/SlideProduct';`,
        `import SlideOpening from './components/slides/SlideOpening';`,
        `const SLIDES = [SlideOpening, SlideProduct];`,
        `<ProgressBar onNavigate={(i) => goTo(i)} />`,
      ].join('\n'),
    );

    // Create pages dir and file properly
    await fs.writeFile(
      path.join(tmpDir, 'Index.tsx'),
      [
        `import SlideProduct from './components/slides/SlideProduct';`,
        `import SlideOpening from './components/slides/SlideOpening';`,
        `const SLIDES = [SlideOpening, SlideProduct];`,
        `<ProgressBar onNavigate={(i) => goTo(i)} />`,
      ].join('\n'),
    );

    const ctx = await analyzeComponentContext(
      path.join(tmpDir, 'components', 'slides', 'SlideProduct.tsx'),
      tmpDir,
      'http://localhost:8080',
    );

    expect(ctx).not.toBeNull();
    expect(ctx!.hint.type).toBe('array');
    expect(ctx!.navigationSteps.length).toBeGreaterThan(0);
    expect(ctx!.navigationSteps[0].action).toBe('click');
  });

  it('returns null when no importer is found', async () => {
    await fs.writeFile(path.join(tmpDir, 'Orphan.tsx'), 'export default 1;');

    const ctx = await analyzeComponentContext(
      path.join(tmpDir, 'Orphan.tsx'),
      tmpDir,
      'http://localhost:8080',
    );

    expect(ctx).toBeNull();
  });

  it('returns route navigation for routed component', async () => {
    await fs.writeFile(path.join(tmpDir, 'ProductPage.tsx'), 'export default function ProductPage() {}');
    await fs.writeFile(
      path.join(tmpDir, 'App.tsx'),
      `import ProductPage from './ProductPage';\n<Route path="/product" element={<ProductPage />} />`,
    );

    const ctx = await analyzeComponentContext(
      path.join(tmpDir, 'ProductPage.tsx'),
      tmpDir,
      'http://localhost:3000',
    );

    expect(ctx).not.toBeNull();
    expect(ctx!.hint.type).toBe('route');
    expect(ctx!.navigationSteps).toHaveLength(1);
    expect(ctx!.navigationSteps[0].target).toBe('http://localhost:3000/product');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/TimNice/Development/popcorn && npx vitest run hook/src/__tests__/import-graph.test.ts`
Expected: FAIL — `analyzeComponentContext` is not exported

**Step 3: Implement analyzeComponentContext()**

Add to `hook/src/import-graph.ts`:

```typescript
/**
 * Top-level function that analyzes a component file's rendering context.
 * Finds who imports it, detects the rendering pattern, and resolves navigation steps.
 * Returns null if no importers are found or the component is not rendered.
 */
export async function analyzeComponentContext(
  filePath: string,
  projectRoot: string,
  baseUrl: string,
): Promise<ComponentContext | null> {
  const componentName = path.basename(filePath, path.extname(filePath));
  const importers = await findImporters(filePath, projectRoot);

  if (importers.length === 0) return null;

  // Try each importer — first one with a detected pattern wins
  for (const importer of importers) {
    const hint = detectRenderingPattern(importer.source, componentName);
    if (!hint) continue;

    let control: NavigationControl | null = null;
    if (hint.type === 'array') {
      control = detectNavigationControl(importer.source, hint.arrayName);
    }

    const navigationSteps = resolveNavigationSteps(hint, baseUrl, control, componentName);

    return {
      hint,
      parentFilePath: importer.filePath,
      navigationSteps,
    };
  }

  return null;
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/TimNice/Development/popcorn && npx vitest run hook/src/__tests__/import-graph.test.ts`
Expected: PASS (all 24 tests)

**Step 5: Commit**

```bash
git add hook/src/import-graph.ts hook/src/__tests__/import-graph.test.ts
git commit -m "feat(hook): add analyzeComponentContext() top-level orchestrator"
```

---

## Task 7: Integrate Import Graph into Plan Generator

**Files:**
- Modify: `hook/src/plan-generator.ts` (lines 41-64, the visual-check path)
- Modify: `hook/src/__tests__/plan-generator.test.ts`

**Step 1: Write failing test**

Add to `hook/src/__tests__/plan-generator.test.ts` inside the `generatePlanFromFile` describe block:

```typescript
  it('prepends navigation steps for array-rendered component', async () => {
    // Create a component and a parent that renders it in an array
    await fs.mkdir(path.join(tmpDir, 'slides'), { recursive: true });
    const slideSrc = `export default function SlideTwo() { return <div>Slide 2</div>; }`;
    await fs.writeFile(path.join(tmpDir, 'slides', 'SlideTwo.tsx'), slideSrc);

    const parentSrc = [
      `import SlideOne from './slides/SlideOne';`,
      `import SlideTwo from './slides/SlideTwo';`,
      `import SlideThree from './slides/SlideThree';`,
      `const SLIDES = [SlideOne, SlideTwo, SlideThree];`,
      `<ProgressBar onNavigate={(i) => go(i)} />`,
    ].join('\n');
    await fs.writeFile(path.join(tmpDir, 'Index.tsx'), parentSrc);

    const plan = await generatePlanFromFile(
      path.join(tmpDir, 'slides', 'SlideTwo.tsx'),
      { baseUrl: 'http://localhost:8080', projectRoot: tmpDir },
    );

    expect(plan).not.toBeNull();
    expect(plan!.tags).toContain('visual-check');
    expect(plan!.tags).toContain('navigated');

    // Should have: navigate → wait → click (navigate to slide) → wait → screenshot
    const actions = plan!.steps.map((s) => s.action);
    expect(actions).toContain('navigate');
    expect(actions).toContain('click');
    expect(actions).toContain('screenshot');

    // The click step should target the second progress dot (index 1, nth-child(2))
    const clickStep = plan!.steps.find((s) => s.action === 'click');
    expect(clickStep!.selector).toContain('2');
  });
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/TimNice/Development/popcorn && npx vitest run hook/src/__tests__/plan-generator.test.ts`
Expected: FAIL — `projectRoot` option doesn't exist yet, no navigation steps in visual-check plans

**Step 3: Update generatePlanFromFile() to accept projectRoot and call analyzeComponentContext()**

In `hook/src/plan-generator.ts`, update the options interface and the visual-check path:

```typescript
// Update the options parameter type (line 43)
export async function generatePlanFromFile(
  filePath: string,
  options?: { baseUrl?: string; projectRoot?: string },
): Promise<TestPlan | null> {
```

Add import at top of file:

```typescript
import { analyzeComponentContext } from './import-graph.js';
```

Replace the visual-check block (lines 52-64) with:

```typescript
  // No interactive elements — generate a visual-check plan
  if (elements.length === 0) {
    return buildVisualCheckPlan(filePath, planName, baseName, baseUrl, options?.projectRoot);
  }
```

And replace the second visual-check block (lines 68-80) similarly:

```typescript
  if (steps.length <= 1) {
    return buildVisualCheckPlan(filePath, planName, baseName, baseUrl, options?.projectRoot);
  }
```

Add the helper function:

```typescript
async function buildVisualCheckPlan(
  filePath: string,
  planName: string,
  baseName: string,
  baseUrl: string,
  projectRoot?: string,
): Promise<TestPlan> {
  const steps: TestStep[] = [];
  let tags = ['auto-generated', 'visual-check'];
  let stepNum = 1;

  // Try static import graph analysis for navigation context
  if (projectRoot) {
    const ctx = await analyzeComponentContext(filePath, projectRoot, baseUrl);
    if (ctx && ctx.navigationSteps.length > 0) {
      // Add navigate to baseUrl first
      steps.push({
        stepNumber: stepNum++,
        action: 'navigate',
        description: 'Open app',
        target: baseUrl,
      });
      steps.push({
        stepNumber: stepNum++,
        action: 'wait',
        description: 'Wait for page load',
        condition: 'timeout',
        timeout: 500,
      });

      // Add navigation steps from import graph analysis
      for (const navStep of ctx.navigationSteps) {
        steps.push({ ...navStep, stepNumber: stepNum++ });
      }
      steps.push({
        stepNumber: stepNum++,
        action: 'wait',
        description: 'Wait for transition',
        condition: 'timeout',
        timeout: 500,
      });

      tags = [...tags, 'navigated'];
    }
  }

  // If no navigation steps were added, use simple wait
  if (steps.length === 0) {
    steps.push({
      stepNumber: stepNum++,
      action: 'wait',
      description: 'Wait for page to render',
      condition: 'timeout',
      timeout: 1000,
    });
  }

  // Always end with screenshot
  steps.push({
    stepNumber: stepNum++,
    action: 'screenshot',
    description: `Capture visual state of ${baseName}`,
  });

  return {
    planName,
    description: `Visual check for ${baseName}`,
    baseUrl,
    steps,
    tags,
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/TimNice/Development/popcorn && npx vitest run hook/src/__tests__/plan-generator.test.ts`
Expected: PASS (all tests including the new one)

**Step 5: Run full test suite**

Run: `cd /Users/TimNice/Development/popcorn && npm test`
Expected: All 276+ tests pass

**Step 6: Commit**

```bash
git add hook/src/plan-generator.ts hook/src/__tests__/plan-generator.test.ts
git commit -m "feat(hook): integrate import graph analysis into visual-check plan generation"
```

---

## Task 8: Pass projectRoot from Hook Runner to Plan Generator

**Files:**
- Modify: `hook/src/claude-hook-runner.ts` (line 106-108)

**Step 1: Update the generatePlanFromFile() call to pass projectRoot**

In `hook/src/claude-hook-runner.ts`, find the `generatePlanFromFile` call (around line 106) and add `projectRoot`:

```typescript
    const generatedPlan = await generatePlanFromFile(absFilePath, {
      baseUrl: config.baseUrl ?? '/',
      projectRoot,
    });
```

This is the only change — `projectRoot` is already defined on line 70 as `const projectRoot = process.cwd();`.

**Step 2: Run full test suite**

Run: `cd /Users/TimNice/Development/popcorn && npm test`
Expected: All tests pass

**Step 3: Build**

Run: `cd /Users/TimNice/Development/popcorn && npm run build`
Expected: Clean compile

**Step 4: Commit**

```bash
git add hook/src/claude-hook-runner.ts
git commit -m "feat(hook): pass projectRoot to plan generator for import graph analysis"
```

---

## Task 9: Multi-State Discovery in Extension Content Script

**Files:**
- Modify: `extension/src/content/actions.ts` (lines 53-54, screenshot handler)
- Modify: `extension/src/__tests__/actions.test.ts`

**Step 1: Write failing test**

Add to `extension/src/__tests__/actions.test.ts`:

```typescript
  it('screenshot with multi-state-discovery name discovers navigation controls', async () => {
    document.body.innerHTML = `
      <div class="slide">Main content</div>
      <div role="tab">Tab 1</div>
      <div role="tab">Tab 2</div>
      <button aria-label="Next slide">→</button>
    `;

    const step: TestStep = {
      stepNumber: 1,
      action: 'screenshot',
      description: 'Discover states',
      name: 'multi-state-discovery',
    };

    const result = await executeAction(step);

    expect(result.passed).toBe(true);
    expect(result.metadata).toBeDefined();
    expect(result.metadata!.discoveredControls).toBeGreaterThan(0);
  });
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/TimNice/Development/popcorn && npx vitest run extension/src/__tests__/actions.test.ts`
Expected: FAIL — no `discoveredControls` metadata from screenshot handler

**Step 3: Implement multi-state discovery**

In `extension/src/content/actions.ts`, replace the screenshot case (lines 53-54):

```typescript
      case 'screenshot':
        result = step.name === 'multi-state-discovery'
          ? await handleMultiStateDiscovery(step)
          : { passed: true }; // Regular screenshot handled by orchestrator
        break;
```

Add the handler function:

```typescript
const NAVIGATION_SELECTORS = [
  '[role="tab"]',
  '[data-slide]',
  '[data-slide-index]',
  '.carousel-control',
  'button[aria-label*="next"]',
  'button[aria-label*="Next"]',
  'button[aria-label*="prev"]',
  'button[aria-label*="Prev"]',
  '.pagination a',
  '.progress-dot',
  '.dot',
  '.nav-dot',
  'button[aria-label*="slide"]',
].join(', ');

async function handleMultiStateDiscovery(_step: TestStep): Promise<ActionResult> {
  const controls = document.querySelectorAll(NAVIGATION_SELECTORS);
  const discoveredControls = controls.length;

  // Click through each discovered control to cycle states
  const statesVisited: string[] = [];
  for (const control of Array.from(controls)) {
    if (control instanceof HTMLElement) {
      const label = control.getAttribute('aria-label')
        || control.textContent?.trim().slice(0, 30)
        || control.tagName;
      control.click();
      await waitForTimeout(300);
      statesVisited.push(label);
    }
  }

  return {
    passed: true,
    metadata: {
      discoveredControls,
      statesVisited,
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/TimNice/Development/popcorn && npx vitest run extension/src/__tests__/actions.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `cd /Users/TimNice/Development/popcorn && npm test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add extension/src/content/actions.ts extension/src/__tests__/actions.test.ts
git commit -m "feat(extension): add multi-state-discovery screenshot handler for runtime fallback"
```

---

## Task 10: Full Build + Final Verification

**Step 1: Run full test suite**

Run: `cd /Users/TimNice/Development/popcorn && npm test`
Expected: All tests pass (276+ existing + ~15 new = ~291)

**Step 2: Build all workspaces**

Run: `cd /Users/TimNice/Development/popcorn && npm run build`
Expected: Clean compile, no errors

**Step 3: Manual smoke test**

Run the hook runner against the builddex-deck project to verify end-to-end:

```bash
cd /Users/TimNice/Development/builddex-deck
# Delete old plan to force regeneration
rm -f test-plans/slide-product.json
# Run the hook runner manually
echo '{"tool_name":"Edit","tool_input":{"file_path":"src/components/slides/SlideProduct.tsx"},"tool_response":"ok"}' | node /Users/TimNice/Development/popcorn/hook/dist/claude-hook-runner.js
```

Expected output:
```
[popcorn:claude-hook] INFO File changed: src/components/slides/SlideProduct.tsx
[popcorn:claude-hook] INFO No matching test plan for 'SlideProduct', generating one...
[popcorn:claude-hook] INFO Generated visual-check plan saved: .../test-plans/slide-product.json
```

Then verify the generated plan includes navigation steps:

```bash
cat test-plans/slide-product.json | python3 -m json.tool
```

Expected: Plan with `navigate`, `click` (progress dot), `wait`, `screenshot` steps and `navigated` tag.

**Step 4: Commit final state**

```bash
git add -A
git commit -m "feat: route-aware visual testing — static import graph + runtime fallback

Auto-navigates to the correct page/state before screenshotting a changed
component. Uses regex-based import graph analysis to detect array rendering,
routes, and conditionals. Falls back to multi-state discovery in the extension
when static analysis fails."
```

---

## Summary

| Task | What | New Tests |
|------|------|-----------|
| 1 | NavigationHint types | 0 |
| 2 | `findImporters()` | 4 |
| 3 | `detectRenderingPattern()` | 8 |
| 4 | `detectNavigationControl()` | 4 |
| 5 | `resolveNavigationSteps()` | 5 |
| 6 | `analyzeComponentContext()` | 3 |
| 7 | Integrate into plan-generator | 1 |
| 8 | Wire hook runner | 0 |
| 9 | Multi-state discovery (extension) | 1 |
| 10 | Full build + verification | 0 |
| **Total** | | **~26 new tests** |
