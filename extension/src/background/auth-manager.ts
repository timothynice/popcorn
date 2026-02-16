/**
 * AuthManager handles automatic login for authenticated apps.
 *
 * When a demo is about to run and the active tab is on a login page,
 * AuthManager can auto-fill saved test credentials and submit the form
 * so the demo proceeds on the intended page instead of failing on login.
 *
 * Credentials are stored in chrome.storage.local — intended for
 * development/test credentials only.
 */

export interface AuthSettings {
  enabled: boolean;
  username: string;
  password: string;
  loginPatterns: string[];
}

export interface LoginPageCheck {
  isLogin: boolean;
  usernameSelector: string | null;
  passwordSelector: string | null;
  submitSelector: string | null;
}

export interface AutoLoginResult {
  success: boolean;
  finalUrl: string;
  error?: string;
}

const STORAGE_KEY = 'popcorn_auth_settings';

const DEFAULT_SETTINGS: AuthSettings = {
  enabled: false,
  username: '',
  password: '',
  loginPatterns: ['/login', '/signin', '/auth', '/sign-in', '/log-in'],
};

export class AuthManager {
  async getSettings(): Promise<AuthSettings> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      if (result[STORAGE_KEY]) {
        return { ...DEFAULT_SETTINGS, ...result[STORAGE_KEY] };
      }
    } catch {
      // Storage unavailable
    }
    return { ...DEFAULT_SETTINGS };
  }

  async saveSettings(settings: Partial<AuthSettings>): Promise<void> {
    const current = await this.getSettings();
    const updated = { ...current, ...settings };
    await chrome.storage.local.set({ [STORAGE_KEY]: updated });
  }

  /**
   * Checks if the given tab is on a login page by:
   * 1. Matching the tab URL against configured login patterns
   * 2. Detecting a password input field on the page
   *
   * Returns selectors for username, password, and submit elements if found.
   */
  async isLoginPage(tabId: number): Promise<LoginPageCheck> {
    const settings = await this.getSettings();

    // First check: does the tab URL match any login patterns?
    let tab: chrome.tabs.Tab | undefined;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      return { isLogin: false, usernameSelector: null, passwordSelector: null, submitSelector: null };
    }

    const tabUrl = tab.url || '';
    const urlMatchesPattern = settings.loginPatterns.some((pattern) => {
      try {
        const url = new URL(tabUrl);
        return url.pathname.includes(pattern);
      } catch {
        return tabUrl.includes(pattern);
      }
    });

    // Second check: inject a script to detect login form elements
    let domCheck: LoginPageCheck = {
      isLogin: false,
      usernameSelector: null,
      passwordSelector: null,
      submitSelector: null,
    };

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: detectLoginFormElements,
      });

      if (results?.[0]?.result) {
        domCheck = results[0].result as LoginPageCheck;
      }
    } catch {
      // Script injection failed (e.g., chrome:// page)
    }

    // A page is a login page if URL matches AND/OR it has a password field
    const isLogin = urlMatchesPattern || domCheck.isLogin;

    return {
      isLogin,
      usernameSelector: domCheck.usernameSelector,
      passwordSelector: domCheck.passwordSelector,
      submitSelector: domCheck.submitSelector,
    };
  }

  /**
   * Attempts to auto-login by filling credentials and submitting the form.
   * Polls the tab URL until it no longer matches login patterns (or times out).
   */
  async autoLogin(tabId: number): Promise<AutoLoginResult> {
    const settings = await this.getSettings();

    if (!settings.enabled || !settings.username || !settings.password) {
      return { success: false, finalUrl: '', error: 'Auth not configured' };
    }

    const loginCheck = await this.isLoginPage(tabId);
    if (!loginCheck.isLogin) {
      // Not on a login page — nothing to do
      const tab = await chrome.tabs.get(tabId);
      return { success: true, finalUrl: tab.url || '' };
    }

    // Step 1: Fill credentials (separate from submit so React can process state)
    console.log('[Popcorn] Auto-login step 1: filling credentials');
    try {
      const fillResults = await chrome.scripting.executeScript({
        target: { tabId },
        func: performFillCredentials,
        args: [
          settings.username,
          settings.password,
          loginCheck.usernameSelector,
          loginCheck.passwordSelector,
        ],
      });

      const fillResult = fillResults?.[0]?.result as {
        filled: boolean;
        error?: string;
        usernameVerified?: boolean;
        passwordVerified?: boolean;
      } | undefined;

      console.log('[Popcorn] Fill result:', JSON.stringify(fillResult));

      if (!fillResult?.filled) {
        return {
          success: false,
          finalUrl: '',
          error: fillResult?.error || 'Failed to fill login form',
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Popcorn] Fill threw error:', msg);
      return { success: false, finalUrl: '', error: msg };
    }

    // Step 2: Poll until form is ready (inputs have values, button enabled)
    console.log('[Popcorn] Auto-login step 2: waiting for form readiness');
    try {
      const readyResults = await chrome.scripting.executeScript({
        target: { tabId },
        func: performVerifyFormReady,
        args: [
          loginCheck.usernameSelector,
          loginCheck.passwordSelector,
          loginCheck.submitSelector,
          2000,
        ],
      });

      const readyResult = readyResults?.[0]?.result as {
        ready: boolean;
        reason: string;
        buttonDisabled?: boolean;
        usernameEmpty?: boolean;
        passwordEmpty?: boolean;
      } | undefined;

      console.log('[Popcorn] Form readiness:', JSON.stringify(readyResult));

      if (!readyResult?.ready) {
        console.warn('[Popcorn] Form not ready — proceeding anyway:', readyResult?.reason);
      }
    } catch (err) {
      console.warn('[Popcorn] Readiness check failed, proceeding anyway:', err);
    }

    // Step 3: Click submit
    console.log('[Popcorn] Auto-login step 3: clicking submit');
    try {
      const clickResults = await chrome.scripting.executeScript({
        target: { tabId },
        func: performClickSubmit,
        args: [loginCheck.submitSelector],
      });

      const clickResult = clickResults?.[0]?.result as {
        clicked: boolean;
        method?: string;
        error?: string;
      } | undefined;

      console.log('[Popcorn] Click result:', JSON.stringify(clickResult));
    } catch (err) {
      console.warn('[Popcorn] Submit click threw:', err);
      // Still try to detect redirect in case form auto-submitted
    }

    // Step 4: Wait for navigation away from login page (poll up to 10s)
    console.log('[Popcorn] Auto-login step 4: waiting for redirect');
    const finalUrl = await this.waitForLoginRedirect(tabId, settings.loginPatterns, 10000);

    if (finalUrl) {
      console.log(`[Popcorn] Auto-login succeeded, now at: ${finalUrl}`);
    } else {
      console.warn('[Popcorn] Auto-login timed out waiting for redirect');
    }

    return {
      success: finalUrl !== null,
      finalUrl: finalUrl || '',
      error: finalUrl === null ? 'Timed out waiting for login redirect' : undefined,
    };
  }

  /**
   * Polls the tab URL until it no longer matches any login pattern,
   * indicating a successful login redirect.
   */
  private async waitForLoginRedirect(
    tabId: number,
    loginPatterns: string[],
    timeoutMs: number,
  ): Promise<string | null> {
    const start = Date.now();
    const pollInterval = 500;

    while (Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));

      try {
        const tab = await chrome.tabs.get(tabId);
        const tabUrl = tab.url || '';

        // Check if we've navigated away from a login page
        const stillOnLogin = loginPatterns.some((pattern) => {
          try {
            const url = new URL(tabUrl);
            return url.pathname.includes(pattern);
          } catch {
            return tabUrl.includes(pattern);
          }
        });

        if (!stillOnLogin) {
          console.log(`[Popcorn] Login redirect detected: ${tabUrl}`);
          return tabUrl;
        }

        // Also check if the password field has disappeared (some apps
        // show a loading state or redirect client-side on the same URL)
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => !document.querySelector('input[type="password"]'),
          });
          if (results?.[0]?.result) {
            console.log(`[Popcorn] Login form disappeared, assuming redirect: ${tabUrl}`);
            // Wait a moment for the URL to update after client-side nav
            await new Promise((resolve) => setTimeout(resolve, 500));
            const updatedTab = await chrome.tabs.get(tabId);
            return updatedTab.url || tabUrl;
          }
        } catch {
          // Script injection failed; continue polling
        }
      } catch {
        // Tab may have been closed
        return null;
      }
    }

    return null;
  }
}

