import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  findImporters,
  detectRenderingPattern,
  detectNavigationControl,
  resolveNavigationSteps,
  analyzeComponentContext,
  findRouteForComponent,
} from '../import-graph.js';
import type { NavigationHint, NavigationControl } from '../import-graph.js';

// ── findImporters ──────────────────────────────────────────────────────

describe('findImporters', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'popcorn-import-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('finds a file that imports the target component', async () => {
    // Create directory structure
    const componentsDir = path.join(tmpDir, 'components');
    await fs.mkdir(componentsDir, { recursive: true });

    // Target component
    const targetPath = path.join(componentsDir, 'SlideProduct.tsx');
    await fs.writeFile(
      targetPath,
      `export function SlideProduct() { return <div>Product</div>; }`,
    );

    // File that imports the target
    const indexPath = path.join(tmpDir, 'Index.tsx');
    await fs.writeFile(
      indexPath,
      `import SlideProduct from './components/SlideProduct';\nexport default function Index() { return <SlideProduct />; }`,
    );

    const importers = await findImporters(targetPath, tmpDir);

    expect(importers).toHaveLength(1);
    expect(importers[0].filePath).toBe(indexPath);
    expect(importers[0].source).toContain("import SlideProduct from './components/SlideProduct'");
  });

  it('returns empty array when no file imports the target', async () => {
    const targetPath = path.join(tmpDir, 'Orphan.tsx');
    await fs.writeFile(targetPath, `export function Orphan() { return <div />; }`);

    const otherPath = path.join(tmpDir, 'Other.tsx');
    await fs.writeFile(
      otherPath,
      `import Something from './Something';\nexport default function Other() { return <div />; }`,
    );

    const importers = await findImporters(targetPath, tmpDir);
    expect(importers).toHaveLength(0);
  });

  it('ignores node_modules and .git directories', async () => {
    const targetPath = path.join(tmpDir, 'Card.tsx');
    await fs.writeFile(targetPath, `export function Card() { return <div />; }`);

    // Create files inside node_modules and .git that import Card
    const nodeModulesDir = path.join(tmpDir, 'node_modules', 'some-pkg');
    await fs.mkdir(nodeModulesDir, { recursive: true });
    await fs.writeFile(
      path.join(nodeModulesDir, 'index.ts'),
      `import Card from '../../Card';`,
    );

    const gitDir = path.join(tmpDir, '.git', 'hooks');
    await fs.mkdir(gitDir, { recursive: true });
    await fs.writeFile(
      path.join(gitDir, 'pre-commit.ts'),
      `import Card from '../../Card';`,
    );

    const importers = await findImporters(targetPath, tmpDir);
    expect(importers).toHaveLength(0);
  });

  it('handles aliased imports like @/ paths', async () => {
    const componentsDir = path.join(tmpDir, 'components');
    await fs.mkdir(componentsDir, { recursive: true });

    const targetPath = path.join(componentsDir, 'Card.tsx');
    await fs.writeFile(targetPath, `export function Card() { return <div />; }`);

    // File using alias import
    const pagePath = path.join(tmpDir, 'Page.tsx');
    await fs.writeFile(
      pagePath,
      `import Card from '@/components/Card';\nexport default function Page() { return <Card />; }`,
    );

    const importers = await findImporters(targetPath, tmpDir);

    expect(importers).toHaveLength(1);
    expect(importers[0].filePath).toBe(pagePath);
  });
});

// ── detectRenderingPattern ─────────────────────────────────────────────

