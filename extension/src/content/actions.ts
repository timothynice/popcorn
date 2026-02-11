import type { TestStep, StepResult } from '@popcorn/shared';

const DEFAULT_TIMEOUT = 5000;

export async function executeAction(step: TestStep): Promise<StepResult> {
  const startTime = Date.now();
  const timeout = step.timeout || DEFAULT_TIMEOUT;

  try {
    let passed = false;
    let error: string | undefined;

    switch (step.action) {
      case 'navigate':
        passed = await handleNavigate(step, timeout);
        break;
      case 'click':
        passed = await handleClick(step, timeout);
        break;
      case 'fill':
        passed = await handleFill(step, timeout);
        break;
      case 'select':
        passed = await handleSelect(step, timeout);
        break;
      case 'check':
        passed = await handleCheck(step, true, timeout);
        break;
      case 'uncheck':
        passed = await handleCheck(step, false, timeout);
        break;
      case 'hover':
        passed = await handleHover(step, timeout);
        break;
      case 'scroll':
        passed = await handleScroll(step, timeout);
        break;
      case 'wait':
        passed = await handleWait(step, timeout);
        break;
      case 'assert':
        const assertResult = await handleAssert(step, timeout);
        passed = assertResult.passed;
        error = assertResult.error;
        break;
      case 'keypress':
        passed = await handleKeypress(step, timeout);
        break;
      case 'screenshot':
        passed = true; // Screenshot handled by orchestrator
        break;
      case 'drag':
      case 'upload':
        passed = false;
        error = `Action ${step.action} not yet implemented`;
        break;
      default:
        passed = false;
        error = `Unknown action: ${step.action}`;
    }

    const duration = Date.now() - startTime;

    return {
      stepNumber: step.stepNumber,
      action: step.action,
      description: step.description,
      passed,
      duration,
      error,
      timestamp: Date.now(),
    };
  } catch (err) {
    const duration = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : String(err);

    return {
      stepNumber: step.stepNumber,
      action: step.action,
      description: step.description,
      passed: false,
      duration,
      error: errorMessage,
      timestamp: Date.now(),
    };
  }
}

async function handleNavigate(step: TestStep, timeout: number): Promise<boolean> {
  if (!step.target) {
    throw new Error('Navigate action requires target URL');
  }

  window.location.href = step.target;
  // Wait for navigation to complete
  await waitForTimeout(Math.min(timeout, 3000));
  return true;
}

async function handleClick(step: TestStep, timeout: number): Promise<boolean> {
  const element = await findElement(step.selector, step.selectorFallback, timeout);
  if (!element) {
    throw new Error(`Element not found: ${step.selector}`);
  }

  if (element instanceof HTMLElement) {
    element.click();
  } else {
    throw new Error('Element is not clickable');
  }

  return true;
}

async function handleFill(step: TestStep, timeout: number): Promise<boolean> {
  const element = await findElement(step.selector, step.selectorFallback, timeout);
  if (!element) {
    throw new Error(`Element not found: ${step.selector}`);
  }

  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  ) {
    element.value = String(step.value ?? '');
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    throw new Error('Element is not a text input or textarea');
  }

  return true;
}

async function handleSelect(step: TestStep, timeout: number): Promise<boolean> {
  const element = await findElement(step.selector, step.selectorFallback, timeout);
  if (!element) {
    throw new Error(`Element not found: ${step.selector}`);
  }

  if (element instanceof HTMLSelectElement) {
    element.value = String(step.value ?? '');
    element.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    throw new Error('Element is not a select element');
  }

  return true;
}

async function handleCheck(
  step: TestStep,
  checked: boolean,
  timeout: number,
): Promise<boolean> {
  const element = await findElement(step.selector, step.selectorFallback, timeout);
  if (!element) {
    throw new Error(`Element not found: ${step.selector}`);
  }

  if (element instanceof HTMLInputElement && element.type === 'checkbox') {
    element.checked = checked;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    throw new Error('Element is not a checkbox');
  }

  return true;
}

async function handleHover(step: TestStep, timeout: number): Promise<boolean> {
  const element = await findElement(step.selector, step.selectorFallback, timeout);
  if (!element) {
    throw new Error(`Element not found: ${step.selector}`);
  }

  element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

  return true;
}

