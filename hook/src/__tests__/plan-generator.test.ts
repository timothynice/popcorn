import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  detectElements,
  extractAttr,
  getPlaceholderValue,
  buildSteps,
  generatePlanFromFile,
  savePlan,
} from '../plan-generator.js';

describe('extractAttr', () => {
  it('extracts double-quoted attribute', () => {
    expect(extractAttr(' name="email" type="text"', 'name')).toBe('email');
  });

  it('extracts single-quoted attribute', () => {
    expect(extractAttr(" name='email'", 'name')).toBe('email');
  });

  it('extracts JSX curly-brace attribute', () => {
    expect(extractAttr(' name={"email"}', 'name')).toBe('email');
  });

  it('returns null when attribute is missing', () => {
    expect(extractAttr(' type="text"', 'name')).toBeNull();
  });
});

describe('detectElements', () => {
  it('finds <input name="email"> and returns correct selector', () => {
    const elements = detectElements('<input name="email" type="email" />');
    expect(elements).toHaveLength(1);
    expect(elements[0]).toMatchObject({
      type: 'input',
      selector: 'input[name="email"]',
      inputType: 'email',
    });
  });

  it('finds <button type="submit">', () => {
    const elements = detectElements('<button type="submit">Submit</button>');
    expect(elements).toHaveLength(1);
    expect(elements[0]).toMatchObject({
      type: 'button',
      selector: 'button[type="submit"]',
    });
  });

  it('finds <form> tag', () => {
    const elements = detectElements('<form onSubmit={handleSubmit}></form>');
    const form = elements.find((e) => e.type === 'form');
    expect(form).toBeDefined();
    expect(form!.selector).toBe('form');
  });

  it('finds <select> and <textarea> elements', () => {
    const src = '<select name="country"></select><textarea name="bio"></textarea>';
    const elements = detectElements(src);
    const select = elements.find((e) => e.type === 'select');
    const textarea = elements.find((e) => e.type === 'textarea');
    expect(select).toBeDefined();
    expect(select!.selector).toBe('select[name="country"]');
    expect(textarea).toBeDefined();
    expect(textarea!.selector).toBe('textarea[name="bio"]');
  });

  it('finds <a href="/dashboard"> links', () => {
    const elements = detectElements('<a href="/dashboard">Go</a>');
    expect(elements).toHaveLength(1);
    expect(elements[0]).toMatchObject({
      type: 'link',
      selector: 'a[href="/dashboard"]',
      href: '/dashboard',
    });
  });

  it('ignores hidden inputs', () => {
    const elements = detectElements('<input type="hidden" name="csrf" />');
    expect(elements).toHaveLength(0);
  });

  it('ignores # links and javascript: links', () => {
    const src = '<a href="#">Top</a><a href="javascript:void(0)">Click</a>';
    const elements = detectElements(src);
    expect(elements).toHaveLength(0);
  });

  it('returns empty array for file with no interactive elements', () => {
    const src = 'export const PI = 3.14159;\nconst add = (a, b) => a + b;';
    const elements = detectElements(src);
    expect(elements).toHaveLength(0);
  });

  it('detects checkbox inputs', () => {
    const elements = detectElements('<input type="checkbox" name="terms" />');
    expect(elements).toHaveLength(1);
    expect(elements[0]).toMatchObject({
      type: 'checkbox',
      selector: 'input[name="terms"]',
    });
  });

  it('uses id for selector when available', () => {
    const elements = detectElements('<input id="email-field" name="email" />');
    expect(elements[0].selector).toBe('#email-field');
  });

  it('detects input type="submit" as button', () => {
    const elements = detectElements('<input type="submit" />');
    expect(elements).toHaveLength(1);
    expect(elements[0].type).toBe('button');
  });
});

describe('getPlaceholderValue', () => {
  it('returns email placeholder for email fields', () => {
    expect(getPlaceholderValue('email')).toBe('test@example.com');
    expect(getPlaceholderValue('user_email')).toBe('test@example.com');
  });

  it('returns password placeholder for password fields', () => {
    expect(getPlaceholderValue('password')).toBe('Test1234!');
  });

  it('uses inputType as fallback', () => {
    expect(getPlaceholderValue(undefined, 'email')).toBe('test@example.com');
    expect(getPlaceholderValue(undefined, 'password')).toBe('Test1234!');
    expect(getPlaceholderValue(undefined, 'tel')).toBe('555-0100');
  });

  it('returns generic value for unknown fields', () => {
    expect(getPlaceholderValue('custom_field')).toBe('test value');
  });
});