describe('detectRenderingPattern', () => {
  it('detects array rendering with correct index', () => {
    const source = `
import SlideA from './SlideA';
import SlideB from './SlideB';
import SlideProduct from './SlideProduct';
import SlideD from './SlideD';

const SLIDES = [SlideA, SlideB, SlideProduct, SlideD];

export default function Deck() {
  return <div>{SLIDES.map(S => <S key={S.name} />)}</div>;
}`;

    const hint = detectRenderingPattern(source, 'SlideProduct');

    expect(hint).not.toBeNull();
    expect(hint!.type).toBe('array');
    if (hint!.type === 'array') {
      expect(hint!.index).toBe(2);
      expect(hint!.arrayName).toBe('SLIDES');
      expect(hint!.totalItems).toBe(4);
    }
  });

  it('detects array rendering at index 0', () => {
    const source = `const TABS = [SlideProduct, SlideB, SlideC];`;

    const hint = detectRenderingPattern(source, 'SlideProduct');

    expect(hint).not.toBeNull();
    expect(hint!.type).toBe('array');
    if (hint!.type === 'array') {
      expect(hint!.index).toBe(0);
      expect(hint!.arrayName).toBe('TABS');
      expect(hint!.totalItems).toBe(3);
    }
  });

  it('detects React Router route', () => {
    const source = `
import { Route, Routes } from 'react-router-dom';
import SlideProduct from './SlideProduct';

export default function App() {
  return (
    <Routes>
      <Route path="/product" element={<SlideProduct />} />
    </Routes>
  );
}`;

    const hint = detectRenderingPattern(source, 'SlideProduct');

    expect(hint).not.toBeNull();
    expect(hint!.type).toBe('route');
    if (hint!.type === 'route') {
      expect(hint!.path).toBe('/product');
    }
  });

  it('detects route with nested path', () => {
    const source = `<Route path="/dashboard/settings/profile" element={<ProfileSettings />} />`;

    const hint = detectRenderingPattern(source, 'ProfileSettings');

    expect(hint).not.toBeNull();
    expect(hint!.type).toBe('route');
    if (hint!.type === 'route') {
      expect(hint!.path).toBe('/dashboard/settings/profile');
    }
  });

  it('detects conditional rendering', () => {
    const source = `
export default function Tabs() {
  const [activeTab, setActiveTab] = useState('home');
  return (
    <div>
      {activeTab === 'product' && <SlideProduct />}
    </div>
  );
}`;

    const hint = detectRenderingPattern(source, 'SlideProduct');

    expect(hint).not.toBeNull();
    expect(hint!.type).toBe('conditional');
    if (hint!.type === 'conditional') {
      expect(hint!.stateVar).toBe('activeTab');
      expect(hint!.value).toBe('product');
    }
  });

  it('returns direct for simple JSX usage', () => {
    const source = `
export default function Page() {
  return (
    <main>
      <SlideProduct />
    </main>
  );
}`;

    const hint = detectRenderingPattern(source, 'SlideProduct');

    expect(hint).not.toBeNull();
    expect(hint!.type).toBe('direct');
  });

  it('returns null when component is not found in source', () => {
    const source = `
export default function Page() {
  return <div>No such component here</div>;
}`;

    const hint = detectRenderingPattern(source, 'SlideProduct');

    expect(hint).toBeNull();
  });

  it('handles multiline array declarations', () => {
    const source = `
const SLIDES = [
  SlideIntro,
  SlideProduct,
  SlideOutro,
];

export default function Deck() {
  return <div>{SLIDES.map(S => <S />)}</div>;
}`;

    const hint = detectRenderingPattern(source, 'SlideProduct');

    expect(hint).not.toBeNull();
    expect(hint!.type).toBe('array');
    if (hint!.type === 'array') {
      expect(hint!.index).toBe(1);
      expect(hint!.arrayName).toBe('SLIDES');
      expect(hint!.totalItems).toBe(3);
    }
  });
});

// ── detectNavigationControl ─────────────────────────────────────────

