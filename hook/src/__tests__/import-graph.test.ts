import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { findImporters, detectRenderingPattern } from '../import-graph.js';

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