// ---- Injected functions (run in page context) ----
// IMPORTANT: These functions are serialized by chrome.scripting.executeScript
// and run in the page's isolated context. They CANNOT reference any other
// functions or variables from this module — all helpers must be inlined.

/**
 * Detects login form elements on the current page.
 * Injected via chrome.scripting.executeScript.
 */
function detectLoginFormElements(): LoginPageCheck {
  // -- inline helpers (must be inside injected function) --

  function _buildSelector(el: Element): string {
    if (el.id) return `#${CSS.escape(el.id)}`;

    const name = el.getAttribute('name');
    if (name) {
      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute('type');
      const sel = type ? `${tag}[type="${type}"][name="${name}"]` : `${tag}[name="${name}"]`;
      if (document.querySelectorAll(sel).length === 1) return sel;
    }

    const type = el.getAttribute('type');
    const placeholder = el.getAttribute('placeholder');
    if (type && placeholder) {
      const sel = `input[type="${type}"][placeholder="${CSS.escape(placeholder)}"]`;
      if (document.querySelectorAll(sel).length === 1) return sel;
    }

    if (type && type !== 'text') {
      const sel = `input[type="${type}"]`;
      if (document.querySelectorAll(sel).length === 1) return sel;
    }

    const parent = el.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
      const index = siblings.indexOf(el) + 1;
      return `${el.tagName.toLowerCase()}:nth-of-type(${index})`;
    }
    return el.tagName.toLowerCase();
  }

  function _findUsernameInput(pwInput: HTMLElement): HTMLInputElement | null {
    const selectors = [
      'input[type="email"]', 'input[name="email"]', 'input[name="username"]',
      'input[name="user"]', 'input[autocomplete="email"]', 'input[autocomplete="username"]',
      'input[id*="email" i]', 'input[id*="user" i]',
    ];
    const form = pwInput.closest('form') || document.body;
    for (const sel of selectors) {
      const el = form.querySelector(sel) as HTMLInputElement;
      if (el && el.type !== 'password' && el.type !== 'hidden') return el;
    }
    const inputs = form.querySelectorAll('input:not([type="hidden"]):not([type="password"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"])');
    return inputs.length > 0 ? (inputs[0] as HTMLInputElement) : null;
  }

  function _findSubmitButton(nearElement: HTMLElement): HTMLElement | null {
    const form = nearElement.closest('form');
    const container = form || document.body;
    const selectors = [
      'button[type="submit"]', 'input[type="submit"]',
      'button:not([type="button"]):not([type="reset"])',
    ];
    for (const sel of selectors) {
      const el = container.querySelector(sel) as HTMLElement;
      if (el) return el;
    }
    const buttons = container.querySelectorAll('button, [role="button"]');
    const loginTerms = /log\s*in|sign\s*in|submit|enter|continue/i;
    for (const btn of buttons) {
      if (loginTerms.test(btn.textContent || '')) return btn as HTMLElement;
    }
    return null;
  }

  // -- main logic --

  const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement | null;

  if (!passwordInput) {
    return { isLogin: false, usernameSelector: null, passwordSelector: null, submitSelector: null };
  }

  const passwordSelector = _buildSelector(passwordInput);
  const usernameEl = _findUsernameInput(passwordInput);
  const usernameSelector = usernameEl ? _buildSelector(usernameEl) : null;
  const submitEl = _findSubmitButton(passwordInput);
  const submitSelector = submitEl ? _buildSelector(submitEl) : null;

  return { isLogin: true, usernameSelector, passwordSelector, submitSelector };
}