describe('detectNavigationControl', () => {
  it('detects ProgressBar with onNavigate prop', () => {
    const source = `
const SLIDES = [SlideA, SlideB, SlideC];
export default function Deck() {
  const [idx, setIdx] = useState(0);
  return (
    <div>
      <ProgressBar onNavigate={(i) => setIdx(i)} />
      {SLIDES.map((S, i) => <S key={i} />)}
    </div>
  );
}`;

    const control = detectNavigationControl(source, 'SLIDES');

    expect(control.type).toBe('indexed-click');
    if (control.type === 'indexed-click') {
      expect(control.selectorTemplate).toContain('data-slide-index');
      expect(control.selectorTemplate).toContain('progress-dot');
    }
  });

  it('prefers keyboard navigation when both onNavigate and ArrowRight are present', () => {
    const source = `
const SLIDES = [SlideA, SlideB, SlideC];
export default function Deck() {
  const { currentSlide, goTo } = useSlideNavigation(SLIDES.length);
  return (
    <div>
      {SLIDES[currentSlide]}
      <ProgressBar onNavigate={(i) => goTo(i)} />
    </div>
  );
}`;

    const control = detectNavigationControl(source, 'SLIDES');

    // Keyboard navigation should take priority over indexed-click
    expect(control.type).toBe('keypress');
    if (control.type === 'keypress') {
      expect(control.key).toBe('ArrowRight');
    }
  });

  it('detects next/prev button pattern', () => {
    const source = `
const SLIDES = [SlideA, SlideB];
export default function Deck() {
  const [idx, setIdx] = useState(0);
  return (
    <div>
      {SLIDES[idx]}
      <button onClick={() => goNext()}>Next</button>
    </div>
  );
}`;

    const control = detectNavigationControl(source, 'SLIDES');

    expect(control.type).toBe('sequential-click');
    if (control.type === 'sequential-click') {
      expect(control.nextSelector).toBe('button');
    }
  });

  it('detects keyboard navigation via onKeyDown', () => {
    const source = `
const SLIDES = [SlideA, SlideB, SlideC];
export default function Deck() {
  const [idx, setIdx] = useState(0);
  const handleKeyDown = (e) => {
    if (e.key === 'ArrowRight') setIdx(i => i + 1);
  };
  return <div onKeyDown={handleKeyDown}>{SLIDES[idx]}</div>;
}`;

    const control = detectNavigationControl(source, 'SLIDES');

    expect(control.type).toBe('keypress');
    if (control.type === 'keypress') {
      expect(control.key).toBe('ArrowRight');
    }
  });

  it('returns default keypress fallback when no control found', () => {
    const source = `
const ITEMS = [ItemA, ItemB];
export default function List() {
  return <div>{ITEMS.map(I => <I />)}</div>;
}`;

    const control = detectNavigationControl(source, 'ITEMS');

    expect(control.type).toBe('keypress');
    if (control.type === 'keypress') {
      expect(control.key).toBe('ArrowRight');
    }
  });
});

// ── resolveNavigationSteps ──────────────────────────────────────────