describe('buildSteps', () => {
  it('orders steps: navigate, fill, select, check, click, assert', () => {
    const elements = [
      { type: 'form' as const, selector: 'form' },
      { type: 'input' as const, selector: 'input[name="email"]', name: 'email', inputType: 'email' },
      { type: 'select' as const, selector: 'select[name="role"]', name: 'role' },
      { type: 'checkbox' as const, selector: 'input[name="terms"]', name: 'terms' },
      { type: 'button' as const, selector: 'button[type="submit"]' },
    ];

    const steps = buildSteps(elements, '/');

    expect(steps[0].action).toBe('navigate');
    expect(steps[1].action).toBe('fill');
    expect(steps[2].action).toBe('select');
    expect(steps[3].action).toBe('check');
    expect(steps[4].action).toBe('click');
    expect(steps[5].action).toBe('wait');
    expect(steps[6].action).toBe('screenshot');
    expect(steps[7].action).toBe('assert');

    // Verify step numbers are sequential
    steps.forEach((step, i) => {
      expect(step.stepNumber).toBe(i + 1);
    });
  });

  it('filters buttons by primary intent labels and caps at 3', () => {
    const elements = [
      { type: 'button' as const, selector: 'button:nth-of-type(1)', label: 'Previous slide' },
      { type: 'button' as const, selector: 'button:nth-of-type(2)', label: 'Go to slide 1' },
      { type: 'button' as const, selector: 'button:nth-of-type(3)', label: 'Go to slide 2' },
      { type: 'button' as const, selector: 'button:nth-of-type(4)', label: 'Next slide' },
      { type: 'button' as const, selector: 'button:nth-of-type(5)', label: 'Submit' },
    ];

    const steps = buildSteps(elements, '/');
    const clickSteps = steps.filter((s) => s.action === 'click');

    // "Next slide" matches /next/i, "Submit" matches /submit/i — both are primary
    // The 3 non-primary buttons (Previous, Go to slide 1, Go to slide 2) are excluded
    expect(clickSteps).toHaveLength(2);
    expect(clickSteps[0].description).toContain('Next slide');
    expect(clickSteps[1].description).toContain('Submit');
  });

  it('clicks only first button when no primary labels match', () => {
    const elements = [
      { type: 'button' as const, selector: 'button:nth-of-type(1)', label: 'Previous slide' },
      { type: 'button' as const, selector: 'button:nth-of-type(2)', label: 'Go to slide 1' },
      { type: 'button' as const, selector: 'button:nth-of-type(3)', label: 'Go to slide 2' },
    ];

    const steps = buildSteps(elements, '/');
    const clickSteps = steps.filter((s) => s.action === 'click');

    // No primary labels match, so only the first button is clicked
    expect(clickSteps).toHaveLength(1);
    expect(clickSteps[0].description).toContain('Previous slide');
  });

  it('includes assert only when form is present', () => {
    const withForm = buildSteps(
      [{ type: 'form', selector: 'form' }, { type: 'button', selector: 'button' }],
      '/',
    );
    const withoutForm = buildSteps(
      [{ type: 'button', selector: 'button' }],
      '/',
    );

    expect(withForm.some((s) => s.action === 'assert')).toBe(true);
    expect(withoutForm.some((s) => s.action === 'assert')).toBe(false);
  });

  it('exhaustive mode: clicks buttons and clicks links with go_back', () => {
    const elements = [
      { type: 'button' as const, selector: 'button:nth-of-type(1)', label: 'Previous slide' },
      { type: 'button' as const, selector: 'button:nth-of-type(2)', label: 'Next slide' },
      { type: 'link' as const, selector: 'a[href="/about"]', label: 'About', href: '/about' },
    ];

    const steps = buildSteps(elements, 'http://localhost:3000', 'exhaustive');

    // First step is navigate to base
    expect(steps[0].action).toBe('navigate');
    expect(steps[0].target).toBe('http://localhost:3000');

    // Buttons and links are all clicked
    const clickSteps = steps.filter((s) => s.action === 'click');
    expect(clickSteps).toHaveLength(3);
    expect(clickSteps[0].description).toContain('Previous slide');
    expect(clickSteps[1].description).toContain('Next slide');
    expect(clickSteps[2].description).toContain('About');

    // Links use go_back to return (not navigate)
    const goBackSteps = steps.filter((s) => s.action === 'go_back');
    expect(goBackSteps).toHaveLength(1);

    // Screenshots: 2 after-button + 1 link-destination + 1 final = 4
    const screenshotSteps = steps.filter((s) => s.action === 'screenshot');
    expect(screenshotSteps).toHaveLength(4);

    // Verify step numbers are sequential
    steps.forEach((step, i) => {
      expect(step.stepNumber).toBe(i + 1);
    });
  });

  it('exhaustive mode: clicks links with their selectors', () => {
    const elements = [
      { type: 'link' as const, selector: 'a[href="/about"]', label: 'About', href: '/about' },
      { type: 'link' as const, selector: 'a[href="/contact"]', label: 'Contact', href: '/contact' },
    ];

    const steps = buildSteps(elements, 'http://localhost:8080', 'exhaustive');

    // Links are clicked (not navigated to by URL)
    const clickSteps = steps.filter((s) => s.action === 'click');
    expect(clickSteps).toHaveLength(2);
    expect(clickSteps[0].selector).toBe('a[href="/about"]');
    expect(clickSteps[1].selector).toBe('a[href="/contact"]');

    // Each link has a go_back after it
    const goBackSteps = steps.filter((s) => s.action === 'go_back');
    expect(goBackSteps).toHaveLength(2);
  });

  it('exhaustive mode: each link gets its own go_back', () => {
    const elements = [
      { type: 'button' as const, selector: 'button:nth-of-type(1)', label: 'Btn1' },
      { type: 'button' as const, selector: 'button:nth-of-type(2)', label: 'Btn2' },
      { type: 'link' as const, selector: 'a[href="/page1"]', label: 'Page 1', href: '/page1' },
      { type: 'link' as const, selector: 'a[href="/page2"]', label: 'Page 2', href: '/page2' },
    ];

    const steps = buildSteps(elements, 'http://localhost:3000', 'exhaustive');

    // Each link gets a go_back
    const goBackSteps = steps.filter((s) => s.action === 'go_back');
    expect(goBackSteps).toHaveLength(2);

    // No navigate-back to baseUrl (only initial navigate to base)
    const navToBase = steps.filter(
      (s) => s.action === 'navigate' && s.target === 'http://localhost:3000',
    );
    expect(navToBase).toHaveLength(1); // Only the initial navigate
  });

  it('exhaustive mode: buttons come before links', () => {
    const elements = [
      { type: 'link' as const, selector: 'a[href="/about"]', label: 'About', href: '/about' },
      { type: 'button' as const, selector: 'button', label: 'Submit' },
    ];

    const steps = buildSteps(elements, 'http://localhost:3000', 'exhaustive');

    const clickSteps = steps.filter((s) => s.action === 'click');
    // Button click comes before link click
    const btnClick = clickSteps.find((s) => s.description?.includes('Submit'));
    const linkClick = clickSteps.find((s) => s.description?.includes('About'));
    expect(btnClick).toBeDefined();
    expect(linkClick).toBeDefined();
    expect(btnClick!.stepNumber).toBeLessThan(linkClick!.stepNumber);
  });

  it('exhaustive mode: still fills inputs before clicking', () => {
    const elements = [
      { type: 'input' as const, selector: 'input[name="email"]', name: 'email', inputType: 'email' },
      { type: 'button' as const, selector: 'button', label: 'Submit' },
      { type: 'button' as const, selector: 'button:nth-of-type(2)', label: 'Cancel' },
    ];

    const steps = buildSteps(elements, '/', 'exhaustive');

    expect(steps[0].action).toBe('navigate');
    expect(steps[1].action).toBe('fill');
    expect(steps[1].value).toBe('test@example.com');

    const clickSteps = steps.filter((s) => s.action === 'click');
    expect(clickSteps).toHaveLength(2);
  });

  it('smart mode: clicks up to 3 links after button clicks', () => {
    const elements = [
      { type: 'button' as const, selector: 'button', label: 'Submit' },
      { type: 'link' as const, selector: 'a[href="/about"]', label: 'About Us', href: '/about' },
      { type: 'link' as const, selector: 'a[href="/contact"]', label: 'Contact', href: '/contact' },
      { type: 'link' as const, selector: 'a[href="/pricing"]', label: 'Pricing', href: '/pricing' },
      { type: 'link' as const, selector: 'a[href="/blog"]', label: 'Blog', href: '/blog' },
    ];

    const steps = buildSteps(elements, 'http://localhost:3000', 'smart');

    // Button click + up to 3 link clicks
    const clickSteps = steps.filter((s) => s.action === 'click');
    expect(clickSteps.length).toBeGreaterThanOrEqual(2); // 1 button + at least 1 link
    expect(clickSteps.length).toBeLessThanOrEqual(4); // 1 button + max 3 links

    // Link clicks use go_back to return
    const goBackSteps = steps.filter((s) => s.action === 'go_back');
    expect(goBackSteps.length).toBeGreaterThanOrEqual(1);
    expect(goBackSteps.length).toBeLessThanOrEqual(3);
  });

  it('smart mode: uses go_back after following links', () => {
    const elements = [
      { type: 'link' as const, selector: 'a[href="/about"]', label: 'About', href: '/about' },
    ];

    const steps = buildSteps(elements, 'http://localhost:3000', 'smart');

    // Should use go_back instead of navigate-back to base
    const goBackSteps = steps.filter((s) => s.action === 'go_back');
    expect(goBackSteps.length).toBeGreaterThanOrEqual(1);

    // No navigate-back to baseUrl (only initial navigate)
    const navBackSteps = steps.filter(
      (s) => s.action === 'navigate' && s.description === 'Return to page',
    );
    expect(navBackSteps).toHaveLength(0);
  });

  it('exhaustive mode: excludes links that resolve to baseUrl', () => {
    const elements = [
      { type: 'link' as const, selector: 'a[href="/"]', label: 'Home', href: '/' },
      { type: 'link' as const, selector: 'a[href="/about"]', label: 'About', href: '/about' },
      { type: 'link' as const, selector: 'a.logo', label: 'Logo', href: 'http://localhost:8080/' },
    ];

    const steps = buildSteps(elements, 'http://localhost:8080', 'exhaustive');

    // Only /about should produce a click step for links (not / or the full base URL)
    const linkClicks = steps.filter(
      (s) => s.action === 'click' && s.selector?.includes('about'),
    );
    expect(linkClicks).toHaveLength(1);

    // Same-URL links excluded — no clicks for Home or Logo
    const homeClicks = steps.filter(
      (s) => s.action === 'click' && (s.description?.includes('Home') || s.description?.includes('Logo')),
    );
    expect(homeClicks).toHaveLength(0);
  });

  it('smart mode: excludes links that resolve to baseUrl', () => {
    const elements = [
      { type: 'link' as const, selector: 'a[href="/"]', label: 'Home', href: '/' },
      { type: 'link' as const, selector: 'a[href="/about"]', label: 'About', href: '/about' },
    ];

    const steps = buildSteps(elements, 'http://localhost:3000', 'smart');

    // Only /about should produce a click
    const linkClicks = steps.filter(
      (s) => s.action === 'click' && s.description?.includes('About'),
    );
    expect(linkClicks).toHaveLength(1);

    // Home link excluded
    const homeClicks = steps.filter(
      (s) => s.action === 'click' && s.description?.includes('Home'),
    );
    expect(homeClicks).toHaveLength(0);
  });

  it('exhaustive mode: all same-URL links produces no link clicks', () => {
    const elements = [
      { type: 'link' as const, selector: 'a[href="/"]', label: 'Home', href: '/' },
      { type: 'link' as const, selector: 'a.brand', label: 'Brand', href: 'http://localhost:8080' },
      { type: 'button' as const, selector: 'button', label: 'Click Me' },
    ];

    const steps = buildSteps(elements, 'http://localhost:8080', 'exhaustive');

    // Button should still produce click + screenshot steps
    const clickSteps = steps.filter((s) => s.action === 'click');
    expect(clickSteps).toHaveLength(1);
    expect(clickSteps[0].description).toContain('Click Me');

    // No go_back steps (no links were followed)
    const goBackSteps = steps.filter((s) => s.action === 'go_back');
    expect(goBackSteps).toHaveLength(0);
  });
});