/**
 * Fills login credentials (without submitting).
 * Split from submit so React can process state updates before click.
 * Injected via chrome.scripting.executeScript.
 *
 * Uses React's _valueTracker reset trick to ensure controlled components
 * fire onChange even when the value is set programmatically.
 */
function performFillCredentials(
  username: string,
  password: string,
  usernameSel: string | null,
  passwordSel: string | null,
): { filled: boolean; error?: string; usernameVerified?: boolean; passwordVerified?: boolean } {
  // -- inline helpers (must be inside injected function) --

  function _fillInput(el: HTMLInputElement, value: string): void {
    // Focus the element first (some frameworks only listen when focused)
    el.focus();
    el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    // Reset React's internal value tracker so onChange fires.
    // React 16+ attaches _valueTracker to controlled inputs. When an input
    // event fires, React checks tracker.getValue() !== currentValue.
    // If they match (because the native setter already updated the DOM),
    // React suppresses onChange entirely. Resetting the tracker forces
    // React to see a difference and fire the handler.
    const tracker = (el as unknown as Record<string, unknown>)._valueTracker as
      { setValue: (v: string) => void } | undefined;
    if (tracker) {
      tracker.setValue('');
    }

    // Use the native setter to bypass React's synthetic event system
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype, 'value',
    )?.set;
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, value);
    } else {
      el.value = value;
    }

    // Dispatch InputEvent (not plain Event) — this is what browsers fire for
    // real keyboard input. React's onChange listens for this.
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: value,
    }));
    el.dispatchEvent(new Event('change', { bubbles: true }));

    // Blur to trigger validation and ensure React processes the final value
    el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  }

  function _findUsernameInput(): HTMLInputElement | null {
    const selectors = [
      'input[type="email"]', 'input[name="email"]', 'input[name="username"]',
      'input[name="user"]', 'input[autocomplete="email"]', 'input[autocomplete="username"]',
      'input[id*="email" i]', 'input[id*="user" i]',
      'input[placeholder*="email" i]', 'input[placeholder*="user" i]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel) as HTMLInputElement;
      if (el && el.type !== 'password' && el.type !== 'hidden') return el;
    }
    const passwordInput = document.querySelector('input[type="password"]');
    if (passwordInput) {
      const form = passwordInput.closest('form') || document.body;
      const inputs = form.querySelectorAll('input:not([type="hidden"]):not([type="password"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"])');
      if (inputs.length > 0) return inputs[0] as HTMLInputElement;
    }
    return null;
  }

  // -- main logic --

  try {
    const usernameEl = usernameSel
      ? (document.querySelector(usernameSel) as HTMLInputElement)
      : _findUsernameInput();

    if (!usernameEl) {
      return { filled: false, error: 'Username input not found' };
    }

    const passwordEl = passwordSel
      ? (document.querySelector(passwordSel) as HTMLInputElement)
      : (document.querySelector('input[type="password"]') as HTMLInputElement);

    if (!passwordEl) {
      return { filled: false, error: 'Password input not found' };
    }

    _fillInput(usernameEl, username);
    _fillInput(passwordEl, password);

    // Verify the DOM values are actually set (read back)
    const usernameVerified = usernameEl.value === username;
    const passwordVerified = passwordEl.value === password;

    return { filled: true, usernameVerified, passwordVerified };
  } catch (err) {
    return { filled: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Polls until the login form is ready for submission:
 * - Input fields have non-empty values (React state has processed)
 * - Submit button is not disabled
 *
 * Injected via chrome.scripting.executeScript.
 * Returns a promise that resolves when ready or on timeout.
 */
function performVerifyFormReady(
  usernameSel: string | null,
  passwordSel: string | null,
  submitSel: string | null,
  timeoutMs: number,
): Promise<{
  ready: boolean;
  reason: string;
  buttonDisabled?: boolean;
  usernameEmpty?: boolean;
  passwordEmpty?: boolean;
}> {
  return new Promise((resolve) => {
    const start = Date.now();

    const poll = (): void => {
      const usernameEl = usernameSel
        ? (document.querySelector(usernameSel) as HTMLInputElement)
        : (document.querySelector('input[type="email"], input[name="email"], input[name="username"]') as HTMLInputElement);
      const passwordEl = passwordSel
        ? (document.querySelector(passwordSel) as HTMLInputElement)
        : (document.querySelector('input[type="password"]') as HTMLInputElement);
      const submitEl = submitSel
        ? (document.querySelector(submitSel) as HTMLButtonElement)
        : (document.querySelector('button[type="submit"]') as HTMLButtonElement);

      const usernameHasValue = usernameEl != null && usernameEl.value.length > 0;
      const passwordHasValue = passwordEl != null && passwordEl.value.length > 0;
      const buttonEnabled = submitEl != null && !submitEl.disabled;

      if (usernameHasValue && passwordHasValue && buttonEnabled) {
        resolve({ ready: true, reason: 'all_ready' });
        return;
      }

      if (Date.now() - start >= timeoutMs) {
        resolve({
          ready: false,
          reason: 'timeout',
          buttonDisabled: submitEl ? submitEl.disabled : true,
          usernameEmpty: !usernameHasValue,
          passwordEmpty: !passwordHasValue,
        });
        return;
      }

      setTimeout(poll, 50);
    };

    poll();
  });
}

/**
 * Clicks the submit button on the login form.
 * Injected via chrome.scripting.executeScript after readiness verification.
 *
 * Uses a full pointer/mouse event sequence that works with UI frameworks
 * like shadcn, Radix, and MUI. Does NOT also call form.requestSubmit()
 * to avoid double-submission — for a submit button inside a form, the
 * click event already triggers the form's onSubmit handler.
 */
function performClickSubmit(
  submitSel: string | null,
): { clicked: boolean; method?: string; error?: string } {
  // -- inline helpers (must be inside injected function) --

  function _findSubmitButton(nearElement: HTMLElement): HTMLElement | null {
    const form = nearElement.closest('form');
    const container = form || document.body;
    const selectors = [
      'button[type="submit"]', 'input[type="submit"]',
      'button:not([type="button"]):not([type="reset"])',
    ];
    for (const sel of selectors) {
      const el = container.querySelector(sel) as HTMLElement;
      if (el) return el;
    }
    const buttons = container.querySelectorAll('button, [role="button"]');
    const loginTerms = /log\s*in|sign\s*in|submit|enter|continue/i;
    for (const btn of buttons) {
      if (loginTerms.test(btn.textContent || '')) return btn as HTMLElement;
    }
    return null;
  }

  /** Simulate a full user-like click sequence (pointer + mouse + click). */
  function _simulateClick(el: HTMLElement): void {
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const opts: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
    };

    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
  }

  try {
    const passwordEl = document.querySelector('input[type="password"]') as HTMLElement;

    const submitEl = submitSel
      ? (document.querySelector(submitSel) as HTMLElement)
      : (passwordEl ? _findSubmitButton(passwordEl) : null);

    if (submitEl) {
      // Force-enable if disabled (React may not have re-enabled after state update)
      if ((submitEl as HTMLButtonElement).disabled) {
        (submitEl as HTMLButtonElement).disabled = false;
      }

      // Full pointer/mouse event sequence — this triggers form onSubmit
      // for submit buttons. Do NOT also call requestSubmit(), which would
      // fire a second submit event and cause double-submission.
      _simulateClick(submitEl);

      return { clicked: true, method: 'simulateClick' };
    }

    // Fallback: no submit button found, try form.requestSubmit directly
    const form = passwordEl?.closest('form');
    if (form) {
      form.requestSubmit();
      return { clicked: true, method: 'formRequestSubmit' };
    }

    return { clicked: false, error: 'Submit button not found' };
  } catch (err) {
    return { clicked: false, error: err instanceof Error ? err.message : String(err) };
  }
}
