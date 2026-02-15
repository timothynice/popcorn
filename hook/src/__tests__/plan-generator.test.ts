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
  extractTextContent,
  detectComponentLibraryElements,
  disambiguateSelectors,
  inferRouteFromFilePath,
  sniffProjectDeps,
  clearProjectContextCache,
} from '../plan-generator.js';
import type { DetectedElement } from '@popcorn/shared';

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

// ====================================================================
// New tests: text content extraction, component libraries, disambiguation,
// route inference, project context sniffing
// ====================================================================

describe('extractTextContent', () => {
  it('extracts text content from button elements', () => {
    const src = '<button type="submit">Submit Order</button>';
    expect(extractTextContent(src, 0, 'button')).toBe('Submit Order');
  });

  it('extracts text content from link elements', () => {
    const src = '<a href="/about">About Us</a>';
    expect(extractTextContent(src, 0, 'a')).toBe('About Us');
  });

  it('strips nested JSX tags from text', () => {
    const src = '<button><Icon /> Submit</button>';
    expect(extractTextContent(src, 0, 'button')).toBe('Submit');
  });

  it('returns null for dynamic-only content', () => {
    const src = '<button>{buttonText}</button>';
    expect(extractTextContent(src, 0, 'button')).toBeNull();
  });

  it('returns null for self-closing tags', () => {
    const src = '<input name="x" />';
    expect(extractTextContent(src, 0, 'input')).toBeNull();
  });

  it('returns null when no closing tag found', () => {
    const src = '<button>Text without closing';
    expect(extractTextContent(src, 0, 'button')).toBeNull();
  });

  it('handles mixed static text and expressions', () => {
    const src = '<button>Save {count} Items</button>';
    expect(extractTextContent(src, 0, 'button')).toBe('Save Items');
  });

  it('handles multiline text content', () => {
    const src = '<button>\n  Submit\n  Order\n</button>';
    expect(extractTextContent(src, 0, 'button')).toBe('Submit Order');
  });
});

describe('detectElements — text content extraction', () => {
  it('populates label on button elements', () => {
    const elements = detectElements('<button type="submit">Submit Order</button>');
    const btn = elements.find((e) => e.type === 'button');
    expect(btn?.label).toBe('Submit Order');
  });

  it('populates label on link elements', () => {
    const elements = detectElements('<a href="/about">About Us</a>');
    const link = elements.find((e) => e.type === 'link');
    expect(link?.label).toBe('About Us');
  });

  it('uses aria-label as fallback for buttons', () => {
    const elements = detectElements('<button aria-label="Close dialog">{icon}</button>');
    const btn = elements.find((e) => e.type === 'button');
    expect(btn?.label).toBe('Close dialog');
  });

  it('uses aria-label as fallback for links', () => {
    const elements = detectElements('<a href="/home" aria-label="Go home">{icon}</a>');
    const link = elements.find((e) => e.type === 'link');
    expect(link?.label).toBe('Go home');
  });
});

