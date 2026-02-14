/**
 * Live DOM page scanner — injected on-demand via chrome.scripting.executeScript.
 * Queries the live DOM for interactive elements and returns DetectedElement[]
 * compatible with shared buildSteps().
 *
 * This file is a standalone IIFE that runs in the page context and returns results.
 */

interface ScannedElement {
  type: 'form' | 'input' | 'button' | 'link' | 'select' | 'textarea' | 'checkbox';
  selector: string;
  name?: string;
  href?: string;
  inputType?: string;
  label?: string;
  mayNavigate?: boolean;
}

/**
 * Checks whether an element is interactable (visible, not disabled).
 * Filters out elements that can never be clicked before adding them to results.
 */
function isInteractable(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if ('disabled' in el && (el as any).disabled) return false;
  if (el.getAttribute('aria-disabled') === 'true') return false;
  // Inside a collapsed <details> that is not open (but not the <summary>)
  const closedDetails = el.closest('details:not([open])');
  if (closedDetails && !closedDetails.contains(el.closest('summary'))) return false;
  return true;
}

/**
 * Detects whether a button has navigation intent (onclick with location/href,
 * parent <a>, or submit type with form action).
 */
function hasNavigationIntent(el: HTMLButtonElement): boolean {
  const onclick = el.getAttribute('onclick') || '';
  if (/location|navigate|href|window\.open/i.test(onclick)) return true;
  if (el.type === 'submit' && el.form?.action) return true;
  if (el.closest('a[href]')) return true;
  return false;
}

/**
 * Build a unique CSS selector for an element by testing candidates against
 * the live DOM. Stops at the first selector that resolves to exactly one element.
 *
 * Priority: #id > tag[name] > tag[data-testid] > tag[aria-label] >
 *           parent > tag:nth-child > tag:nth-of-type (bare tag)
 */
function buildUniqueSelector(el: Element): string {
  // 1. ID — always unique
  if (el.id) return `#${el.id}`;

  const tag = el.tagName.toLowerCase();

  // 2. name attribute
  const name = el.getAttribute('name');
  if (name) {
    const sel = `${tag}[name="${name}"]`;
    if (document.querySelectorAll(sel).length === 1) return sel;
  }

  // 3. Identity attributes (data-testid, aria-label)
  for (const attr of ['data-testid', 'aria-label']) {
    const val = el.getAttribute(attr);
    if (val) {
      const sel = `${tag}[${attr}="${val}"]`;
      if (document.querySelectorAll(sel).length === 1) return sel;
    }
  }

  // 4. Parent context + nth-child (always unique when parent selector is unique)
  const parent = el.parentElement;
  if (parent) {
    const children = Array.from(parent.children);
    const idx = children.indexOf(el) + 1; // 1-based for :nth-child
    let parentSel: string | null = null;

    if (parent.id) {
      parentSel = `#${parent.id}`;
    } else if (parent === document.body) {
      parentSel = 'body';
    }

    if (parentSel) {
      const sel = `${parentSel} > ${tag}:nth-child(${idx})`;
      if (document.querySelectorAll(sel).length === 1) return sel;
    }
  }

  // 5. Bare tag + nth-of-type (always valid CSS — nth-of-type works on bare tags)
  const allOfType = document.querySelectorAll(tag);
  const typeIdx = Array.from(allOfType).indexOf(el) + 1;
  return `${tag}:nth-of-type(${typeIdx})`;
}

/**
 * Find a label for a form element.
 * Checks: <label for="...">, aria-label, placeholder, aria-labelledby.
 */
function findLabel(el: Element): string | undefined {
  // <label for="id">
  if (el.id) {
    const label = document.querySelector(`label[for="${el.id}"]`);
    if (label?.textContent?.trim()) return label.textContent.trim();
  }

  // aria-label
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  // placeholder
  const placeholder = el.getAttribute('placeholder');
  if (placeholder) return placeholder;

  // aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy);
    if (labelEl?.textContent?.trim()) return labelEl.textContent.trim();
  }

  // Parent label
  const parentLabel = el.closest('label');
  if (parentLabel?.textContent?.trim()) return parentLabel.textContent.trim();

  return undefined;
}

function scanPage(): ScannedElement[] {
  const elements: ScannedElement[] = [];

  // Forms
  document.querySelectorAll('form').forEach((form) => {
    elements.push({
      type: 'form',
      selector: buildUniqueSelector(form),
    });
  });

  // Inputs (excluding hidden)
  document.querySelectorAll('input:not([type="hidden"])').forEach((input) => {
    const el = input as HTMLInputElement;
    if (!isInteractable(el)) return;
    const type = el.type || 'text';
    const selector = buildUniqueSelector(el);
    const label = findLabel(el);

    if (type === 'checkbox' || type === 'radio') {
      elements.push({
        type: 'checkbox',
        selector,
        name: el.name || undefined,
        inputType: type,
        label,
      });
    } else if (type === 'submit') {
      elements.push({
        type: 'button',
        selector,
        name: el.name || undefined,
        label: label || el.value || undefined,
        mayNavigate: !!el.form?.action,
      });
    } else {
      elements.push({
        type: 'input',
        selector,
        name: el.name || undefined,
        inputType: type,
        label,
      });
    }
  });

  // Textareas
  document.querySelectorAll('textarea').forEach((textarea) => {
    const el = textarea as HTMLTextAreaElement;
    if (!isInteractable(el)) return;
    elements.push({
      type: 'textarea',
      selector: buildUniqueSelector(el),
      name: el.name || undefined,
      label: findLabel(el),
    });
  });

  // Selects
  document.querySelectorAll('select').forEach((select) => {
    const el = select as HTMLSelectElement;
    if (!isInteractable(el)) return;
    elements.push({
      type: 'select',
      selector: buildUniqueSelector(el),
      name: el.name || undefined,
      label: findLabel(el),
    });
  });

  // Buttons
  document.querySelectorAll('button').forEach((button) => {
    const el = button as HTMLButtonElement;
    if (!isInteractable(el)) return;
    const label = el.textContent?.trim() || findLabel(el);
    elements.push({
      type: 'button',
      selector: buildUniqueSelector(el),
      label,
      mayNavigate: hasNavigationIntent(el),
    });
  });

  // Links with meaningful hrefs
  const currentOrigin = window.location.origin;
  const normalise = (u: string) => u.replace(/\/+$/, '').replace(/#$/, '');
  const currentNorm = normalise(window.location.href);

  document.querySelectorAll('a[href]').forEach((link) => {
    const el = link as HTMLAnchorElement;
    if (!isInteractable(el)) return;
    const rawHref = el.getAttribute('href');
    if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:')) return;

    // Use the browser-resolved absolute URL for accurate comparison
    const resolvedHref = el.href; // fully resolved by the browser
    if (!resolvedHref) return;

    // Skip links that resolve to the current page (same URL)
    if (normalise(resolvedHref) === currentNorm) return;

    // Skip links to different origins (external sites) — focus on internal navigation
    try {
      const linkOrigin = new URL(resolvedHref).origin;
      if (linkOrigin !== currentOrigin) return;
    } catch {
      return; // malformed URL
    }

    const label = el.textContent?.trim() || findLabel(el);
    elements.push({
      type: 'link',
      selector: buildUniqueSelector(el),
      href: resolvedHref, // pass absolute URL so buildSteps doesn't need to re-resolve
      label,
    });
  });

  return elements;
}

// Execute and return results
scanPage();
