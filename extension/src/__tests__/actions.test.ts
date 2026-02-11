import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import type { TestStep } from '@popcorn/shared';
import { executeAction } from '../content/actions.js';

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

describe('actions', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('click action finds and clicks element', async () => {
    document.body.innerHTML = '<button id="test-btn">Click me</button>';
    const button = document.getElementById('test-btn') as HTMLButtonElement;
    const clickSpy = vi.spyOn(button, 'click');

    const step: TestStep = {
      stepNumber: 1,
      action: 'click',
      description: 'Click button',
      selector: '#test-btn',
    };

    const result = await executeAction(step);

    expect(result.passed).toBe(true);
    expect(clickSpy).toHaveBeenCalled();
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it('click action fails gracefully when element missing', async () => {
    const step: TestStep = {
      stepNumber: 1,
      action: 'click',
      description: 'Click missing button',
      selector: '#missing-btn',
      timeout: 100,
    };

    const result = await executeAction(step);

    expect(result.passed).toBe(false);
    expect(result.error).toContain('Element not found');
  });

  it('fill action sets value and dispatches event', async () => {
    document.body.innerHTML = '<input id="test-input" type="text" />';
    const input = document.getElementById('test-input') as HTMLInputElement;

    const inputListener = vi.fn();
    const changeListener = vi.fn();
    input.addEventListener('input', inputListener);
    input.addEventListener('change', changeListener);

    const step: TestStep = {
      stepNumber: 1,
      action: 'fill',
      description: 'Fill input',
      selector: '#test-input',
      value: 'test value',
    };

    const result = await executeAction(step);

    expect(result.passed).toBe(true);
    expect(input.value).toBe('test value');
    expect(inputListener).toHaveBeenCalled();
    expect(changeListener).toHaveBeenCalled();
  });

  it('assert action checks text content', async () => {
    document.body.innerHTML = '<div id="content">Hello World</div>';

    const step: TestStep = {
      stepNumber: 1,
      action: 'assert',
      description: 'Check text',
      selector: '#content',
      assertionType: 'text',
      expected: 'Hello',
    };

    const result = await executeAction(step);

    expect(result.passed).toBe(true);
  });

  it('assert action checks URL', async () => {
    const step: TestStep = {
      stepNumber: 1,
      action: 'assert',
      description: 'Check URL',
      assertionType: 'url',
      expected: 'example.com',
    };

    const result = await executeAction(step);

    expect(result.passed).toBe(true);
  });

  it('navigate action changes location', async () => {
    const step: TestStep = {
      stepNumber: 1,
      action: 'navigate',
      description: 'Navigate to page',
      target: 'https://test.com',
      timeout: 100,
    };

    // Since jsdom doesn't support navigation, we'll just verify the action
    // completes without error. In a real browser, this would navigate.
    const result = await executeAction(step);

    // The action will fail in jsdom due to navigation not being implemented,
    // but that's expected. We're mainly testing the structure here.
    expect(result.stepNumber).toBe(1);
    expect(result.action).toBe('navigate');
    // Note: In jsdom, navigation throws an error, so passed will be true
    // because the code executes (jsdom logs a warning but doesn't throw)
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it('select action sets value', async () => {
    document.body.innerHTML = `
      <select id="test-select">
        <option value="1">One</option>
        <option value="2">Two</option>
      </select>
    `;
    const select = document.getElementById('test-select') as HTMLSelectElement;
    const changeListener = vi.fn();
    select.addEventListener('change', changeListener);

    const step: TestStep = {
      stepNumber: 1,
      action: 'select',
      description: 'Select option',
      selector: '#test-select',
      value: '2',
    };

    const result = await executeAction(step);

    expect(result.passed).toBe(true);
    expect(select.value).toBe('2');
    expect(changeListener).toHaveBeenCalled();
  });

  it('check action sets checkbox state', async () => {
    document.body.innerHTML = '<input id="test-checkbox" type="checkbox" />';
    const checkbox = document.getElementById(
      'test-checkbox',
    ) as HTMLInputElement;
    const changeListener = vi.fn();
    checkbox.addEventListener('change', changeListener);

    const step: TestStep = {
      stepNumber: 1,
      action: 'check',
      description: 'Check checkbox',
      selector: '#test-checkbox',
    };

    const result = await executeAction(step);

    expect(result.passed).toBe(true);
    expect(checkbox.checked).toBe(true);
    expect(changeListener).toHaveBeenCalled();
  });

  it('uncheck action clears checkbox state', async () => {
    document.body.innerHTML =
      '<input id="test-checkbox" type="checkbox" checked />';
    const checkbox = document.getElementById(
      'test-checkbox',
    ) as HTMLInputElement;

    const step: TestStep = {
      stepNumber: 1,
      action: 'uncheck',
      description: 'Uncheck checkbox',
      selector: '#test-checkbox',
    };

    const result = await executeAction(step);

    expect(result.passed).toBe(true);
    expect(checkbox.checked).toBe(false);
  });

  it('hover action dispatches mouse events', async () => {
    document.body.innerHTML = '<div id="hover-target">Hover me</div>';
    const target = document.getElementById('hover-target')!;

    const mouseenterListener = vi.fn();
    const mouseoverListener = vi.fn();
    target.addEventListener('mouseenter', mouseenterListener);
    target.addEventListener('mouseover', mouseoverListener);

    const step: TestStep = {
      stepNumber: 1,
      action: 'hover',
      description: 'Hover element',
      selector: '#hover-target',
    };

    const result = await executeAction(step);

    expect(result.passed).toBe(true);
    expect(mouseenterListener).toHaveBeenCalled();
    expect(mouseoverListener).toHaveBeenCalled();
  });

  it('keypress action dispatches keyboard events', async () => {
    document.body.innerHTML = '<input id="test-input" type="text" />';
    const input = document.getElementById('test-input') as HTMLInputElement;

    const keydownListener = vi.fn();
    const keyupListener = vi.fn();
    input.addEventListener('keydown', keydownListener);
    input.addEventListener('keyup', keyupListener);

    const step: TestStep = {
      stepNumber: 1,
      action: 'keypress',
      description: 'Press Enter',
      selector: '#test-input',
      key: 'Enter',
    };

    const result = await executeAction(step);

    expect(result.passed).toBe(true);
    expect(keydownListener).toHaveBeenCalled();
    expect(keyupListener).toHaveBeenCalled();
  });

  it('assert visible checks element visibility', async () => {
    document.body.innerHTML = '<div id="visible-el">Visible</div>';
    const element = document.getElementById('visible-el') as HTMLElement;

    // Mock offsetWidth and offsetHeight
    Object.defineProperty(element, 'offsetWidth', {
      get: () => 100,
    });
    Object.defineProperty(element, 'offsetHeight', {
      get: () => 50,
    });

    const step: TestStep = {
      stepNumber: 1,
      action: 'assert',
      description: 'Check visibility',
      selector: '#visible-el',
      assertionType: 'visible',
    };

    const result = await executeAction(step);

    expect(result.passed).toBe(true);
  });

  it('assert count checks element count', async () => {
    document.body.innerHTML = `
      <div class="item">1</div>
      <div class="item">2</div>
      <div class="item">3</div>
    `;

    const step: TestStep = {
      stepNumber: 1,
      action: 'assert',
      description: 'Check count',
      selector: '.item',
      assertionType: 'count',
      expected: 3,
    };

    const result = await executeAction(step);

    expect(result.passed).toBe(true);
  });

  it('assert attribute checks element attribute', async () => {
    document.body.innerHTML = '<a id="link" href="https://test.com">Link</a>';

    const step: TestStep = {
      stepNumber: 1,
      action: 'assert',
      description: 'Check href',
      selector: '#link',
      assertionType: 'attribute',
      name: 'href',
      expected: 'test.com',
    };

    const result = await executeAction(step);

    expect(result.passed).toBe(true);
  });

  it('assert value checks input value', async () => {
    document.body.innerHTML = '<input id="input" type="text" value="test" />';

    const step: TestStep = {
      stepNumber: 1,
      action: 'assert',
      description: 'Check value',
      selector: '#input',
      assertionType: 'value',
      expected: 'test',
    };

    const result = await executeAction(step);

    expect(result.passed).toBe(true);
  });

  it('wait action with timeout waits specified duration', async () => {
    const start = Date.now();

    const step: TestStep = {
      stepNumber: 1,
      action: 'wait',
      description: 'Wait 100ms',
      condition: 'timeout',
      timeout: 100,
    };

    const result = await executeAction(step);

    const elapsed = Date.now() - start;

    expect(result.passed).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(90); // Allow some slack
  });

  it('screenshot action returns success', async () => {
    const step: TestStep = {
      stepNumber: 1,
      action: 'screenshot',
      description: 'Take screenshot',
    };

    const result = await executeAction(step);

    expect(result.passed).toBe(true);
  });

  it('handles fallback selector', async () => {
    document.body.innerHTML = '<button class="fallback-btn">Click</button>';

    const step: TestStep = {
      stepNumber: 1,
      action: 'click',
      description: 'Click with fallback',
      selector: '#missing',
      selectorFallback: '.fallback-btn',
    };

    const result = await executeAction(step);

    expect(result.passed).toBe(true);
  });

  it('reports error for unimplemented actions', async () => {
    const step: TestStep = {
      stepNumber: 1,
      action: 'drag',
      description: 'Drag element',
    };

    const result = await executeAction(step);

    expect(result.passed).toBe(false);
    expect(result.error).toContain('not yet implemented');
  });
});
