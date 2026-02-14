import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import type { TestStep } from '@popcorn/shared';
import { executeTestPlan } from '../content/test-harness.js';

// Setup jsdom environment
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'https://example.com',
});

vi.stubGlobal('window', dom.window);
vi.stubGlobal('document', dom.window.document);
vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
vi.stubGlobal('HTMLInputElement', dom.window.HTMLInputElement);
vi.stubGlobal('HTMLTextAreaElement', dom.window.HTMLTextAreaElement);
vi.stubGlobal('HTMLSelectElement', dom.window.HTMLSelectElement);
vi.stubGlobal('Element', dom.window.Element);
vi.stubGlobal('Event', dom.window.Event);
vi.stubGlobal('MouseEvent', dom.window.MouseEvent);
vi.stubGlobal('KeyboardEvent', dom.window.KeyboardEvent);

describe('test-harness', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('executes all steps in sequence', async () => {
    document.body.innerHTML = `
      <button id="btn1">Button 1</button>
      <button id="btn2">Button 2</button>
      <button id="btn3">Button 3</button>
    `;

    const steps: TestStep[] = [
      {
        stepNumber: 1,
        action: 'click',
        description: 'Click button 1',
        selector: '#btn1',
      },
      {
        stepNumber: 2,
        action: 'click',
        description: 'Click button 2',
        selector: '#btn2',
      },
      {
        stepNumber: 3,
        action: 'click',
        description: 'Click button 3',
        selector: '#btn3',
      },
    ];

    const results = await executeTestPlan(steps);

    expect(results).toHaveLength(3);
    expect(results[0].stepNumber).toBe(1);
    expect(results[1].stepNumber).toBe(2);
    expect(results[2].stepNumber).toBe(3);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it('returns results for each step', async () => {
    document.body.innerHTML = `
      <input id="input1" type="text" />
      <input id="input2" type="text" />
    `;

    const steps: TestStep[] = [
      {
        stepNumber: 1,
        action: 'fill',
        description: 'Fill input 1',
        selector: '#input1',
        value: 'value1',
      },
      {
        stepNumber: 2,
        action: 'fill',
        description: 'Fill input 2',
        selector: '#input2',
        value: 'value2',
      },
    ];

    const results = await executeTestPlan(steps);

    expect(results).toHaveLength(2);

    expect(results[0].stepNumber).toBe(1);
    expect(results[0].action).toBe('fill');
    expect(results[0].description).toBe('Fill input 1');
    expect(results[0].passed).toBe(true);
    expect(results[0].duration).toBeGreaterThanOrEqual(0);
    expect(results[0].timestamp).toBeGreaterThan(0);

    expect(results[1].stepNumber).toBe(2);
    expect(results[1].action).toBe('fill');
    expect(results[1].description).toBe('Fill input 2');
    expect(results[1].passed).toBe(true);
  });

  it('continues on non-navigate failures (click errors are non-fatal)', async () => {
    const steps: TestStep[] = [
      {
        stepNumber: 1,
        action: 'click',
        description: 'Click existing button',
        selector: '#btn1',
      },
      {
        stepNumber: 2,
        action: 'click',
        description: 'Click missing button',
        selector: '#missing',
        timeout: 100,
      },
      {
        stepNumber: 3,
        action: 'click',
        description: 'This should still run',
        selector: '#btn3',
      },
    ];

    document.body.innerHTML = `
      <button id="btn1">Button 1</button>
      <button id="btn3">Button 3</button>
    `;

    const results = await executeTestPlan(steps);

    // All 3 steps should execute — only navigate failures break the loop
    expect(results).toHaveLength(3);
    expect(results[0].passed).toBe(true);
    expect(results[1].passed).toBe(false);
    expect(results[1].error).toContain('Element not found');
    expect(results[2].passed).toBe(true); // continues after failure
  });

  it('continues after assertion failures', async () => {
    document.body.innerHTML = '<div id="content">Wrong text</div>';

    const steps: TestStep[] = [
      {
        stepNumber: 1,
        action: 'assert',
        description: 'Check wrong text',
        selector: '#content',
        assertionType: 'text',
        expected: 'Correct text',
      },
      {
        stepNumber: 2,
        action: 'assert',
        description: 'Check actual text',
        selector: '#content',
        assertionType: 'text',
        expected: 'Wrong text',
      },
    ];

    const results = await executeTestPlan(steps);

    // Should execute both steps even though first fails
    expect(results).toHaveLength(2);
    expect(results[0].passed).toBe(false);
    expect(results[1].passed).toBe(true);
  });

  it('collects timing info', async () => {
    document.body.innerHTML = '<button id="btn">Click</button>';

    const steps: TestStep[] = [
      {
        stepNumber: 1,
        action: 'click',
        description: 'Click button',
        selector: '#btn',
      },
      {
        stepNumber: 2,
        action: 'wait',
        description: 'Wait 50ms',
        condition: 'timeout',
        timeout: 50,
      },
    ];

    const results = await executeTestPlan(steps);

    expect(results).toHaveLength(2);
    expect(results[0].duration).toBeGreaterThanOrEqual(0);
    expect(results[0].duration).toBeLessThan(1000);
    expect(results[1].duration).toBeGreaterThanOrEqual(40); // Allow some slack
  });

  it('executes empty plan', async () => {
    const steps: TestStep[] = [];

    const results = await executeTestPlan(steps);

    expect(results).toHaveLength(0);
  });

  it('handles mixed success and failure', async () => {
    document.body.innerHTML = `
      <button id="btn1">Button 1</button>
      <div id="content">Test</div>
    `;

    const steps: TestStep[] = [
      {
        stepNumber: 1,
        action: 'click',
        description: 'Click button',
        selector: '#btn1',
      },
      {
        stepNumber: 2,
        action: 'assert',
        description: 'Assert wrong text',
        selector: '#content',
        assertionType: 'text',
        expected: 'Wrong',
      },
      {
        stepNumber: 3,
        action: 'assert',
        description: 'Assert correct text',
        selector: '#content',
        assertionType: 'text',
        expected: 'Test',
      },
    ];

    const results = await executeTestPlan(steps);

    expect(results).toHaveLength(3);
    expect(results[0].passed).toBe(true);
    expect(results[1].passed).toBe(false);
    expect(results[2].passed).toBe(true);
  });

  it('includes timestamps for each step', async () => {
    document.body.innerHTML = '<button id="btn">Click</button>';

    const steps: TestStep[] = [
      {
        stepNumber: 1,
        action: 'click',
        description: 'Click button',
        selector: '#btn',
      },
    ];

    const beforeTime = Date.now();
    const results = await executeTestPlan(steps);
    const afterTime = Date.now();

    expect(results).toHaveLength(1);
    expect(results[0].timestamp).toBeGreaterThanOrEqual(beforeTime);
    expect(results[0].timestamp).toBeLessThanOrEqual(afterTime);
  });
});