describe('detectElements — component library detection', () => {
  it('detects MUI TextField as input', () => {
    const src = `import { TextField } from '@mui/material';\n<TextField name="email" label="Email" />`;
    const elements = detectElements(src);
    expect(elements.some((e) => e.type === 'input' && e.name === 'email')).toBe(true);
  });

  it('detects MUI Button as button with label', () => {
    const src = `import { Button } from '@mui/material';\n<Button variant="contained">Save Changes</Button>`;
    const elements = detectElements(src);
    const btn = elements.find((e) => e.type === 'button');
    expect(btn).toBeDefined();
    expect(btn?.label).toBe('Save Changes');
  });

  it('detects Chakra UI components', () => {
    const src = `import { Input, Button } from '@chakra-ui/react';\n<Input name="search" />\n<Button>Search</Button>`;
    const elements = detectElements(src);
    expect(elements.some((e) => e.type === 'input' && e.name === 'search')).toBe(true);
    expect(elements.some((e) => e.type === 'button' && e.label === 'Search')).toBe(true);
  });

  it('detects Ant Design components', () => {
    const src = `import { Form, Input, Button } from 'antd';\n<Form>\n<Input name="user" />\n<Button>Save</Button>\n</Form>`;
    const elements = detectElements(src);
    expect(elements.some((e) => e.type === 'form')).toBe(true);
    expect(elements.some((e) => e.type === 'input')).toBe(true);
    expect(elements.some((e) => e.type === 'button')).toBe(true);
  });

  it('detects Radix namespace imports (Dialog.Trigger)', () => {
    const src = `import * as Dialog from '@radix-ui/react-dialog';\n<Dialog.Trigger>Open</Dialog.Trigger>`;
    const elements = detectElements(src);
    expect(elements.some((e) => e.type === 'button' && e.label === 'Open')).toBe(true);
  });

  it('detects Headless UI components', () => {
    const src = `import { Listbox, Button } from '@headlessui/react';\n<Listbox name="options" />\n<Button>Apply</Button>`;
    const elements = detectElements(src);
    expect(elements.some((e) => e.type === 'select')).toBe(true);
    expect(elements.some((e) => e.type === 'button')).toBe(true);
  });

  it('does not detect components from unknown libraries', () => {
    const src = `import { CustomInput } from 'my-lib';\n<CustomInput name="x" />`;
    const elements = detectElements(src);
    expect(elements).toHaveLength(0);
  });

  it('does not detect imported but unused components', () => {
    const src = `import { Button, TextField } from '@mui/material';\nconst x = 42;`;
    const elements = detectElements(src);
    expect(elements).toHaveLength(0);
  });

  it('handles aliased imports', () => {
    const src = `import { Button as Btn } from '@mui/material';\n<Btn>Click Me</Btn>`;
    const elements = detectElements(src);
    expect(elements.some((e) => e.type === 'button' && e.label === 'Click Me')).toBe(true);
  });

  it('uses data-testid from component library elements', () => {
    const src = `import { Button } from '@mui/material';\n<Button data-testid="submit-btn">Submit</Button>`;
    const elements = detectElements(src);
    const btn = elements.find((e) => e.type === 'button');
    expect(btn?.selector).toBe('[data-testid="submit-btn"]');
  });

  it('does not duplicate elements detected by both HTML and library detection', () => {
    // MUI Button renders as <button> but we import Button — should not get two entries
    const src = `import { Button } from '@mui/material';\n<Button>Save</Button>`;
    const elements = detectElements(src);
    const buttons = elements.filter((e) => e.type === 'button');
    expect(buttons).toHaveLength(1);
  });
});

describe('detectElements — data-testid and aria-label', () => {
  it('uses data-testid for button selector', () => {
    const elements = detectElements('<button data-testid="save-btn">Save</button>');
    expect(elements[0].selector).toBe('[data-testid="save-btn"]');
  });

  it('uses data-testid for input selector', () => {
    const elements = detectElements('<input data-testid="email-input" name="email" type="email" />');
    expect(elements[0].selector).toBe('[data-testid="email-input"]');
  });

  it('prefers data-testid over id', () => {
    const elements = detectElements('<button id="btn" data-testid="test-btn">Go</button>');
    expect(elements[0].selector).toBe('[data-testid="test-btn"]');
  });
});

describe('disambiguateSelectors', () => {
  it('disambiguates two buttons without IDs using nth-of-type', () => {
    const elements: DetectedElement[] = [
      { type: 'button', selector: 'button', label: 'Save' },
      { type: 'button', selector: 'button', label: 'Cancel' },
    ];
    const result = disambiguateSelectors(elements, '');
    expect(result[0].selector).toBe('button:nth-of-type(1)');
    expect(result[1].selector).toBe('button:nth-of-type(2)');
  });

  it('does not disambiguate elements with unique selectors', () => {
    const elements: DetectedElement[] = [
      { type: 'button', selector: '#save', label: 'Save' },
      { type: 'button', selector: '#cancel', label: 'Cancel' },
    ];
    const result = disambiguateSelectors(elements, '');
    expect(result[0].selector).toBe('#save');
    expect(result[1].selector).toBe('#cancel');
  });

  it('does not disambiguate data-testid selectors', () => {
    const elements: DetectedElement[] = [
      { type: 'button', selector: '[data-testid="a"]' },
      { type: 'button', selector: '[data-testid="b"]' },
    ];
    const result = disambiguateSelectors(elements, '');
    expect(result[0].selector).toBe('[data-testid="a"]');
    expect(result[1].selector).toBe('[data-testid="b"]');
  });

  it('only disambiguates duplicate selectors, leaves unique ones alone', () => {
    const elements: DetectedElement[] = [
      { type: 'button', selector: 'button', label: 'A' },
      { type: 'button', selector: 'button', label: 'B' },
      { type: 'button', selector: '#unique', label: 'C' },
    ];
    const result = disambiguateSelectors(elements, '');
    expect(result[0].selector).toBe('button:nth-of-type(1)');
    expect(result[1].selector).toBe('button:nth-of-type(2)');
    expect(result[2].selector).toBe('#unique');
  });
});

