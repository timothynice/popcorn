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
        world: 'MAIN',
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
   *
   * Uses a <script> tag injection strategy to guarantee MAIN world execution:
   * 1. executeScript (ISOLATED world) injects a <script> element into the DOM
   * 2. The <script> tag runs in the MAIN world (it's a page script)
   * 3. The script uses React's internal nativeInputValueSetter to update
   *    controlled input values and trigger real React onChange handlers
   * 4. Results are communicated via window.__popcornLoginResult (shared DOM)
   *
   * This approach is necessary because:
   * - chrome.scripting.executeScript with world:'MAIN' has been unreliable
   * - Content scripts run in ISOLATED world and can't trigger React handlers
   * - Inline <script> tags are guaranteed to execute in the page's JS context
   */
  async autoLogin(tabId: number): Promise<AutoLoginResult> {
    const settings = await this.getSettings();

    if (!settings.enabled || !settings.username || !settings.password) {
      return { success: false, finalUrl: '', error: 'Auth not configured' };
    }

    const loginCheck = await this.isLoginPage(tabId);
    if (!loginCheck.isLogin) {
      const tab = await chrome.tabs.get(tabId);
      return { success: true, finalUrl: tab.url || '' };
    }

    const usernameSel = loginCheck.usernameSelector || 'input[type="email"]';
    const passwordSel = loginCheck.passwordSelector || 'input[type="password"]';
    const submitSel = loginCheck.submitSelector || 'button[type="submit"]';

    // Inject a <script> tag into the page DOM — guaranteed MAIN world execution
    console.log('[Popcorn] Auto-login: injecting <script> tag for MAIN world fill+submit');
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: injectLoginScript,
        args: [
          settings.username,
          settings.password,
          usernameSel,
          passwordSel,
          submitSel,
        ],
      });
    } catch (err) {
      console.warn('[Popcorn] Script injection failed:', err);
    }

    // Wait for the injected script to finish (it sets window.__popcornLoginResult)
    // Poll for up to 5 seconds
    let loginResult: { success: boolean; phase: string; error?: string } | null = null;
    const pollStart = Date.now();
    while (Date.now() - pollStart < 5000) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            const raw = document.documentElement.getAttribute('data-popcorn-login-result');
            if (raw) {
              document.documentElement.removeAttribute('data-popcorn-login-result');
              try { return JSON.parse(raw); } catch { return null; }
            }
            return null;
          },
        });
        if (results?.[0]?.result) {
          loginResult = results[0].result as { success: boolean; phase: string; error?: string };
          break;
        }
      } catch {
        // continue polling
      }
    }

    console.log('[Popcorn] Login script result:', JSON.stringify(loginResult));
    if (!loginResult?.success) {
      console.warn('[Popcorn] Login script failed at phase:', loginResult?.phase, loginResult?.error);
    }

    // Wait for navigation away from login page (poll up to 10s)
    console.log('[Popcorn] Auto-login: waiting for redirect');
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
            world: 'MAIN',
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

// ---- Injected functions (serialized by chrome.scripting.executeScript) ----
// IMPORTANT: These functions CANNOT reference any other functions or variables
// from this module — all helpers must be inlined.

/**
 * Injected into ISOLATED world. Creates a <script> tag that runs in MAIN world.
 * The script fills inputs using React's nativeInputValueSetter (bypasses
 * controlled component checks), dispatches real events, and submits the form.
 *
 * This is the nuclear option: <script> tags always run in the page's JS context,
 * unlike executeScript which has been unreliable with world:'MAIN'.
 */
function injectLoginScript(
  username: string,
  password: string,
  usernameSel: string,
  passwordSel: string,
  submitSel: string,
): void {
  const script = document.createElement('script');
  script.textContent = `
(async function __popcornLogin() {
  const LOG = (msg) => console.log('[Popcorn MAIN]', msg);
  const result = { success: false, phase: 'init', error: '' };

  try {
    // Find the input elements
    const usernameEl = document.querySelector(${JSON.stringify(usernameSel)});
    const passwordEl = document.querySelector(${JSON.stringify(passwordSel)});
    const submitEl = document.querySelector(${JSON.stringify(submitSel)});

    LOG('Elements found: username=' + !!usernameEl + ' password=' + !!passwordEl + ' submit=' + !!submitEl);

    if (!usernameEl || !passwordEl) {
      result.phase = 'find_inputs';
      result.error = 'Could not find username or password input';
      document.documentElement.setAttribute('data-popcorn-login-result', JSON.stringify(result));
      return;
    }

    // Get React's native setter — this bypasses controlled component value tracking
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype, 'value'
    )?.set;

    if (!nativeInputValueSetter) {
      result.phase = 'native_setter';
      result.error = 'Could not get native input value setter';
      document.documentElement.setAttribute('data-popcorn-login-result', JSON.stringify(result));
      return;
    }

    // Fill username
    usernameEl.focus();
    nativeInputValueSetter.call(usernameEl, ${JSON.stringify(username)});
    usernameEl.dispatchEvent(new Event('input', { bubbles: true }));
    usernameEl.dispatchEvent(new Event('change', { bubbles: true }));
    LOG('Username filled: ' + usernameEl.value);

    // Small delay for React state update
    await new Promise(r => setTimeout(r, 100));

    // Fill password
    passwordEl.focus();
    nativeInputValueSetter.call(passwordEl, ${JSON.stringify(password)});
    passwordEl.dispatchEvent(new Event('input', { bubbles: true }));
    passwordEl.dispatchEvent(new Event('change', { bubbles: true }));
    LOG('Password filled: ' + passwordEl.value);

    // Wait for React to process state updates
    await new Promise(r => setTimeout(r, 200));

    // Verify values stuck
    LOG('Verify - username: "' + usernameEl.value + '" password length: ' + passwordEl.value.length);

    if (!usernameEl.value || !passwordEl.value) {
      result.phase = 'verify_fill';
      result.error = 'Values did not persist after fill';
      document.documentElement.setAttribute('data-popcorn-login-result', JSON.stringify(result));
      return;
    }

    // Submit: try form.submit events first, then click
    const form = submitEl?.closest('form') || usernameEl.closest('form');
    if (form) {
      LOG('Found form, dispatching submit event');
      const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
      form.dispatchEvent(submitEvent);
    }

    // Also click the submit button as backup
    if (submitEl) {
      await new Promise(r => setTimeout(r, 100));
      LOG('Clicking submit button');
      submitEl.click();
    }

    result.success = true;
    result.phase = 'complete';
    LOG('Login script complete');
  } catch (err) {
    result.phase = 'exception';
    result.error = String(err);
    LOG('Error: ' + err);
  }

  window.__popcornLoginResult = result;
})();
`;
  document.documentElement.appendChild(script);
  // Clean up the script tag
  script.remove();
}

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
