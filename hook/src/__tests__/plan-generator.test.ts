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
    expect(steps[5].action).toBe('assert');

    // Verify step numbers are sequential
    steps.forEach((step, i) => {
      expect(step.stepNumber).toBe(i + 1);
    });
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

  it('returns null for a utility file with no UI elements', async () => {
    const utilFile = `export const add = (a: number, b: number) => a + b;\nexport const PI = 3.14;\n`;
    const filePath = path.join(tmpDir, 'utils.ts');
    await fs.writeFile(filePath, utilFile);

    const plan = await generatePlanFromFile(filePath);
    expect(plan).toBeNull();
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