describe('inferRouteFromFilePath', () => {
  it('infers /login for pages/login.tsx (Next.js Pages)', () => {
    expect(inferRouteFromFilePath('/project/pages/login.tsx', '/project', 'nextjs')).toBe('/login');
  });

  it('infers / for pages/index.tsx', () => {
    expect(inferRouteFromFilePath('/project/pages/index.tsx', '/project', 'nextjs')).toBe('/');
  });

  it('infers /auth/signup for nested pages', () => {
    expect(inferRouteFromFilePath('/project/pages/auth/signup.tsx', '/project', 'nextjs')).toBe('/auth/signup');
  });

  it('infers /dashboard for app/dashboard/page.tsx (Next.js App Router)', () => {
    expect(inferRouteFromFilePath('/project/app/dashboard/page.tsx', '/project', 'nextjs')).toBe('/dashboard');
  });

  it('strips route groups from App Router paths', () => {
    expect(inferRouteFromFilePath('/project/app/(auth)/login/page.tsx', '/project', 'nextjs')).toBe('/login');
  });

  it('handles src/pages and src/app prefixes', () => {
    expect(inferRouteFromFilePath('/project/src/pages/about.tsx', '/project', 'nextjs')).toBe('/about');
    expect(inferRouteFromFilePath('/project/src/app/settings/page.tsx', '/project', 'nextjs')).toBe('/settings');
  });

  it('skips _app and _document files', () => {
    expect(inferRouteFromFilePath('/project/pages/_app.tsx', '/project', 'nextjs')).toBeNull();
    expect(inferRouteFromFilePath('/project/pages/_document.tsx', '/project', 'nextjs')).toBeNull();
  });

  it('skips API routes', () => {
    expect(inferRouteFromFilePath('/project/pages/api/users.ts', '/project', 'nextjs')).toBeNull();
  });

  it('infers Remix routes with dot notation', () => {
    expect(inferRouteFromFilePath('/project/app/routes/auth.signup.tsx', '/project', 'remix')).toBe('/auth/signup');
  });

  it('infers Remix _index route', () => {
    expect(inferRouteFromFilePath('/project/app/routes/_index.tsx', '/project', 'remix')).toBe('/');
  });

  it('infers Astro page routes', () => {
    expect(inferRouteFromFilePath('/project/src/pages/about.astro', '/project', 'astro')).toBe('/about');
  });

  it('returns null for non-routing files', () => {
    expect(inferRouteFromFilePath('/project/src/components/Button.tsx', '/project', 'nextjs')).toBeNull();
    expect(inferRouteFromFilePath('/project/src/utils/helpers.ts', '/project', null)).toBeNull();
  });

  it('works with null framework (tries all conventions)', () => {
    expect(inferRouteFromFilePath('/project/pages/login.tsx', '/project', null)).toBe('/login');
    expect(inferRouteFromFilePath('/project/app/routes/login.tsx', '/project', null)).toBe('/login');
  });
});

