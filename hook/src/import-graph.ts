/**
 * Import graph analysis for route-aware visual testing.
 *
 * When a component file changes, the plan generator creates a visual-check plan
 * (wait + screenshot). This module traces imports upward to find the parent page
 * and detect how the component is rendered (array item, route, conditional, direct),
 * enabling the plan generator to navigate to the correct page/state first.
 *
 * Uses regex heuristics — not a full parser. Zero external dependencies.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { TestStep } from '@popcorn/shared';

// ── Types ──────────────────────────────────────────────────────────────

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

/** How to navigate between items in an array-rendered component. */
export type NavigationControl =
  | { type: 'indexed-click'; selectorTemplate: string }
  | { type: 'sequential-click'; nextSelector: string }
  | { type: 'keypress'; key: string };

/** Result of analyzing a component's rendering context. */
export interface ComponentContext {
  hint: NavigationHint;
  parentFilePath: string;
  navigationSteps: TestStep[];
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Directories to skip when scanning for importers. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'build']);

/** File extensions to include when scanning for importers. */
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

/** Maximum directory recursion depth when scanning. */
const MAX_DEPTH = 5;

/** Escapes special regex characters in a string. */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── findImporters ──────────────────────────────────────────────────────

/**
 * Scans all .tsx/.ts/.jsx/.js files under `rootDir` for import statements
 * that reference `targetFilePath`. Returns an array of Importer objects.
 *
 * Matching strategy: extracts the base name (without extension) from the
 * target file and looks for `import ... from '...<baseName>'` patterns.
 * This handles both relative imports and alias imports (e.g., `@/components/Card`).
 *
 * Skips node_modules, .git, dist, .next, build directories.
 * Does not recurse deeper than 5 levels.
 * Skips the target file itself.
 */
export async function findImporters(
  targetFilePath: string,
  rootDir: string,
): Promise<Importer[]> {
  const targetBaseName = path.basename(
    targetFilePath,
    path.extname(targetFilePath),
  );
  const targetAbsolute = path.resolve(targetFilePath);

  // Build regex: import ... from '...<baseName>'
  // The \b ensures we match the full component name, not a substring.
  const importPattern = new RegExp(
    `import\\s+.*from\\s+['"][^'"]*\\b${escapeRegex(targetBaseName)}['"]`,
  );

  const importers: Importer[] = [];

  async function scanDir(dir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return;

    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true, encoding: 'utf8' });
    } catch {
      return; // Skip unreadable directories
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          await scanDir(fullPath, depth + 1);
        }
        continue;
      }

      if (!entry.isFile()) continue;

      const ext = path.extname(entry.name);
      if (!SOURCE_EXTENSIONS.has(ext)) continue;

      // Skip the target file itself
      if (path.resolve(fullPath) === targetAbsolute) continue;

      let source: string;
      try {
        source = await fs.readFile(fullPath, 'utf-8');
      } catch {
        continue; // Skip unreadable files
      }

      if (importPattern.test(source)) {
        importers.push({ filePath: fullPath, source });
      }
    }
  }

  await scanDir(rootDir, 0);
  return importers;
}

// ── detectRenderingPattern ─────────────────────────────────────────────

/**
 * Analyzes the source code of a parent file to determine how a component
 * is rendered. Runs pattern detectors in priority order:
 *   array -> route -> conditional -> direct
 *
 * Returns null if the component name is not found in the source at all.
 */
export function detectRenderingPattern(
  source: string,
  componentName: string,
): NavigationHint | null {
  const escaped = escapeRegex(componentName);

  // Quick check: is the component referenced at all?
  if (!new RegExp(escaped).test(source)) {
    return null;
  }

  // Priority 1: Array rendering
  const arrayHint = detectArrayRendering(source, componentName, escaped);
  if (arrayHint) return arrayHint;

  // Priority 2: Route rendering
  const routeHint = detectRouteRendering(source, escaped);
  if (routeHint) return routeHint;

  // Priority 3: Conditional rendering
  const conditionalHint = detectConditionalRendering(source, componentName, escaped);
  if (conditionalHint) return conditionalHint;

  // Priority 4: Direct JSX usage
  if (new RegExp(`<${escaped}[\\s/>]`).test(source)) {
    return { type: 'direct' };
  }

  // Component name appears (e.g., in a comment or string) but not as JSX
  return null;
}

/**
 * Detects array rendering pattern: `const ITEMS = [A, B, ComponentName, D]`
 * Returns the index within the array and the array name.
 */