async function handleScroll(step: TestStep, timeout: number): Promise<boolean> {
  if (step.selector) {
    const element = await findElement(step.selector, step.selectorFallback, timeout);
    if (!element) {
      throw new Error(`Element not found: ${step.selector}`);
    }

    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else if (step.position) {
    window.scrollTo({
      left: step.position.x,
      top: step.position.y,
      behavior: 'smooth',
    });
  } else {
    throw new Error('Scroll action requires selector or position');
  }

  // Wait for scroll to complete
  await waitForTimeout(100);
  return true;
}

async function handleWait(step: TestStep, timeout: number): Promise<boolean> {
  if (step.condition === 'timeout') {
    await waitForTimeout(step.timeout || 1000);
    return true;
  }

  if (step.condition === 'visible' && step.selector) {
    await waitForElement(step.selector, timeout);
    return true;
  }

  if (step.condition === 'hidden' && step.selector) {
    await waitForElementHidden(step.selector, timeout);
    return true;
  }

  if (step.condition === 'networkIdle') {
    // Simple network idle detection - wait for no new requests for 500ms
    await waitForTimeout(500);
    return true;
  }

  throw new Error(`Unsupported wait condition: ${step.condition}`);
}

async function handleAssert(
  step: TestStep,
  timeout: number,
): Promise<{ passed: boolean; error?: string }> {
  try {
    switch (step.assertionType) {
      case 'text': {
        const element = await findElement(
          step.selector,
          step.selectorFallback,
          timeout,
        );
        if (!element) {
          return {
            passed: false,
            error: `Element not found: ${step.selector}`,
          };
        }

        const actualText = element.textContent?.trim() || '';
        const expectedText = String(step.expected || '');

        if (actualText.includes(expectedText)) {
          return { passed: true };
        } else {
          return {
            passed: false,
            error: `Expected text "${expectedText}" not found. Actual: "${actualText}"`,
          };
        }
      }

      case 'visible': {
        const element = await findElement(
          step.selector,
          step.selectorFallback,
          timeout,
        );
        if (!element) {
          return {
            passed: false,
            error: `Element not found: ${step.selector}`,
          };
        }

        const isVisible =
          element instanceof HTMLElement &&
          element.offsetWidth > 0 &&
          element.offsetHeight > 0;

        if (isVisible) {
          return { passed: true };
        } else {
          return {
            passed: false,
            error: `Element is not visible: ${step.selector}`,
          };
        }
      }

      case 'hidden': {
        const element = document.querySelector(step.selector || '');
        const isHidden =
          !element ||
          (element instanceof HTMLElement &&
            (element.offsetWidth === 0 || element.offsetHeight === 0));

        if (isHidden) {
          return { passed: true };
        } else {
          return {
            passed: false,
            error: `Element is visible but should be hidden: ${step.selector}`,
          };
        }
      }

      case 'url': {
        const expectedUrl = String(step.expected || '');
        const actualUrl = window.location.href;

        if (actualUrl.includes(expectedUrl)) {
          return { passed: true };
        } else {
          return {
            passed: false,
            error: `Expected URL to contain "${expectedUrl}". Actual: "${actualUrl}"`,
          };
        }
      }

      case 'count': {
        const elements = document.querySelectorAll(step.selector || '');
        const expectedCount = Number(step.expected || 0);
        const actualCount = elements.length;

        if (actualCount === expectedCount) {
          return { passed: true };
        } else {
          return {
            passed: false,
            error: `Expected ${expectedCount} elements, found ${actualCount}`,
          };
        }
      }

      case 'attribute': {
        const element = await findElement(
          step.selector,
          step.selectorFallback,
          timeout,
        );
        if (!element) {
          return {
            passed: false,
            error: `Element not found: ${step.selector}`,
          };
        }

        const attrName = step.name || '';
        const expectedValue = String(step.expected || '');
        const actualValue = element.getAttribute(attrName) || '';

        if (actualValue.includes(expectedValue)) {
          return { passed: true };
        } else {
          return {
            passed: false,
            error: `Attribute "${attrName}" expected "${expectedValue}", got "${actualValue}"`,
          };
        }
      }

      case 'value': {
        const element = await findElement(
          step.selector,
          step.selectorFallback,
          timeout,
        );
        if (!element) {
          return {
            passed: false,
            error: `Element not found: ${step.selector}`,
          };
        }

        if (
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement
        ) {
          const expectedValue = String(step.expected || '');
          const actualValue = element.value;

          if (actualValue === expectedValue) {
            return { passed: true };
          } else {
            return {
              passed: false,
              error: `Expected value "${expectedValue}", got "${actualValue}"`,
            };
          }
        } else {
          return {
            passed: false,
            error: 'Element does not have a value property',
          };
        }
      }

      default:
        return {
          passed: false,
          error: `Unknown assertion type: ${step.assertionType}`,
        };
    }
  } catch (err) {
    return {
      passed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function handleKeypress(step: TestStep, timeout: number): Promise<boolean> {
  const element = step.selector
    ? await findElement(step.selector, step.selectorFallback, timeout)
    : document.activeElement;

  if (!element) {
    throw new Error('No target element for keypress');
  }

  const key = step.key || step.value || '';
  const event = new KeyboardEvent('keydown', {
    key: String(key),
    bubbles: true,
    cancelable: true,
  });

  element.dispatchEvent(event);
  element.dispatchEvent(
    new KeyboardEvent('keyup', {
      key: String(key),
      bubbles: true,
      cancelable: true,
    }),
  );

  return true;
}

// Helper functions

async function findElement(
  selector: string | undefined,
  fallback: string | undefined,
  timeout: number,
): Promise<Element | null> {
  if (!selector) {
    throw new Error('No selector provided');
  }

  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    let element = document.querySelector(selector);
    if (element) return element;

    if (fallback) {
      element = document.querySelector(fallback);
      if (element) return element;
    }

    await waitForTimeout(100);
  }

  return null;
}

async function waitForElement(
  selector: string,
  timeout: number,
): Promise<Element | null> {
  return findElement(selector, undefined, timeout);
}

async function waitForElementHidden(
  selector: string,
  timeout: number,
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const element = document.querySelector(selector);
    if (
      !element ||
      (element instanceof HTMLElement &&
        (element.offsetWidth === 0 || element.offsetHeight === 0))
    ) {
      return true;
    }

    await waitForTimeout(100);
  }

  return false;
}

function waitForTimeout(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
