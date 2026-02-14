/**
 * DOM utilities for reliable UI testing.
 * Provides Playwright-inspired actionability checks, DOM stability detection,
 * and modal/dialog detection for the content script.
 */

// -- DOM Stability --

/**
 * Waits for the DOM to stop mutating (no changes for `quiesceMs` consecutive ms).
 * Returns true if DOM settled within the timeout, false if it timed out.
 */
export function waitForDomStability(
  timeoutMs = 3000,
  quiesceMs = 150,
): Promise<boolean> {
  return new Promise((resolve) => {
    let quiesceTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const timeoutTimer = setTimeout(() => {
      observer.disconnect();
      if (quiesceTimer) clearTimeout(quiesceTimer);
      if (!settled) resolve(false);
    }, timeoutMs);

    function onQuiesce() {
      settled = true;
      observer.disconnect();
      clearTimeout(timeoutTimer);
      resolve(true);
    }

    function resetQuiesce() {
      if (quiesceTimer) clearTimeout(quiesceTimer);
      quiesceTimer = setTimeout(onQuiesce, quiesceMs);
    }

    const observer = new MutationObserver(() => {
      resetQuiesce();
    });

    // Start observing — if no mutations at all, quiesce timer fires quickly
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });

    // Kick off the initial quiesce timer (DOM may already be stable)
    resetQuiesce();
  });
}

// -- Actionability Checks --

export interface ActionabilityResult {
  actionable: boolean;
  reason?: 'not_found' | 'hidden' | 'disabled' | 'obscured' | 'unstable';
}

/**
 * Checks whether an element is ready for interaction (Playwright-inspired).
 * Checks: found → visible → enabled → not obscured → stable.
 */
export async function checkActionability(
  selector: string,
  selectorFallback?: string,
): Promise<ActionabilityResult> {
  // 1. Found
  let element = document.querySelector(selector);
  if (!element && selectorFallback) {
    element = document.querySelector(selectorFallback);
  }
  if (!element) {
    return { actionable: false, reason: 'not_found' };
  }

  if (!(element instanceof HTMLElement)) {
    return { actionable: false, reason: 'hidden' };
  }

  // 2. Visible
  if (element.offsetWidth === 0 && element.offsetHeight === 0) {
    return { actionable: false, reason: 'hidden' };
  }
  const style = getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') {
    return { actionable: false, reason: 'hidden' };
  }

  // 3. Enabled
  if ('disabled' in element && (element as HTMLButtonElement).disabled) {
    return { actionable: false, reason: 'disabled' };
  }
  if (element.getAttribute('aria-disabled') === 'true') {
    return { actionable: false, reason: 'disabled' };
  }

  // 4. Not obscured — check if elementFromPoint hits the element or a descendant
  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const topElement = document.elementFromPoint(centerX, centerY);
  if (topElement && topElement !== element && !element.contains(topElement)) {
    return { actionable: false, reason: 'obscured' };
  }

  // 5. Stable — bounding box unchanged across one animation frame
  const rectBefore = element.getBoundingClientRect();
  await new Promise((r) => requestAnimationFrame(r));
  const rectAfter = element.getBoundingClientRect();
  const moved =
    Math.abs(rectBefore.left - rectAfter.left) > 1 ||
    Math.abs(rectBefore.top - rectAfter.top) > 1 ||
    Math.abs(rectBefore.width - rectAfter.width) > 1 ||
    Math.abs(rectBefore.height - rectAfter.height) > 1;
  if (moved) {
    return { actionable: false, reason: 'unstable' };
  }

  return { actionable: true };
}

// -- Modal/Dialog Detection --

export interface ModalInfo {
  type: 'dialog' | 'overlay' | 'alert';
  selector: string;
  dismissSelector?: string;
}

/** Common selectors for close/dismiss buttons inside modals. */
const DISMISS_SELECTORS = [
  '[aria-label*="close" i]',
  '[aria-label*="dismiss" i]',
  '.modal-close',
  '.close-button',
  '[data-dismiss]',
];

/** Text patterns that indicate a dismiss button. */
const DISMISS_TEXT = /^(close|cancel|dismiss|x|×|✕|✖)$/i;

/**
 * Detects whether a modal or dialog is currently visible on the page.
 * Returns info about the modal and a selector for its dismiss button, or null.
 */
export function detectModalOrDialog(): ModalInfo | null {
  // 1. Native <dialog open>
  const openDialog = document.querySelector('dialog[open]');
  if (openDialog && openDialog instanceof HTMLElement) {
    const dismiss = findDismissButton(openDialog);
    return {
      type: 'dialog',
      selector: 'dialog[open]',
      dismissSelector: dismiss,
    };
  }

  // 2. ARIA role="dialog" or role="alertdialog"
  for (const role of ['dialog', 'alertdialog']) {
    const el = document.querySelector(`[role="${role}"]`);
    if (el && el instanceof HTMLElement && isVisible(el)) {
      const dismiss = findDismissButton(el);
      return {
        type: role === 'alertdialog' ? 'alert' : 'dialog',
        selector: `[role="${role}"]`,
        dismissSelector: dismiss,
      };
    }
  }

  // 3. Fixed-position overlay covering >30% of viewport
  const viewportArea = window.innerWidth * window.innerHeight;
  const fixedElements = document.querySelectorAll('*');
  for (const el of fixedElements) {
    if (!(el instanceof HTMLElement)) continue;
    const style = getComputedStyle(el);
    if (style.position !== 'fixed' && style.position !== 'absolute') continue;
    const zIndex = parseInt(style.zIndex, 10);
    if (isNaN(zIndex) || zIndex < 1000) continue;
    if (!isVisible(el)) continue;

    const rect = el.getBoundingClientRect();
    const elArea = rect.width * rect.height;
    if (elArea / viewportArea > 0.3) {
      const dismiss = findDismissButton(el);
      return {
        type: 'overlay',
        selector: buildQuickSelector(el),
        dismissSelector: dismiss,
      };
    }
  }

  return null;
}

function isVisible(el: HTMLElement): boolean {
  if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function findDismissButton(container: Element): string | undefined {
  // Try known dismiss selectors
  for (const sel of DISMISS_SELECTORS) {
    const btn = container.querySelector(sel);
    if (btn && btn instanceof HTMLElement && isVisible(btn)) {
      return buildQuickSelector(btn);
    }
  }

  // Try buttons with dismiss-like text
  const buttons = container.querySelectorAll('button');
  for (const btn of buttons) {
    const text = btn.textContent?.trim() || '';
    if (DISMISS_TEXT.test(text)) {
      return buildQuickSelector(btn);
    }
  }

  return undefined;
}

/** Build a minimal selector for an element (for dismiss button targeting). */
function buildQuickSelector(el: Element): string {
  if (!el || !el.tagName) return 'unknown';
  if (el.id) return `#${el.id}`;

  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) {
    const tag = el.tagName.toLowerCase();
    const sel = `${tag}[aria-label="${ariaLabel}"]`;
    if (document.querySelectorAll(sel).length === 1) return sel;
  }

  // Fallback: tag + nth-of-type
  const tag = el.tagName.toLowerCase();
  const allOfType = document.querySelectorAll(tag);
  const idx = Array.from(allOfType).indexOf(el) + 1;
  return `${tag}:nth-of-type(${idx})`;
}
