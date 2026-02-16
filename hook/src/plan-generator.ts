/**
 * Template-based test plan generator for Popcorn.
 *
 * When no matching test plan exists for a changed file, this module
 * scans the source code for JSX/HTML patterns (forms, inputs, buttons, etc.)
 * and generates a reasonable test plan automatically.
 *
 * Uses regex heuristics — not a full parser. Designed for zero-config
 * operation (no API key, no external dependencies, instant execution).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { TestPlan, TestStep, DetectedElement } from '@popcorn/shared';
import { buildSteps } from '@popcorn/shared';
import { analyzeComponentContext, findRouteForComponent } from './import-graph.js';

// Re-export from shared for backward compatibility
export type { DetectedElement } from '@popcorn/shared';
export { buildSteps, getPlaceholderValue, PLACEHOLDER_VALUES } from '@popcorn/shared';

// ---------------------------------------------------------------------------
// Project context: sniff package.json for framework & UI library detection
// ---------------------------------------------------------------------------

export interface ProjectContext {
  /** UI component libraries detected in dependencies */
  uiLibraries: string[];
  /** Framework detected: 'nextjs' | 'remix' | 'astro' | null */
  framework: string | null;
  /** Whether the project uses TypeScript */
  typescript: boolean;
}

const projectContextCache = new Map<string, ProjectContext>();

/**
 * Reads package.json from the project root and detects UI libraries and framework.
 * Results are cached per projectRoot.
 */