function detectArrayRendering(
  source: string,
  componentName: string,
  escaped: string,
): NavigationHint | null {
  const arrayRegex = /const\s+(\w+)\s*=\s*\[([\s\S]*?)\]/g;
  let match: RegExpExecArray | null;

  while ((match = arrayRegex.exec(source)) !== null) {
    const arrayName = match[1];
    const arrayBody = match[2];

    // Split array items by comma, trimming whitespace
    const items = arrayBody
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    const index = items.findIndex((item) =>
      new RegExp(`^${escaped}$`).test(item),
    );

    if (index !== -1) {
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

/**
 * Detects React Router route pattern:
 *   <Route path="/product" element={<ComponentName />} />
 *   <Route element={<ComponentName />} path="/product" />
 */
function detectRouteRendering(
  source: string,
  escaped: string,
): NavigationHint | null {
  // Pattern 1: path before element
  const routeRegex1 = new RegExp(
    `<Route\\s+[^>]*path=["']([^"']+)["'][^>]*element=\\{<${escaped}[\\s/>]`,
  );
  const match1 = routeRegex1.exec(source);
  if (match1) {
    return { type: 'route', path: match1[1] };
  }

  // Pattern 2: element before path (reversed attribute order)
  const routeRegex2 = new RegExp(
    `<Route\\s+[^>]*element=\\{<${escaped}[^}]*\\}[^>]*path=["']([^"']+)["']`,
  );
  const match2 = routeRegex2.exec(source);
  if (match2) {
    return { type: 'route', path: match2[1] };
  }

  return null;
}

/**
 * Detects conditional rendering pattern:
 *   activeTab === 'product' && <ComponentName />
 */
function detectConditionalRendering(
  source: string,
  _componentName: string,
  escaped: string,
): NavigationHint | null {
  const conditionalRegex = new RegExp(
    `(\\w+)\\s*===?\\s*['"]([\\w-]+)['"]\\s*&&\\s*<${escaped}`,
  );
  const match = conditionalRegex.exec(source);
  if (match) {
    return {
      type: 'conditional',
      stateVar: match[1],
      value: match[2],
    };
  }

  return null;
}

// ── detectNavigationControl ──────────────────────────────────────────

/**
 * Detects the navigation control pattern in a parent component's source.
 * Looks for ProgressBar/dots, next/prev buttons, or keyboard navigation.
 * Returns a fallback keypress control if nothing specific is detected.
 */
export function detectNavigationControl(
  source: string,
  _arrayName: string,
): NavigationControl {
  // Priority 1: ProgressBar / dots with onNavigate or similar handler
  if (/onNavigate|onDotClick|onIndicatorClick/i.test(source)) {
    return {
      type: 'indexed-click',
      selectorTemplate:
        '[data-slide-index="{index}"], .progress-dot:nth-child({n})',
    };
  }

  // Priority 2: Next/prev button
  if (/onClick=\{[^}]*(next|forward|goNext)/i.test(source)) {
    return {
      type: 'sequential-click',
      nextSelector: 'button',
    };
  }

  // Priority 3: Keyboard navigation
  if (/ArrowRight|ArrowDown/.test(source)) {
    return {
      type: 'keypress',
      key: 'ArrowRight',
    };
  }

  // Default fallback
  return {
    type: 'keypress',
    key: 'ArrowRight',
  };
}

// ── resolveNavigationSteps ───────────────────────────────────────────

/**
 * Converts a NavigationHint + NavigationControl into concrete TestStep[]
 * that navigate to the correct page/state before the visual check.
 *
 * All steps use stepNumber 0; the caller re-numbers them.
 */
export function resolveNavigationSteps(
  hint: NavigationHint,
  baseUrl: string,
  control: NavigationControl | null,
  _componentName: string,
): TestStep[] {
  const normalizedBase = baseUrl.replace(/\/+$/, '');

  if (hint.type === 'route') {
    return [
      {
        stepNumber: 0,
        action: 'navigate',
        description: `Navigate to ${hint.path}`,
        target: `${normalizedBase}${hint.path}`,
      },
    ];
  }

  if (hint.type === 'array') {
    if (control?.type === 'indexed-click') {
      const selector = control.selectorTemplate
        .replace('{index}', String(hint.index))
        .replace('{n}', String(hint.index + 1));
      return [
        {
          stepNumber: 0,
          action: 'click',
          description: `Click slide index ${hint.index}`,
          selector,
        },
      ];
    }

    if (control?.type === 'sequential-click') {
      const steps: TestStep[] = [];
      for (let i = 0; i < hint.index; i++) {
        steps.push({
          stepNumber: 0,
          action: 'click',
          description: `Click next (${i + 1}/${hint.index})`,
          selector: control.nextSelector,
        });
      }
      return steps;
    }

    // keypress control or null control — press N times
    const key = control?.type === 'keypress' ? control.key : 'ArrowRight';
    const steps: TestStep[] = [];
    for (let i = 0; i < hint.index; i++) {
      steps.push({
        stepNumber: 0,
        action: 'keypress',
        description: `Press ${key} (${i + 1}/${hint.index})`,
        key,
      });
    }
    return steps;
  }

  // conditional and direct: can't reliably navigate
  return [];
}

// ── analyzeComponentContext ──────────────────────────────────────────

/**
 * High-level orchestrator: given a component file path, finds its parent,
 * detects the rendering pattern, and resolves navigation steps.
 *
 * Returns null if no importer is found or no rendering pattern is detected.
 */
export async function analyzeComponentContext(
  filePath: string,
  projectRoot: string,
  baseUrl: string,
): Promise<ComponentContext | null> {
  const componentName = path.basename(filePath, path.extname(filePath));

  const importers = await findImporters(filePath, projectRoot);
  if (importers.length === 0) return null;

  for (const importer of importers) {
    const hint = detectRenderingPattern(importer.source, componentName);
    if (!hint) continue;

    let control: NavigationControl | null = null;
    if (hint.type === 'array') {
      control = detectNavigationControl(importer.source, hint.arrayName);
    }

    const navigationSteps = resolveNavigationSteps(
      hint,
      baseUrl,
      control,
      componentName,
    );

    return {
      hint,
      parentFilePath: importer.filePath,
      navigationSteps,
    };
  }

  return null;
}