describe('generatePlanFromFile', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'popcorn-gen-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('generates plan with navigate, fill, click steps for a login form', async () => {
    const loginComponent = `
import React from 'react';
export function LoginForm() {
  return (
    <form onSubmit={handleSubmit}>
      <input name="email" type="email" placeholder="Email" />
      <input name="password" type="password" placeholder="Password" />
      <button type="submit">Log In</button>
    </form>
  );
}`;
    const filePath = path.join(tmpDir, 'LoginForm.tsx');
    await fs.writeFile(filePath, loginComponent);

    const plan = await generatePlanFromFile(filePath);
    expect(plan).not.toBeNull();
    expect(plan!.planName).toBe('login-form');
    expect(plan!.tags).toContain('auto-generated');

    const actions = plan!.steps.map((s) => s.action);
    expect(actions).toContain('navigate');
    expect(actions).toContain('fill');
    expect(actions).toContain('click');
  });

  it('generates visual-check plan for a file with no interactive elements', async () => {
    const utilFile = `export const add = (a: number, b: number) => a + b;\nexport const PI = 3.14;\n`;
    const filePath = path.join(tmpDir, 'utils.ts');
    await fs.writeFile(filePath, utilFile);

    const plan = await generatePlanFromFile(filePath);
    expect(plan).not.toBeNull();
    expect(plan!.tags).toContain('visual-check');
    expect(plan!.tags).toContain('auto-generated');
    expect(plan!.steps).toHaveLength(2);
    expect(plan!.steps[0].action).toBe('wait');
    expect(plan!.steps[1].action).toBe('screenshot');
  });

  it('generates visual-check plan for a display-only component', async () => {
    const displayComponent = `
import React from 'react';
export function ProductCard({ title, price }) {
  return (
    <div className="card">
      <h2>{title}</h2>
      <p className="price">{price}</p>
    </div>
  );
}`;
    const filePath = path.join(tmpDir, 'ProductCard.tsx');
    await fs.writeFile(filePath, displayComponent);

    const plan = await generatePlanFromFile(filePath);
    expect(plan).not.toBeNull();
    expect(plan!.planName).toBe('product-card');
    expect(plan!.description).toBe('Visual check for ProductCard');
    expect(plan!.tags).toContain('visual-check');
    expect(plan!.steps).toHaveLength(2);
    expect(plan!.steps[0].action).toBe('wait');
    expect(plan!.steps[1].action).toBe('screenshot');
  });

  it('uses email placeholder for email inputs', async () => {
    const src = '<form><input name="email" type="email" /><button type="submit">Go</button></form>';
    const filePath = path.join(tmpDir, 'Form.tsx');
    await fs.writeFile(filePath, src);

    const plan = await generatePlanFromFile(filePath);
    const fillStep = plan!.steps.find((s) => s.action === 'fill');
    expect(fillStep!.value).toBe('test@example.com');
  });

  it('plan name is kebab-cased from filename', async () => {
    const src = '<form><input name="x" /><button>Go</button></form>';
    const filePath = path.join(tmpDir, 'MyContactForm.tsx');
    await fs.writeFile(filePath, src);

    const plan = await generatePlanFromFile(filePath);
    expect(plan!.planName).toBe('my-contact-form');
  });

  it('uses custom baseUrl when provided', async () => {
    const src = '<form><input name="x" /><button>Go</button></form>';
    const filePath = path.join(tmpDir, 'Form.tsx');
    await fs.writeFile(filePath, src);

    const plan = await generatePlanFromFile(filePath, { baseUrl: '/settings' });
    expect(plan!.steps[0].target).toBe('/settings');
  });

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

    // The click step should target the second item (index 1, nth-child(2))
    const clickStep = plan!.steps.find((s) => s.action === 'click');
    expect(clickStep!.selector).toContain('2');
  });
});

describe('savePlan', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'popcorn-save-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('writes valid JSON to the test-plans directory', async () => {
    const plan = {
      planName: 'test-plan',
      description: 'Test',
      baseUrl: '/',
      steps: [{ stepNumber: 1, action: 'navigate' as const, description: 'Go', target: '/' }],
    };

    const savedPath = await savePlan(plan, path.join(tmpDir, 'test-plans'));

    expect(savedPath).toContain('test-plan.json');
    const raw = await fs.readFile(savedPath, 'utf-8');
    const loaded = JSON.parse(raw);
    expect(loaded.planName).toBe('test-plan');
  });

  it('creates directory if it does not exist', async () => {
    const plan = {
      planName: 'new',
      description: 'Test',
      baseUrl: '/',
      steps: [{ stepNumber: 1, action: 'navigate' as const, description: 'Go', target: '/' }],
    };

    const plansDir = path.join(tmpDir, 'nonexistent', 'dir');
    await savePlan(plan, plansDir);

    const files = await fs.readdir(plansDir);
    expect(files).toContain('new.json');
  });
});