export async function sniffProjectDeps(
  projectRoot: string,
): Promise<ProjectContext> {
  const cached = projectContextCache.get(projectRoot);
  if (cached) return cached;

  const ctx: ProjectContext = { uiLibraries: [], framework: null, typescript: false };

  try {
    const raw = await fs.readFile(path.join(projectRoot, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    const deps = {
      ...(typeof pkg.dependencies === 'object' && pkg.dependencies !== null ? pkg.dependencies : {}),
      ...(typeof pkg.devDependencies === 'object' && pkg.devDependencies !== null ? pkg.devDependencies : {}),
    } as Record<string, string>;

    // Detect framework
    if ('next' in deps) ctx.framework = 'nextjs';
    else if ('@remix-run/react' in deps) ctx.framework = 'remix';
    else if ('astro' in deps) ctx.framework = 'astro';

    // Detect UI libraries
    for (const libPrefix of Object.keys(COMPONENT_LIBRARY_MAP)) {
      const match = Object.keys(deps).some(
        (d) => d === libPrefix || d.startsWith(libPrefix + '/'),
      );
      if (match) ctx.uiLibraries.push(libPrefix);
    }

    // TypeScript
    if ('typescript' in deps) ctx.typescript = true;
  } catch {
    // No package.json or invalid — return defaults
  }

  projectContextCache.set(projectRoot, ctx);
  return ctx;
}

/** Clear the project context cache (for testing). */
export function clearProjectContextCache(): void {
  projectContextCache.clear();
}

// ---------------------------------------------------------------------------
// Component library mapping
// ---------------------------------------------------------------------------

/**
 * Maps component library package prefixes to component name → HTML semantic type.
 * Used to detect UI library components (MUI, Chakra, Ant Design, etc.) in JSX.
 */
export const COMPONENT_LIBRARY_MAP: Record<string, Record<string, DetectedElement['type']>> = {
  '@mui/material': {
    TextField: 'input',
    Input: 'input',
    OutlinedInput: 'input',
    FilledInput: 'input',
    Select: 'select',
    NativeSelect: 'select',
    Checkbox: 'checkbox',
    Button: 'button',
    IconButton: 'button',
    Fab: 'button',
    LoadingButton: 'button',
    Switch: 'checkbox',
    Radio: 'checkbox',
    Autocomplete: 'select',
    TextareaAutosize: 'textarea',
    Link: 'link',
  },
  '@chakra-ui/react': {
    Input: 'input',
    Select: 'select',
    Checkbox: 'checkbox',
    Button: 'button',
    IconButton: 'button',
    Textarea: 'textarea',
    Switch: 'checkbox',
    Link: 'link',
    NumberInput: 'input',
    PinInput: 'input',
  },
  antd: {
    Input: 'input',
    Select: 'select',
    Checkbox: 'checkbox',
    Button: 'button',
    Switch: 'checkbox',
    DatePicker: 'input',
    Form: 'form',
    Radio: 'checkbox',
    Cascader: 'select',
    AutoComplete: 'select',
  },
  '@radix-ui': {
    Trigger: 'button',
    Input: 'input',
    Close: 'button',
    Submit: 'button',
  },
  '@headlessui/react': {
    Button: 'button',
    Input: 'input',
    Select: 'select',
    Checkbox: 'checkbox',
    Switch: 'checkbox',
    Textarea: 'textarea',
    Listbox: 'select',
    Combobox: 'select',
  },
};

/**
 * Generates a test plan from a source file by analyzing its JSX/HTML patterns.
 * For interactive components, generates interaction steps (fill, click, etc.).
 * For display-only components, generates a visual-check plan (screenshot capture).
 */
export async function generatePlanFromFile(
  filePath: string,
  options?: { baseUrl?: string; projectRoot?: string; projectContext?: ProjectContext },
): Promise<TestPlan | null> {
  const content = await fs.readFile(filePath, 'utf-8');

  // Sniff project context if not provided
  let projectContext = options?.projectContext;
  if (!projectContext && options?.projectRoot) {
    projectContext = await sniffProjectDeps(options.projectRoot);
  }

  const elements = detectElements(content, projectContext);

  const baseName = path.basename(filePath, path.extname(filePath));
  const planName = toKebabCase(baseName);

  // Infer route from file path if projectRoot is available.
  // Always store relative paths in auto-generated plans — the hook runner
  // resolves them against config.baseUrl at runtime (claude-hook-runner.ts:129-137).
  // Strip any origin from the provided baseUrl so only the path is kept.
  let baseUrl = '/';
  if (options?.baseUrl) {
    try {
      const parsed = new URL(options.baseUrl);
      baseUrl = parsed.pathname || '/';
    } catch {
      // Already relative — use as-is
      baseUrl = options.baseUrl;
    }
  }
  if (options?.projectRoot) {
    const inferredRoute = inferRouteFromFilePath(
      filePath,
      options.projectRoot,
      projectContext?.framework ?? null,
    );
    if (inferredRoute) {
      baseUrl = inferredRoute;
    }
  }

  // Discover the route where this component is rendered by walking the
  // import chain recursively (e.g., Card → DashboardCard → Dashboard → Route).
  let route: string | undefined;
  if (options?.projectRoot) {
    const discovered = await findRouteForComponent(filePath, options.projectRoot);
    if (discovered) {
      route = discovered;
    }
  }

  // No interactive elements — generate a visual-check plan
  if (elements.length === 0) {
    return buildVisualCheckPlan(filePath, planName, baseName, baseUrl, options?.projectRoot, route);
  }

  const steps = buildSteps(elements, baseUrl);

  if (steps.length <= 1) {
    // Only a navigate step — fall back to visual-check
    return buildVisualCheckPlan(filePath, planName, baseName, baseUrl, options?.projectRoot, route);
  }

  return {
    planName,
    description: `Auto-generated test plan for ${baseName}`,
    baseUrl,
    route,
    steps,
    tags: ['auto-generated'],
  };
}

/**
 * Builds a visual-check plan, optionally enriched with navigation steps
 * from static import graph analysis when projectRoot is provided.
 */
async function buildVisualCheckPlan(
  filePath: string,
  planName: string,
  baseName: string,
  baseUrl: string,
  projectRoot?: string,
  route?: string,
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
    route,
    steps,
    tags,
  };
}

/**
 * Saves a generated test plan to the test-plans directory.
 * Returns the file path where the plan was saved.
 */
export async function savePlan(
  plan: TestPlan,
  testPlansDir: string,
): Promise<string> {
  await fs.mkdir(testPlansDir, { recursive: true });
  const fileName = `${plan.planName}.json`;
  const filePath = path.resolve(testPlansDir, fileName);
  await fs.writeFile(filePath, JSON.stringify(plan, null, 2) + '\n');
  return filePath;
}

/**
 * Scans source code for JSX/HTML patterns that indicate interactive elements.
 * Uses regex-based heuristics — not a full parser.
 *
 * Detects:
 * 1. Native HTML elements (<input>, <button>, <form>, etc.)
 * 2. Component library elements (MUI, Chakra, Ant Design, Radix, Headless UI)
 *    when imports from those libraries are found in the file
 *
 * Also extracts text content from buttons/links to populate the `label` field,
 * and disambiguates duplicate selectors using data-testid, aria-label, or nth-of-type.
 */
export function detectElements(
  content: string,
  projectContext?: ProjectContext,
): DetectedElement[] {
  const elements: DetectedElement[] = [];

  // --- Native HTML element detection ---

  // Detect <form> elements
  if (/<form[\s>]/.test(content)) {
    elements.push({ type: 'form', selector: 'form' });
  }

  // Detect <input> elements with name or id attributes
  const inputRegex = /<input\b([^>]*?)(?:\/>|>)/g;
  let match: RegExpExecArray | null;
  while ((match = inputRegex.exec(content)) !== null) {
    const attrs = match[1];
    const name = extractAttr(attrs, 'name');
    const id = extractAttr(attrs, 'id');
    const type = extractAttr(attrs, 'type') ?? 'text';
    const testId = extractAttr(attrs, 'data-testid');
    const ariaLabel = extractAttr(attrs, 'aria-label');

    if (type === 'hidden') continue;

    if (type === 'checkbox' || type === 'radio') {
      const selector = testId ? `[data-testid="${testId}"]` : id ? `#${id}` : name ? `input[name="${name}"]` : null;
      if (selector) {
        elements.push({ type: 'checkbox', selector, name: name ?? undefined, inputType: type, label: ariaLabel ?? undefined });
      }
    } else if (type === 'submit') {
      const selector = testId ? `[data-testid="${testId}"]` : id ? `#${id}` : 'input[type="submit"]';
      elements.push({ type: 'button', selector, name: name ?? undefined });
    } else {
      const selector = testId ? `[data-testid="${testId}"]` : id ? `#${id}` : name ? `input[name="${name}"]` : null;
      if (selector) {
        elements.push({ type: 'input', selector, name: name ?? undefined, inputType: type, label: ariaLabel ?? undefined });
      }
    }
  }

  // Detect <textarea> elements
  const textareaRegex = /<textarea\b([^>]*?)>/g;
  while ((match = textareaRegex.exec(content)) !== null) {
    const attrs = match[1];
    const name = extractAttr(attrs, 'name');
    const id = extractAttr(attrs, 'id');
    const testId = extractAttr(attrs, 'data-testid');
    const selector = testId ? `[data-testid="${testId}"]` : id ? `#${id}` : name ? `textarea[name="${name}"]` : 'textarea';
    elements.push({ type: 'textarea', selector, name: name ?? undefined });
  }

  // Detect <select> elements
  const selectRegex = /<select\b([^>]*?)>/g;
  while ((match = selectRegex.exec(content)) !== null) {
    const attrs = match[1];
    const name = extractAttr(attrs, 'name');
    const id = extractAttr(attrs, 'id');
    const testId = extractAttr(attrs, 'data-testid');
    const selector = testId ? `[data-testid="${testId}"]` : id ? `#${id}` : name ? `select[name="${name}"]` : 'select';
    elements.push({ type: 'select', selector, name: name ?? undefined });
  }

  // Detect <button> elements (with text content extraction)
  const buttonRegex = /<button\b([^>]*?)>/g;
  while ((match = buttonRegex.exec(content)) !== null) {
    const attrs = match[1];
    const id = extractAttr(attrs, 'id');
    const type = extractAttr(attrs, 'type');
    const testId = extractAttr(attrs, 'data-testid');
    const ariaLabel = extractAttr(attrs, 'aria-label');
    const label = extractTextContent(content, match.index, 'button') ?? ariaLabel ?? undefined;
    const selector = testId
      ? `[data-testid="${testId}"]`
      : id
        ? `#${id}`
        : type === 'submit'
          ? 'button[type="submit"]'
          : 'button';
    elements.push({ type: 'button', selector, label });
  }

  // Detect <a href="..."> links with navigation targets (with text content extraction)
  const linkRegex = /<a\b([^>]*?)>/g;
  while ((match = linkRegex.exec(content)) !== null) {
    const attrs = match[1];
    const href = extractAttr(attrs, 'href');
    const id = extractAttr(attrs, 'id');
    const testId = extractAttr(attrs, 'data-testid');
    const ariaLabel = extractAttr(attrs, 'aria-label');
    if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
      const label = extractTextContent(content, match.index, 'a') ?? ariaLabel ?? undefined;
      const selector = testId
        ? `[data-testid="${testId}"]`
        : id
          ? `#${id}`
          : `a[href="${href}"]`;
      elements.push({ type: 'link', selector, href: href ?? undefined, label });
    }
  }

  // --- Component library element detection ---
  const libraryElements = detectComponentLibraryElements(content, projectContext);
  // Merge, deduplicating by selector
  const existingSelectors = new Set(elements.map((e) => e.selector));
  for (const el of libraryElements) {
    if (!existingSelectors.has(el.selector)) {
      elements.push(el);
      existingSelectors.add(el.selector);
    }
  }

  // --- Disambiguate duplicate selectors ---
  return disambiguateSelectors(elements, content);
}