describe('sniffProjectDeps', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'popcorn-sniff-'));
    clearProjectContextCache();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    clearProjectContextCache();
  });

  it('detects Next.js framework', async () => {
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { next: '14.0.0', react: '18.0.0' },
    }));
    const ctx = await sniffProjectDeps(tmpDir);
    expect(ctx.framework).toBe('nextjs');
  });

  it('detects Remix framework', async () => {
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { '@remix-run/react': '2.0.0' },
    }));
    const ctx = await sniffProjectDeps(tmpDir);
    expect(ctx.framework).toBe('remix');
  });

  it('detects Astro framework', async () => {
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { astro: '4.0.0' },
    }));
    const ctx = await sniffProjectDeps(tmpDir);
    expect(ctx.framework).toBe('astro');
  });

  it('detects MUI library', async () => {
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { '@mui/material': '5.0.0', react: '18.0.0' },
    }));
    const ctx = await sniffProjectDeps(tmpDir);
    expect(ctx.uiLibraries).toContain('@mui/material');
  });

  it('detects Chakra UI library', async () => {
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { '@chakra-ui/react': '2.0.0' },
    }));
    const ctx = await sniffProjectDeps(tmpDir);
    expect(ctx.uiLibraries).toContain('@chakra-ui/react');
  });

  it('detects TypeScript', async () => {
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({
      devDependencies: { typescript: '5.0.0' },
    }));
    const ctx = await sniffProjectDeps(tmpDir);
    expect(ctx.typescript).toBe(true);
  });

  it('returns null framework when none detected', async () => {
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { react: '18.0.0' },
    }));
    const ctx = await sniffProjectDeps(tmpDir);
    expect(ctx.framework).toBeNull();
  });

  it('returns defaults when no package.json', async () => {
    const ctx = await sniffProjectDeps(tmpDir);
    expect(ctx.framework).toBeNull();
    expect(ctx.uiLibraries).toHaveLength(0);
    expect(ctx.typescript).toBe(false);
  });

  it('caches results per project root', async () => {
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { next: '14.0.0' },
    }));
    const ctx1 = await sniffProjectDeps(tmpDir);
    const ctx2 = await sniffProjectDeps(tmpDir);
    expect(ctx1).toBe(ctx2); // same reference — cached
  });
});

describe('generatePlanFromFile — route inference', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'popcorn-route-'));
    clearProjectContextCache();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    clearProjectContextCache();
  });

  it('infers route for Next.js Pages Router file', async () => {
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { next: '14.0.0', react: '18.0.0' },
    }));
    await fs.mkdir(path.join(tmpDir, 'pages'), { recursive: true });
    const src = '<form><input name="email" type="email" /><button type="submit">Login</button></form>';
    const filePath = path.join(tmpDir, 'pages', 'login.tsx');
    await fs.writeFile(filePath, src);

    const plan = await generatePlanFromFile(filePath, {
      baseUrl: 'http://localhost:3000',
      projectRoot: tmpDir,
    });
    expect(plan).not.toBeNull();
    expect(plan!.steps[0].target).toBe('http://localhost:3000/login');
  });

  it('infers route for Next.js App Router file', async () => {
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { next: '14.0.0', react: '18.0.0' },
    }));
    await fs.mkdir(path.join(tmpDir, 'app', 'dashboard'), { recursive: true });
    const src = '<form><input name="search" /><button>Search</button></form>';
    const filePath = path.join(tmpDir, 'app', 'dashboard', 'page.tsx');
    await fs.writeFile(filePath, src);

    const plan = await generatePlanFromFile(filePath, {
      baseUrl: 'http://localhost:3000',
      projectRoot: tmpDir,
    });
    expect(plan).not.toBeNull();
    expect(plan!.steps[0].target).toBe('http://localhost:3000/dashboard');
  });

  it('uses default baseUrl when no route is inferred', async () => {
    const src = '<form><input name="x" /><button>Go</button></form>';
    const filePath = path.join(tmpDir, 'Form.tsx');
    await fs.writeFile(filePath, src);

    const plan = await generatePlanFromFile(filePath, {
      baseUrl: 'http://localhost:3000',
      projectRoot: tmpDir,
    });
    expect(plan!.steps[0].target).toBe('http://localhost:3000');
  });
});

describe('generatePlanFromFile — component library integration', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'popcorn-lib-'));
    clearProjectContextCache();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    clearProjectContextCache();
  });

  it('generates plan for MUI form component', async () => {
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { '@mui/material': '5.0.0', react: '18.0.0' },
    }));
    const src = `
import { TextField, Button } from '@mui/material';
export function LoginForm() {
  return (
    <form>
      <TextField name="email" label="Email" />
      <TextField name="password" label="Password" type="password" />
      <Button type="submit">Sign In</Button>
    </form>
  );
}`;
    const filePath = path.join(tmpDir, 'LoginForm.tsx');
    await fs.writeFile(filePath, src);

    const plan = await generatePlanFromFile(filePath, { projectRoot: tmpDir });
    expect(plan).not.toBeNull();
    expect(plan!.tags).toContain('auto-generated');

    const actions = plan!.steps.map((s) => s.action);
    expect(actions).toContain('fill');
    expect(actions).toContain('click');

    // Should have fill steps for both fields
    const fillSteps = plan!.steps.filter((s) => s.action === 'fill');
    expect(fillSteps.length).toBeGreaterThanOrEqual(2);
  });
});
