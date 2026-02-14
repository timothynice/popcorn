/**
 * Tests for buildExplorationPlan — the new exploration plan builder.
 */

import { describe, it, expect } from 'vitest';
import type { DetectedElement } from '../plan-builder.js';
import { buildExplorationPlan } from '../plan-builder.js';

const BASE_URL = 'http://localhost:3000';

function makeElements(overrides: Partial<DetectedElement>[] = []): DetectedElement[] {
  return overrides.map((o) => ({
    type: 'button' as const,
    selector: 'button',
    ...o,
  }));
}

describe('buildExplorationPlan', () => {
  it('returns empty targets and formFillSteps for no elements', () => {
    const plan = buildExplorationPlan([], BASE_URL, 'smart');
    expect(plan.targets).toHaveLength(0);
    expect(plan.formFillSteps).toHaveLength(0);
    expect(plan.baseUrl).toBe(BASE_URL);
    expect(plan.mode).toBe('smart');
  });

  it('generates formFillSteps for inputs', () => {
    const elements = makeElements([
      { type: 'input', selector: 'input[name="email"]', name: 'email', inputType: 'email' },
      { type: 'input', selector: 'input[name="password"]', name: 'password', inputType: 'password' },
    ]);
    const plan = buildExplorationPlan(elements, BASE_URL, 'smart');
    expect(plan.formFillSteps).toHaveLength(2);
    expect(plan.formFillSteps[0].action).toBe('fill');
    expect(plan.formFillSteps[0].value).toBe('test@example.com');
    expect(plan.formFillSteps[1].value).toBe('Test1234!');
    expect(plan.targets).toHaveLength(0); // inputs are not exploration targets
  });

  it('generates formFillSteps for selects and checkboxes', () => {
    const elements = makeElements([
      { type: 'select', selector: '#role', name: 'role', label: 'Role' },
      { type: 'checkbox', selector: '#terms', name: 'terms', label: 'Accept terms' },
    ]);
    const plan = buildExplorationPlan(elements, BASE_URL, 'smart');
    expect(plan.formFillSteps).toHaveLength(2);
    expect(plan.formFillSteps[0].action).toBe('select');
    expect(plan.formFillSteps[1].action).toBe('check');
  });

  describe('smart mode', () => {
    it('caps buttons at 3 primary-intent buttons', () => {
      const elements = makeElements([
        { type: 'button', selector: '#submit', label: 'Submit' },
        { type: 'button', selector: '#save', label: 'Save' },
        { type: 'button', selector: '#login', label: 'Login' },
        { type: 'button', selector: '#register', label: 'Register' },
        { type: 'button', selector: '#delete', label: 'Delete' },
      ]);
      const plan = buildExplorationPlan(elements, BASE_URL, 'smart');
      expect(plan.targets.filter((t) => t.type === 'button')).toHaveLength(3);
    });

    it('falls back to first button if no primary labels match', () => {
      const elements = makeElements([
        { type: 'button', selector: '#fancy', label: 'Fancy Widget' },
        { type: 'button', selector: '#other', label: 'Other Thing' },
      ]);
      const plan = buildExplorationPlan(elements, BASE_URL, 'smart');
      expect(plan.targets.filter((t) => t.type === 'button')).toHaveLength(1);
      expect(plan.targets[0].label).toBe('Fancy Widget');
    });

    it('caps links at 3 primary-intent links', () => {
      const elements = makeElements([
        { type: 'link', selector: 'a.about', label: 'About', href: '/about' },
        { type: 'link', selector: 'a.dashboard', label: 'Dashboard', href: '/dashboard' },
        { type: 'link', selector: 'a.settings', label: 'Settings', href: '/settings' },
        { type: 'link', selector: 'a.profile', label: 'Profile', href: '/profile' },
      ]);
      const plan = buildExplorationPlan(elements, BASE_URL, 'smart');
      expect(plan.targets.filter((t) => t.type === 'link')).toHaveLength(3);
    });

    it('falls back to first 3 links if no primary labels match', () => {
      const elements = makeElements([
        { type: 'link', selector: 'a.x', label: 'X Page', href: '/x' },
        { type: 'link', selector: 'a.y', label: 'Y Page', href: '/y' },
        { type: 'link', selector: 'a.z', label: 'Z Page', href: '/z' },
        { type: 'link', selector: 'a.w', label: 'W Page', href: '/w' },
      ]);
      const plan = buildExplorationPlan(elements, BASE_URL, 'smart');
      expect(plan.targets.filter((t) => t.type === 'link')).toHaveLength(3);
    });
  });

  describe('exhaustive mode', () => {
    it('includes all buttons', () => {
      const elements = makeElements([
        { type: 'button', selector: '#btn1', label: 'Button 1' },
        { type: 'button', selector: '#btn2', label: 'Button 2' },
        { type: 'button', selector: '#btn3', label: 'Button 3' },
        { type: 'button', selector: '#btn4', label: 'Button 4' },
        { type: 'button', selector: '#btn5', label: 'Button 5' },
      ]);
      const plan = buildExplorationPlan(elements, BASE_URL, 'exhaustive');
      expect(plan.targets.filter((t) => t.type === 'button')).toHaveLength(5);
    });

    it('includes all internal links', () => {
      const elements = makeElements([
        { type: 'link', selector: 'a.1', label: 'Page 1', href: '/page1' },
        { type: 'link', selector: 'a.2', label: 'Page 2', href: '/page2' },
        { type: 'link', selector: 'a.3', label: 'Page 3', href: '/page3' },
        { type: 'link', selector: 'a.4', label: 'Page 4', href: '/page4' },
        { type: 'link', selector: 'a.5', label: 'Page 5', href: '/page5' },
      ]);
      const plan = buildExplorationPlan(elements, BASE_URL, 'exhaustive');
      expect(plan.targets.filter((t) => t.type === 'link')).toHaveLength(5);
    });
  });

  it('excludes self-referential links', () => {
    const elements = makeElements([
      { type: 'link', selector: 'a.self', label: 'Self', href: 'http://localhost:3000/' },
      { type: 'link', selector: 'a.about', label: 'About', href: '/about' },
    ]);
    const plan = buildExplorationPlan(elements, BASE_URL, 'exhaustive');
    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0].label).toBe('About');
  });

  it('sets mayNavigate true for links', () => {
    const elements = makeElements([
      { type: 'link', selector: 'a.about', label: 'About', href: '/about' },
    ]);
    const plan = buildExplorationPlan(elements, BASE_URL, 'smart');
    expect(plan.targets[0].mayNavigate).toBe(true);
  });

  it('preserves mayNavigate flag from buttons', () => {
    const elements = makeElements([
      { type: 'button', selector: '#nav-btn', label: 'Submit', mayNavigate: true },
    ]);
    const plan = buildExplorationPlan(elements, BASE_URL, 'smart');
    expect(plan.targets[0].mayNavigate).toBe(true);
  });

  it('sets mayNavigate false for buttons without navigation hints', () => {
    const elements = makeElements([
      { type: 'button', selector: '#btn', label: 'Submit' },
    ]);
    const plan = buildExplorationPlan(elements, BASE_URL, 'smart');
    expect(plan.targets[0].mayNavigate).toBe(false);
  });

  it('combines formFillSteps and targets correctly', () => {
    const elements = makeElements([
      { type: 'input', selector: '#email', name: 'email', inputType: 'email' },
      { type: 'button', selector: '#submit', label: 'Submit' },
      { type: 'link', selector: 'a.about', label: 'About', href: '/about' },
    ]);
    const plan = buildExplorationPlan(elements, BASE_URL, 'smart');
    expect(plan.formFillSteps).toHaveLength(1);
    expect(plan.formFillSteps[0].action).toBe('fill');
    expect(plan.targets).toHaveLength(2); // 1 button + 1 link
  });
});