describe('resolveNavigationSteps', () => {
  it('generates navigate step for route hint', () => {
    const hint: NavigationHint = { type: 'route', path: '/product' };
    const steps = resolveNavigationSteps(hint, 'http://localhost:3000', null, 'SlideProduct');

    expect(steps).toHaveLength(1);
    expect(steps[0].action).toBe('navigate');
    expect(steps[0].target).toBe('http://localhost:3000/product');
    expect(steps[0].stepNumber).toBe(0);
  });

  it('generates indexed click steps for array hint with indexed control', () => {
    const hint: NavigationHint = { type: 'array', index: 2, arrayName: 'SLIDES', totalItems: 4 };
    const control: NavigationControl = {
      type: 'indexed-click',
      selectorTemplate: '[data-slide-index="{index}"], .progress-dot:nth-child({n})',
    };

    const steps = resolveNavigationSteps(hint, 'http://localhost:3000', control, 'SlideProduct');

    expect(steps).toHaveLength(1);
    expect(steps[0].action).toBe('click');
    expect(steps[0].selector).toContain('data-slide-index="2"');
    expect(steps[0].selector).toContain('nth-child(3)');
  });

  it('generates repeated keypress steps with waits for array hint with keypress control', () => {
    const hint: NavigationHint = { type: 'array', index: 3, arrayName: 'SLIDES', totalItems: 5 };
    const control: NavigationControl = { type: 'keypress', key: 'ArrowRight' };

    const steps = resolveNavigationSteps(hint, 'http://localhost:3000', control, 'SlideProduct');

    // 3 keypresses with 2 waits between them: key, wait, key, wait, key
    expect(steps).toHaveLength(5);

    const keypressSteps = steps.filter(s => s.action === 'keypress');
    expect(keypressSteps).toHaveLength(3);
    for (const step of keypressSteps) {
      expect(step.key).toBe('ArrowRight');
      expect(step.stepNumber).toBe(0);
    }

    const waitSteps = steps.filter(s => s.action === 'wait');
    expect(waitSteps).toHaveLength(2);
    for (const step of waitSteps) {
      expect(step.timeout).toBe(400);
    }
  });

  it('generates no steps for direct hint', () => {
    const hint: NavigationHint = { type: 'direct' };
    const steps = resolveNavigationSteps(hint, 'http://localhost:3000', null, 'SlideProduct');

    expect(steps).toHaveLength(0);
  });

  it('generates repeated sequential clicks with waits for array with sequential control', () => {
    const hint: NavigationHint = { type: 'array', index: 2, arrayName: 'SLIDES', totalItems: 4 };
    const control: NavigationControl = { type: 'sequential-click', nextSelector: 'button' };

    const steps = resolveNavigationSteps(hint, 'http://localhost:3000/', control, 'SlideProduct');

    // 2 clicks with 1 wait between them: click, wait, click
    expect(steps).toHaveLength(3);

    const clickSteps = steps.filter(s => s.action === 'click');
    expect(clickSteps).toHaveLength(2);
    for (const step of clickSteps) {
      expect(step.selector).toBe('button');
      expect(step.stepNumber).toBe(0);
    }

    const waitSteps = steps.filter(s => s.action === 'wait');
    expect(waitSteps).toHaveLength(1);
    expect(waitSteps[0].timeout).toBe(400);
  });
});

// ── analyzeComponentContext ─────────────────────────────────────────

describe('analyzeComponentContext', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'popcorn-ctx-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns navigation steps for array-rendered component', async () => {
    const componentsDir = path.join(tmpDir, 'components');
    await fs.mkdir(componentsDir, { recursive: true });

    // Target component
    const targetPath = path.join(componentsDir, 'SlideProduct.tsx');
    await fs.writeFile(
      targetPath,
      `export function SlideProduct() { return <div>Product</div>; }`,
    );

    // Parent with array rendering and ProgressBar
    const parentPath = path.join(tmpDir, 'Deck.tsx');
    await fs.writeFile(
      parentPath,
      `import SlideA from './components/SlideA';
import SlideProduct from './components/SlideProduct';
import SlideC from './components/SlideC';

const SLIDES = [SlideA, SlideProduct, SlideC];

export default function Deck() {
  const [idx, setIdx] = useState(0);
  return (
    <div>
      <ProgressBar onNavigate={(i) => setIdx(i)} />
      {SLIDES[idx]}
    </div>
  );
}`,
    );

    const ctx = await analyzeComponentContext(
      targetPath,
      tmpDir,
      'http://localhost:3000',
    );

    expect(ctx).not.toBeNull();
    expect(ctx!.hint.type).toBe('array');
    if (ctx!.hint.type === 'array') {
      expect(ctx!.hint.index).toBe(1);
    }
    expect(ctx!.parentFilePath).toBe(parentPath);
    expect(ctx!.navigationSteps).toHaveLength(1);
    expect(ctx!.navigationSteps[0].action).toBe('click');
  });

  it('returns null when no importer is found', async () => {
    const targetPath = path.join(tmpDir, 'Orphan.tsx');
    await fs.writeFile(
      targetPath,
      `export function Orphan() { return <div />; }`,
    );

    const ctx = await analyzeComponentContext(
      targetPath,
      tmpDir,
      'http://localhost:3000',
    );

    expect(ctx).toBeNull();
  });

  it('returns route navigation for routed component', async () => {
    const componentsDir = path.join(tmpDir, 'pages');
    await fs.mkdir(componentsDir, { recursive: true });

    // Target component
    const targetPath = path.join(componentsDir, 'ProductPage.tsx');
    await fs.writeFile(
      targetPath,
      `export default function ProductPage() { return <div>Product</div>; }`,
    );

    // Parent with route rendering
    const parentPath = path.join(tmpDir, 'App.tsx');
    await fs.writeFile(
      parentPath,
      `import { Route, Routes } from 'react-router-dom';
import ProductPage from './pages/ProductPage';

export default function App() {
  return (
    <Routes>
      <Route path="/product" element={<ProductPage />} />
    </Routes>
  );
}`,
    );

    const ctx = await analyzeComponentContext(
      targetPath,
      tmpDir,
      'http://localhost:3000',
    );

    expect(ctx).not.toBeNull();
    expect(ctx!.hint.type).toBe('route');
    if (ctx!.hint.type === 'route') {
      expect(ctx!.hint.path).toBe('/product');
    }
    expect(ctx!.parentFilePath).toBe(parentPath);
    expect(ctx!.navigationSteps).toHaveLength(1);
    expect(ctx!.navigationSteps[0].action).toBe('navigate');
    expect(ctx!.navigationSteps[0].target).toBe('http://localhost:3000/product');
  });
});

