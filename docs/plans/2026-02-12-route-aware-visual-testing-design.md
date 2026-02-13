# Route-Aware Visual Testing

**Date:** 2026-02-12
**Status:** Approved
**Approach:** C (Hybrid — static import graph analysis + runtime fallback)

## Problem

When a display-only component is edited (e.g., `SlideProduct.tsx` — slide 4 in a deck), Popcorn generates a visual-check plan that screenshots whatever is currently on screen. But the changed component may not be visible without navigating to the correct page, tab, slide, or state first. The plan needs to automatically include navigation steps to reach the component before capturing.

## Requirements

- **General solution** — works across routes, array-rendered slides, tabs, modals, conditionals
- **Zero config** — no annotations, decorators, or manifest files required
- **Graceful degradation** — if static analysis fails, fall back to runtime discovery

## Design

### Phase 1: Static Import Graph Analysis (Hook-Side)

Runs at plan-generation time in `plan-generator.ts`.

#### Step 1: Find Importers

`findImporters(filePath, projectRoot)` scans all `.tsx/.ts/.jsx/.js` files for import statements referencing the changed file. Uses fast regex matching on file contents, not AST parsing (keeps it fast and dependency-free).

Search pattern: `import\s+.*from\s+['"].*<basename>['"]` where `<basename>` is the filename without extension.

Returns: `Array<{ filePath: string; source: string }>` — the importing files and their contents.

#### Step 2: Detect Rendering Pattern

`detectRenderingPattern(importerSource, componentName)` runs pattern detectors in priority order. First match wins.

**Array detector:**
```regex
const\s+(\w+)\s*=\s*\[([^\]]*)\]
```
Checks if `componentName` appears in the array. Returns `{ type: 'array', index: N, arrayName: string, totalItems: number }`.

Handles: slide decks, carousel items, step wizards, tab content arrays.

**Route detector:**
```regex
<Route\s+[^>]*path=["']([^"']+)["'][^>]*element=\{<ComponentName\s*\/?>
```
Returns `{ type: 'route', path: string }`.

Handles: React Router, basic path-based routing.

**Conditional detector:**
```regex
(\w+)\s*===?\s*['"](\w+)['"]\s*&&\s*<ComponentName
```
Returns `{ type: 'conditional', stateVar: string, value: string }`.

Handles: tab panels, toggle content, conditional renders.

**Direct render (no navigation needed):**
If the component appears in JSX without any conditional/array/route wrapper, it's directly rendered. Returns `{ type: 'direct' }`.

#### Step 3: Detect Navigation Controls

For `array` type hints, we need to find what UI element navigates between items. Scan the parent file for:

1. **ProgressBar / dots / indicators** — elements with `onNavigate`, `onClick` with index, or `nth-child` selectors
2. **Next/prev buttons** — buttons with arrow icons, "next"/"prev" text, or keyboard handlers
3. **Keyboard navigation** — `onKeyDown` handlers for ArrowRight/ArrowLeft

Returns a selector string or a keypress action.

#### Step 4: Generate Navigation Steps

Convert the `NavigationHint` into `TestStep[]`:

- **`route`**: `[{ action: 'navigate', target: baseUrl + path }]`
- **`array`**:
  - If nav control found: `[{ action: 'click', selector: controlSelector, description: 'Navigate to item N' }]` repeated N times, OR a single click on an indexed control (like progress dot N)
  - If no control found: `[{ action: 'keypress', key: 'ArrowRight' }]` repeated N times
- **`conditional`**: `[{ action: 'click', selector: triggerSelector, description: 'Activate tab/state' }]`
- **`direct`**: No extra steps

### Phase 2: Runtime Fallback (Extension-Side)

When static analysis returns no hint (complex dynamic rendering, lazy loading, etc.), the extension performs multi-state screenshot capture.

Triggered by a step with `name: 'multi-state-discovery'`:

1. Capture baseline screenshot
2. Query page for navigation affordances: `[role="tab"], [data-slide], .carousel-control, button[aria-label*="next"], .pagination a, .progress-dot`
3. Click through each discovered control, capturing a screenshot after each
4. Return all screenshots as an array

This lives in `content/actions.ts` as a handler for the `screenshot` action when `name === 'multi-state-discovery'`.

### Phase 3: Plan Assembly

The final visual-check plan for a component like `SlideProduct` at index 3:

```json
{
  "planName": "slide-product",
  "description": "Visual check for SlideProduct (navigated to slide 4)",
  "baseUrl": "http://localhost:8080",
  "steps": [
    { "stepNumber": 1, "action": "navigate", "target": "http://localhost:8080", "description": "Open app" },
    { "stepNumber": 2, "action": "wait", "condition": "timeout", "timeout": 500, "description": "Wait for page load" },
    { "stepNumber": 3, "action": "click", "selector": ".progress-dot:nth-child(4)", "description": "Navigate to slide 4 (SlideProduct)" },
    { "stepNumber": 4, "action": "wait", "condition": "timeout", "timeout": 500, "description": "Wait for transition" },
    { "stepNumber": 5, "action": "screenshot", "description": "Capture visual state of SlideProduct" }
  ],
  "tags": ["auto-generated", "visual-check", "navigated"]
}
```

If static analysis fails, the fallback plan:

```json
{
  "steps": [
    { "stepNumber": 1, "action": "navigate", "target": "http://localhost:8080" },
    { "stepNumber": 2, "action": "wait", "condition": "timeout", "timeout": 500 },
    { "stepNumber": 3, "action": "screenshot", "name": "multi-state-discovery", "description": "Discover and capture all visible states" }
  ],
  "tags": ["auto-generated", "visual-check", "multi-state"]
}
```

## New Files

| File | Purpose | ~Lines |
|------|---------|--------|
| `hook/src/import-graph.ts` | `findImporters()`, `detectRenderingPattern()`, `resolveNavigationSteps()` | ~200 |
| `hook/src/__tests__/import-graph.test.ts` | Unit tests for all pattern detectors and navigation step generation | ~250 |

## Modified Files

| File | Changes |
|------|---------|
| `hook/src/plan-generator.ts` | Call `analyzeComponentContext()` in the visual-check path, prepend navigation steps |
| `hook/src/__tests__/plan-generator.test.ts` | Add tests for navigation-aware visual-check plans |
| `extension/src/content/actions.ts` | Add `multi-state-discovery` handler for screenshot action |
| `extension/src/__tests__/actions.test.ts` | Test multi-state discovery |

## Key Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Regex vs AST | Regex | Zero deps, fast, good enough for common patterns |
| Import scanning scope | First 2 levels up | Avoids scanning entire project; most components are 1-2 imports from a page |
| Navigation control detection | Heuristic selectors | Works for common UI patterns; runtime fallback covers edge cases |
| Multi-state capture | Extension-side | Already has DOM access and screenshot capability |

## Verification

1. Unit tests for all pattern detectors (array, route, conditional, direct)
2. Unit tests for navigation step generation
3. Integration: edit `SlideProduct.tsx` → generated plan includes navigation to slide 4 → screenshot shows correct slide
4. Fallback: component in complex dynamic render → multi-state discovery captures all states
5. All existing tests continue to pass