// ---------------------------------------------------------------------------
// Text content extraction
// ---------------------------------------------------------------------------

/**
 * Extracts the text content between an opening and closing JSX/HTML tag.
 * Strips nested JSX tags and JSX expressions ({...}).
 * Returns null if no closing tag is found or content is purely dynamic.
 */
export function extractTextContent(
  content: string,
  tagStartIndex: number,
  tagName: string,
): string | null {
  // Find the end of the opening tag
  const openTagEnd = content.indexOf('>', tagStartIndex);
  if (openTagEnd === -1) return null;

  // Self-closing tag check
  if (content[openTagEnd - 1] === '/') return null;

  // Find the closing tag (case-sensitive for JSX)
  const closeTag = `</${tagName}>`;
  const closeIndex = content.indexOf(closeTag, openTagEnd + 1);
  if (closeIndex === -1) return null;

  const inner = content.slice(openTagEnd + 1, closeIndex);

  // Strip nested JSX tags: anything between < and >
  const noTags = inner.replace(/<[^>]*>/g, '');

  // Strip JSX expressions: {...}
  const noExpressions = noTags.replace(/\{[^}]*\}/g, '');

  const trimmed = noExpressions.replace(/\s+/g, ' ').trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ---------------------------------------------------------------------------
// Component library detection via import scanning
// ---------------------------------------------------------------------------