// ── findRouteForComponent ──────────────────────────────────────────

describe('findRouteForComponent', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'popcorn-route-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('finds route one level up (direct parent has Route)', async () => {
    const pagesDir = path.join(tmpDir, 'pages');
    await fs.mkdir(pagesDir, { recursive: true });

    // Target component
    const targetPath = path.join(pagesDir, 'Dashboard.tsx');
    await fs.writeFile(
      targetPath,
      `export default function Dashboard() { return <div>Dashboard</div>; }`,
    );

    // App.tsx with route
    await fs.writeFile(
      path.join(tmpDir, 'App.tsx'),
      `import Dashboard from './pages/Dashboard';
import { Route, Routes } from 'react-router-dom';

export default function App() {
  return (
    <Routes>
      <Route path="/dashboard" element={<Dashboard />} />
    </Routes>
  );
}`,
    );

    const route = await findRouteForComponent(targetPath, tmpDir);
    expect(route).toBe('/dashboard');
  });

  it('finds route two levels up (nested component → page → route)', async () => {
    const componentsDir = path.join(tmpDir, 'components');
    await fs.mkdir(componentsDir, { recursive: true });

    // Target: DashboardCard.tsx (leaf component)
    const targetPath = path.join(componentsDir, 'DashboardCard.tsx');
    await fs.writeFile(
      targetPath,
      `export default function DashboardCard() { return <div>Card</div>; }`,
    );

    // Dashboard.tsx imports DashboardCard
    const dashboardPath = path.join(tmpDir, 'Dashboard.tsx');
    await fs.writeFile(
      dashboardPath,
      `import DashboardCard from './components/DashboardCard';
export default function Dashboard() { return <DashboardCard />; }`,
    );

    // App.tsx has route for Dashboard
    await fs.writeFile(
      path.join(tmpDir, 'App.tsx'),
      `import Dashboard from './Dashboard';
import { Route, Routes } from 'react-router-dom';

export default function App() {
  return (
    <Routes>
      <Route path="/dashboard" element={<Dashboard />} />
    </Routes>
  );
}`,
    );

    const route = await findRouteForComponent(targetPath, tmpDir);
    expect(route).toBe('/dashboard');
  });

  it('finds route three levels up (deeply nested)', async () => {
    const uiDir = path.join(tmpDir, 'ui');
    const dashDir = path.join(tmpDir, 'dashboard');
    const pagesDir = path.join(tmpDir, 'pages');
    await fs.mkdir(uiDir, { recursive: true });
    await fs.mkdir(dashDir, { recursive: true });
    await fs.mkdir(pagesDir, { recursive: true });

    // Target: Card.tsx (ui primitive)
    const targetPath = path.join(uiDir, 'Card.tsx');
    await fs.writeFile(targetPath, `export function Card() { return <div />; }`);

    // DashboardCard imports Card
    await fs.writeFile(
      path.join(dashDir, 'DashboardCard.tsx'),
      `import { Card } from '../ui/Card';
export function DashboardCard() { return <Card />; }`,
    );

    // DashboardPage imports DashboardCard
    await fs.writeFile(
      path.join(pagesDir, 'DashboardPage.tsx'),
      `import { DashboardCard } from '../dashboard/DashboardCard';
export default function DashboardPage() { return <DashboardCard />; }`,
    );

    // App.tsx has route for DashboardPage
    await fs.writeFile(
      path.join(tmpDir, 'App.tsx'),
      `import DashboardPage from './pages/DashboardPage';
import { Route, Routes } from 'react-router-dom';

export default function App() {
  return (
    <Routes>
      <Route path="/dashboard" element={<DashboardPage />} />
    </Routes>
  );
}`,
    );

    const route = await findRouteForComponent(targetPath, tmpDir);
    expect(route).toBe('/dashboard');
  });

  it('returns null when no route is found', async () => {
    const targetPath = path.join(tmpDir, 'Orphan.tsx');
    await fs.writeFile(targetPath, `export function Orphan() { return <div />; }`);

    const route = await findRouteForComponent(targetPath, tmpDir);
    expect(route).toBeNull();
  });

  it('handles circular imports without infinite loop', async () => {
    // A imports B, B imports A — should not hang
    const aPath = path.join(tmpDir, 'CompA.tsx');
    const bPath = path.join(tmpDir, 'CompB.tsx');

    await fs.writeFile(
      aPath,
      `import CompB from './CompB';
export default function CompA() { return <CompB />; }`,
    );
    await fs.writeFile(
      bPath,
      `import CompA from './CompA';
export default function CompB() { return <CompA />; }`,
    );

    const route = await findRouteForComponent(aPath, tmpDir);
    expect(route).toBeNull();
  });

  it('respects depth limit', async () => {
    // Create a chain deeper than MAX_ROUTE_DEPTH (5)
    const dirs = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    for (const d of dirs) {
      await fs.mkdir(path.join(tmpDir, d), { recursive: true });
    }

    // Target at the bottom
    const targetPath = path.join(tmpDir, 'a', 'Leaf.tsx');
    await fs.writeFile(targetPath, `export default function Leaf() { return <div />; }`);

    // Chain: Leaf → L1 → L2 → L3 → L4 → L5 → App (with route)
    const chainNames = ['L1', 'L2', 'L3', 'L4', 'L5'];
    let prevName = 'Leaf';
    let prevDir = 'a';
    for (let i = 0; i < chainNames.length; i++) {
      const name = chainNames[i];
      const dir = dirs[i + 1];
      await fs.writeFile(
        path.join(tmpDir, dir, `${name}.tsx`),
        `import ${prevName} from '../${prevDir}/${prevName}';
export default function ${name}() { return <${prevName} />; }`,
      );
      prevName = name;
      prevDir = dir;
    }

    // App.tsx at level 6 — beyond depth limit of 5
    await fs.writeFile(
      path.join(tmpDir, 'g', 'App.tsx'),
      `import L5 from '../f/L5';
import { Route, Routes } from 'react-router-dom';

export default function App() {
  return <Routes><Route path="/deep" element={<L5 />} /></Routes>;
}`,
    );

    const route = await findRouteForComponent(targetPath, tmpDir);
    // With depth limit of 5, it should not reach the route at level 6
    expect(route).toBeNull();
  });
});
