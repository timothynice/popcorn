import type { TestStep, StepResult } from '@popcorn/shared';
import {
  waitForDomStability,
  checkActionability,
  detectModalOrDialog,
} from './dom-utils.js';

const DEFAULT_TIMEOUT = 5000;

/** Unified return type for all action handlers. */
interface ActionResult {
  passed: boolean;
  error?: string;
  metadata?: Record<string, unknown>;
}

export async function executeAction(step: TestStep): Promise<StepResult> {
  const startTime = Date.now();
  const timeout = step.timeout || DEFAULT_TIMEOUT;

  try {
    let result: ActionResult;

    switch (step.action) {
      case 'navigate':
        result = await handleNavigate(step, timeout);
        break;
      case 'click':
        result = await handleClick(step, timeout);
        break;
      case 'fill':
        result = await handleFill(step, timeout);
        break;
      case 'select':
        result = await handleSelect(step, timeout);
        break;
      case 'check':
        result = await handleCheck(step, true, timeout);
        break;
      case 'uncheck':
        result = await handleCheck(step, false, timeout);
        break;
      case 'hover':
        result = await handleHover(step, timeout);
        break;
      case 'scroll':
        result = await handleScroll(step, timeout);
        break;
      case 'wait':
        result = await handleWait(step, timeout);
        break;
      case 'assert':
        result = await handleAssert(step, timeout);
        break;
      case 'keypress':
        result = await handleKeypress(step, timeout);
        break;
      case 'screenshot':
        result = step.name === 'multi-state-discovery'
          ? await handleMultiStateDiscovery(step)
          : await handleScreenshot(step);
        break;
      case 'go_back':
        result = await handleGoBack();
        break;
      case 'check_actionability':
        result = await handleCheckActionability(step);
        break;
      case 'dismiss_modal':
        result = await handleDismissModal();
        break;
      case 'get_page_state':
        result = handleGetPageState();
        break;
      case 'drag':
      case 'upload':
        result = { passed: false, error: `Action ${step.action} not yet implemented` };
        break;
      default:
        result = { passed: false, error: `Unknown action: ${step.action}` };
    }

    const duration = Date.now() - startTime;

    return {
      stepNumber: step.stepNumber,
      action: step.action,
      description: step.description,
      passed: result.passed,
      duration,
      error: result.error,
      metadata: result.metadata,
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

async function handleNavigate(step: TestStep, timeout: number): Promise<ActionResult> {
  if (!step.target) {
    throw new Error('Navigate action requires target URL');
  }

  window.location.href = step.target;
  // Wait for navigation to complete
  await waitForTimeout(Math.min(timeout, 3000));
  return {
    passed: true,
    metadata: { targetUrl: step.target, finalUrl: window.location.href },
  };
}

async function handleGoBack(): Promise<ActionResult> {
  window.history.back();
  await waitForTimeout(300);
  return {
    passed: true,
    metadata: { finalUrl: window.location.href },
  };
}

async function handleClick(step: TestStep, timeout: number): Promise<ActionResult> {
  const element = await findElement(step.selector, step.selectorFallback, timeout);
  if (!element) {
    throw new Error(`Element not found: ${step.selector}`);
  }

  if (!(element instanceof HTMLElement)) {
    throw new Error('Element is not clickable');
  }

  const urlBefore = window.location.href;
  element.click();

  // Wait for DOM to settle after click (replaces fixed timeouts)
  const domSettled = await waitForDomStability(3000, 150);

  const urlAfter = window.location.href;
  const urlChanged = urlAfter !== urlBefore;
  let modal: ReturnType<typeof detectModalOrDialog> = null;
  try { modal = detectModalOrDialog(); } catch { /* ignore detection errors */ }

  return {
    passed: true,
    metadata: {
      urlBefore,
      urlAfter,
      urlChanged,
      domSettled,
      modalDetected: modal
        ? { type: modal.type, selector: modal.selector, dismissSelector: modal.dismissSelector }
        : null,
    },
  };
}

async function handleFill(step: TestStep, timeout: number): Promise<ActionResult> {
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

  return { passed: true };
}

async function handleSelect(step: TestStep, timeout: number): Promise<ActionResult> {
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

  return { passed: true };
}

async function handleCheck(
  step: TestStep,
  checked: boolean,
  timeout: number,
): Promise<ActionResult> {
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

  return { passed: true };
}

async function handleHover(step: TestStep, timeout: number): Promise<ActionResult> {
  const element = await findElement(step.selector, step.selectorFallback, timeout);
  if (!element) {
    throw new Error(`Element not found: ${step.selector}`);
  }

  element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

  return { passed: true };
}

async function handleScroll(step: TestStep, timeout: number): Promise<ActionResult> {
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
  return { passed: true };
}

async function handleWait(step: TestStep, timeout: number): Promise<ActionResult> {
  if (step.condition === 'timeout') {
    await waitForTimeout(step.timeout || 1000);
    return { passed: true };
  }

  if (step.condition === 'visible' && step.selector) {
    await waitForElement(step.selector, timeout);
    return { passed: true };
  }

  if (step.condition === 'hidden' && step.selector) {
    await waitForElementHidden(step.selector, timeout);
    return { passed: true };
  }

  if (step.condition === 'networkIdle') {
    // Simple network idle detection - wait for no new requests for 500ms
    await waitForTimeout(500);
    return { passed: true };
  }

  if (step.condition === 'domStable') {
    const settled = await waitForDomStability(step.timeout || 2000, 150);
    return { passed: true, metadata: { domSettled: settled } };
  }

  throw new Error(`Unsupported wait condition: ${step.condition}`);
}

async function handleAssert(
  step: TestStep,
  timeout: number,
): Promise<ActionResult> {
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
          return {
            passed: true,
            metadata: { assertionType: 'text', expectedText, actualText },
          };
        } else {
          return {
            passed: false,
            error: `Expected text "${expectedText}" not found. Actual: "${actualText}"`,
            metadata: { assertionType: 'text', expectedText, actualText },
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
          return { passed: true, metadata: { assertionType: 'visible' } };
        } else {
          return {
            passed: false,
            error: `Element is not visible: ${step.selector}`,
            metadata: { assertionType: 'visible' },
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
          return { passed: true, metadata: { assertionType: 'hidden' } };
        } else {
          return {
            passed: false,
            error: `Element is visible but should be hidden: ${step.selector}`,
            metadata: { assertionType: 'hidden' },
          };
        }
      }

      case 'url': {
        const expectedUrl = String(step.expected || '');
        const actualUrl = window.location.href;

        if (actualUrl.includes(expectedUrl)) {
          return {
            passed: true,
            metadata: { assertionType: 'url', expectedUrl, actualUrl },
          };
        } else {
          return {
            passed: false,
            error: `Expected URL to contain "${expectedUrl}". Actual: "${actualUrl}"`,
            metadata: { assertionType: 'url', expectedUrl, actualUrl },
          };
        }
      }

      case 'count': {
        const elements = document.querySelectorAll(step.selector || '');
        const expectedCount = Number(step.expected || 0);
        const actualCount = elements.length;

        if (actualCount === expectedCount) {
          return {
            passed: true,
            metadata: { assertionType: 'count', expectedCount, actualCount },
          };
        } else {
          return {
            passed: false,
            error: `Expected ${expectedCount} elements, found ${actualCount}`,
            metadata: { assertionType: 'count', expectedCount, actualCount },
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
          return { passed: true, metadata: { assertionType: 'attribute', attrName, expectedValue, actualValue } };
        } else {
          return {
            passed: false,
            error: `Attribute "${attrName}" expected "${expectedValue}", got "${actualValue}"`,
            metadata: { assertionType: 'attribute', attrName, expectedValue, actualValue },
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
            return { passed: true, metadata: { assertionType: 'value', expectedValue, actualValue } };
          } else {
            return {
              passed: false,
              error: `Expected value "${expectedValue}", got "${actualValue}"`,
              metadata: { assertionType: 'value', expectedValue, actualValue },
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

const NAVIGATION_SELECTORS = [
  '[role="tab"]',
  '[data-slide]',
  '[data-slide-index]',
  '.carousel-control',
  'button[aria-label*="next" i]',
  'button[aria-label*="prev" i]',
  '.pagination a',
  '.progress-dot',
  '.dot',
  '.nav-dot',
  'button[aria-label*="slide" i]',
].join(', ');

async function handleMultiStateDiscovery(_step: TestStep): Promise<ActionResult> {
  const controls = document.querySelectorAll(NAVIGATION_SELECTORS);
  const discoveredControls = controls.length;

  // Click through each discovered control to cycle states
  const statesVisited: string[] = [];
  for (const control of Array.from(controls)) {
    if (control instanceof HTMLElement) {
      const label = control.getAttribute('aria-label')
        || control.textContent?.trim().slice(0, 30)
        || control.tagName;
      control.click();
      await waitForTimeout(300);
      statesVisited.push(label);
    }
  }

  return {
    passed: true,
    metadata: {
      discoveredControls,
      statesVisited,
    },
  };
}

async function handleScreenshot(_step: TestStep): Promise<ActionResult> {
  // Return a marker — the background will capture the screenshot after
  // receiving results. This avoids Chrome messaging issues where
  // chrome.runtime.sendMessage from inside an onMessage handler breaks
  // the response channel and causes all content script results to be lost.
  return {
    passed: true,
    metadata: { needsBackgroundScreenshot: true },
  };
}

async function handleKeypress(step: TestStep, timeout: number): Promise<ActionResult> {
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

  return { passed: true };
}

async function handleCheckActionability(step: TestStep): Promise<ActionResult> {
  const result = await checkActionability(step.selector || '', step.selectorFallback);
  return {
    passed: result.actionable,
    error: result.actionable ? undefined : `Element not actionable: ${result.reason}`,
    metadata: {
      actionable: result.actionable,
      reason: result.reason,
    },
  };
}

async function handleDismissModal(): Promise<ActionResult> {
  let modal: ReturnType<typeof detectModalOrDialog>;
  try {
    modal = detectModalOrDialog();
  } catch {
    return { passed: true, metadata: { dismissed: false, reason: 'detection_error' } };
  }
  if (!modal) {
    return { passed: true, metadata: { dismissed: false, reason: 'no_modal' } };
  }

  if (modal.dismissSelector) {
    const dismissBtn = document.querySelector(modal.dismissSelector);
    if (dismissBtn instanceof HTMLElement) {
      dismissBtn.click();
      await waitForDomStability(2000, 150);
      return { passed: true, metadata: { dismissed: true, modalType: modal.type } };
    }
  }

  // Try pressing Escape as fallback
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
  await waitForTimeout(300);
  return { passed: true, metadata: { dismissed: true, method: 'escape', modalType: modal.type } };
}

function handleGetPageState(): ActionResult {
  return {
    passed: true,
    metadata: {
      url: window.location.href,
      title: document.title,
    },
  };
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