/**
 * Detects component library elements by parsing import statements and
 * scanning for JSX usage of mapped components.
 */
export function detectComponentLibraryElements(
  content: string,
  projectContext?: ProjectContext,
): DetectedElement[] {
  const elements: DetectedElement[] = [];

  // Parse all import statements
  // Each entry maps: originalName (for library map lookup) → localName (for JSX scanning)
  const importRegex = /import\s+(?:\{([^}]+)\}|(\w+))\s+from\s+['"]([^'"]+)['"]/g;
  const imports: Array<{ nameMap: Array<{ original: string; local: string }>; packageName: string; isNamespace: boolean }> = [];

  let importMatch: RegExpExecArray | null;
  while ((importMatch = importRegex.exec(content)) !== null) {
    const namedImports = importMatch[1];
    const defaultImport = importMatch[2];
    const packageName = importMatch[3];

    if (namedImports) {
      const nameMap = namedImports.split(',').map((n) => {
        const parts = n.trim().split(/\s+as\s+/);
        const original = parts[0].trim();
        const local = (parts[1] ?? parts[0]).trim();
        return { original, local };
      }).filter((n) => n.original.length > 0);
      imports.push({ nameMap, packageName, isNamespace: false });
    }
    if (defaultImport) {
      imports.push({ nameMap: [{ original: defaultImport, local: defaultImport }], packageName, isNamespace: false });
    }
  }

  // Also handle namespace imports: import * as Dialog from '@radix-ui/react-dialog'
  const namespaceRegex = /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;
  let nsMatch: RegExpExecArray | null;
  while ((nsMatch = namespaceRegex.exec(content)) !== null) {
    imports.push({ nameMap: [{ original: nsMatch[1], local: nsMatch[1] }], packageName: nsMatch[2], isNamespace: true });
  }

  // Match imports against COMPONENT_LIBRARY_MAP
  for (const imp of imports) {
    // Find matching library
    let libraryMap: Record<string, DetectedElement['type']> | undefined;
    for (const [libPrefix, map] of Object.entries(COMPONENT_LIBRARY_MAP)) {
      if (imp.packageName === libPrefix || imp.packageName.startsWith(libPrefix + '/')) {
        // If projectContext is available, only check libraries that are actually installed
        if (projectContext && projectContext.uiLibraries.length > 0) {
          if (!projectContext.uiLibraries.some((l) => imp.packageName === l || imp.packageName.startsWith(l + '/'))) {
            continue;
          }
        }
        libraryMap = map;
        break;
      }
    }
    if (!libraryMap) continue;

    if (imp.isNamespace) {
      // Namespace import: look for Namespace.ComponentName usage (e.g., Dialog.Trigger)
      const nsName = imp.nameMap[0].local;
      for (const [compName, elementType] of Object.entries(libraryMap)) {
        const jsxPattern = new RegExp(`<${nsName}\\.${compName}\\b([^>]*?)(?:\\/>|>)`, 'g');
        let jsxMatch: RegExpExecArray | null;
        while ((jsxMatch = jsxPattern.exec(content)) !== null) {
          const attrs = jsxMatch[1];
          const el = buildElementFromAttrs(attrs, elementType, content, jsxMatch.index, `${nsName}.${compName}`);
          if (el) elements.push(el);
        }
      }
    } else {
      // Named/default imports: use original name for map lookup, local name for JSX scanning
      for (const { original, local } of imp.nameMap) {
        const mappedType = libraryMap[original];
        if (!mappedType) continue;

        // Scan for <LocalName ... /> or <LocalName ...>
        const jsxPattern = new RegExp(`<${local}\\b([^>]*?)(?:\\/>|>)`, 'g');
        let jsxMatch: RegExpExecArray | null;
        while ((jsxMatch = jsxPattern.exec(content)) !== null) {
          const attrs = jsxMatch[1];
          const el = buildElementFromAttrs(attrs, mappedType, content, jsxMatch.index, local);
          if (el) elements.push(el);
        }
      }
    }
  }

  return elements;
}

/**
 * Builds a DetectedElement from attributes extracted from a JSX tag.
 * Used by both native and component library detection.
 */
function buildElementFromAttrs(
  attrs: string,
  type: DetectedElement['type'],
  content: string,
  matchIndex: number,
  tagName: string,
): DetectedElement | null {
  const name = extractAttr(attrs, 'name');
  const id = extractAttr(attrs, 'id');
  const testId = extractAttr(attrs, 'data-testid');
  const ariaLabel = extractAttr(attrs, 'aria-label');
  const href = extractAttr(attrs, 'href');
  const inputType = extractAttr(attrs, 'type') ?? undefined;
  const label = extractAttr(attrs, 'label'); // MUI/Chakra use label prop

  // Build selector (priority: data-testid > id > name-based > tag)
  let selector: string;
  if (testId) {
    selector = `[data-testid="${testId}"]`;
  } else if (id) {
    selector = `#${id}`;
  } else if (name && (type === 'input' || type === 'textarea' || type === 'select' || type === 'checkbox')) {
    const tag = type === 'checkbox' ? 'input' : type;
    selector = `${tag}[name="${name}"]`;
  } else if (href && type === 'link') {
    selector = `a[href="${href}"]`;
  } else {
    // Generic selector — will be disambiguated later
    const tagForSelector = type === 'checkbox' ? 'input[type="checkbox"]' : type === 'link' ? 'a' : type === 'form' ? 'form' : type;
    selector = tagForSelector;
  }

  // Extract text content for buttons and links
  const textContent = (type === 'button' || type === 'link')
    ? extractTextContent(content, matchIndex, tagName)
    : null;

  const elementLabel = textContent ?? label ?? ariaLabel ?? undefined;

  return {
    type,
    selector,
    name: name ?? undefined,
    href: href ?? undefined,
    inputType,
    label: elementLabel,
  };
}

// ---------------------------------------------------------------------------
// Selector disambiguation
// ---------------------------------------------------------------------------

/**
 * Post-processes detected elements to disambiguate duplicate selectors.
 * Uses data-testid, aria-label, or nth-of-type as fallback.
 */
export function disambiguateSelectors(
  elements: DetectedElement[],
  _content: string,
): DetectedElement[] {
  // Group by selector
  const selectorCounts = new Map<string, number>();
  for (const el of elements) {
    selectorCounts.set(el.selector, (selectorCounts.get(el.selector) ?? 0) + 1);
  }

  // For selectors with duplicates, assign nth-of-type
  const selectorIndices = new Map<string, number>();
  return elements.map((el) => {
    const count = selectorCounts.get(el.selector) ?? 1;
    if (count <= 1) return el;

    // Already unique via data-testid or id — skip
    if (el.selector.startsWith('[data-testid=') || el.selector.startsWith('#')) return el;

    const idx = (selectorIndices.get(el.selector) ?? 0) + 1;
    selectorIndices.set(el.selector, idx);

    return {
      ...el,
      selector: `${el.selector}:nth-of-type(${idx})`,
    };
  });
}

// ---------------------------------------------------------------------------
// Route inference from framework file paths
// ---------------------------------------------------------------------------

/**
 * Infers a route URL from the file's position in a framework routing directory.
 * Returns null if no convention is detected.
 */
export function inferRouteFromFilePath(
  filePath: string,
  projectRoot: string,
  framework: string | null,
): string | null {
  const rel = path.relative(projectRoot, filePath).replace(/\\/g, '/');

  // Next.js App Router: app/**/page.{tsx,ts,jsx,js}
  if (framework === 'nextjs' || framework === null) {
    const appRouterMatch = rel.match(/^(?:src\/)?app\/(.+)\/page\.\w+$/);
    if (appRouterMatch) {
      const route = '/' + appRouterMatch[1].replace(/\(.*?\)\//g, ''); // strip route groups
      return route;
    }

    // Next.js Pages Router: pages/**/*.{tsx,ts,jsx,js} (but not _app, _document, _error)
    const pagesMatch = rel.match(/^(?:src\/)?pages\/(.+)\.\w+$/);
    if (pagesMatch) {
      const pagePath = pagesMatch[1];
      if (pagePath.startsWith('_') || pagePath.startsWith('api/')) return null;
      const route = pagePath === 'index' ? '/' : '/' + pagePath.replace(/\/index$/, '');
      return route;
    }
  }

  // Remix: app/routes/**/*.{tsx,ts,jsx,js}
  if (framework === 'remix' || framework === null) {
    const remixMatch = rel.match(/^app\/routes\/(.+)\.\w+$/);
    if (remixMatch) {
      let route = remixMatch[1]
        .replace(/\./g, '/') // Remix dot notation → slashes
        .replace(/_index$/, '') // _index → parent route
        .replace(/_/g, ''); // pathless layout routes
      if (route === '') return '/';
      return '/' + route;
    }
  }

  // Astro: src/pages/**/*.{astro,tsx,ts,jsx,js}
  if (framework === 'astro' || framework === null) {
    const astroMatch = rel.match(/^src\/pages\/(.+)\.\w+$/);
    if (astroMatch) {
      const pagePath = astroMatch[1];
      const route = pagePath === 'index' ? '/' : '/' + pagePath.replace(/\/index$/, '');
      return route;
    }
  }

  return null;
}

/**
 * Extracts an HTML attribute value from an attribute string.
 * Handles single quotes, double quotes, and JSX curly brace expressions.
 */
export function extractAttr(attrString: string, attrName: string): string | null {
  const regex = new RegExp(
    `${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|\\{["\`']([^"'\`]*)["\`']\\})`,
    'i',
  );
  const m = regex.exec(attrString);
  return m ? (m[1] ?? m[2] ?? m[3] ?? null) : null;
}

function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}
