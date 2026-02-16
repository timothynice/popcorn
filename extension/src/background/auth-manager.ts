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
   * Uses the content script (injected via files: ['content.js']) to fill and
   * click, because it runs in the same execution context as the page's React
   * handlers. Previous attempts using chrome.scripting.executeScript with
   * inline functions failed because dispatched events (even with world: 'MAIN')
   * didn't reliably trigger React's synthetic event system.
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

    // Ensure the content script is loaded so we can use its fill/click actions
    console.log('[Popcorn] Auto-login: injecting content script');
    await this.ensureContentScriptLoaded(tabId);

    // Build selectors — prefer detected ones, fall back to generic
    const usernameSel = loginCheck.usernameSelector || 'input[type="email"]';
    const passwordSel = loginCheck.passwordSelector || 'input[type="password"]';
    const submitSel = loginCheck.submitSelector || 'button[type="submit"]';

    // Step 1: Fill username via content script
    console.log('[Popcorn] Auto-login step 1: filling username');
    try {
      const fillUsernameResult = await chrome.tabs.sendMessage(tabId, {
        type: 'execute_plan',
        payload: {
          steps: [{
            stepNumber: 1,
            action: 'fill' as const,
            selector: usernameSel,
            value: settings.username,
            description: 'Fill username',
          }],
        },
      });
      console.log('[Popcorn] Username fill result:', JSON.stringify(fillUsernameResult?.results?.[0]?.passed));
    } catch (err) {
      console.warn('[Popcorn] Username fill failed:', err);
    }

    // Step 2: Fill password via content script
    console.log('[Popcorn] Auto-login step 2: filling password');
    try {
      const fillPasswordResult = await chrome.tabs.sendMessage(tabId, {
        type: 'execute_plan',
        payload: {
          steps: [{
            stepNumber: 2,
            action: 'fill' as const,
            selector: passwordSel,
            value: settings.password,
            description: 'Fill password',
          }],
        },
      });
      console.log('[Popcorn] Password fill result:', JSON.stringify(fillPasswordResult?.results?.[0]?.passed));
    } catch (err) {
      console.warn('[Popcorn] Password fill failed:', err);
    }

    // Step 3: Small delay for React state to process, then click submit
    await new Promise((resolve) => setTimeout(resolve, 300));
    console.log('[Popcorn] Auto-login step 3: clicking submit');
    try {
      const clickResult = await chrome.tabs.sendMessage(tabId, {
        type: 'execute_plan',
        payload: {
          steps: [{
            stepNumber: 3,
            action: 'click' as const,
            selector: submitSel,
            description: 'Click submit',
          }],
        },
      });
      console.log('[Popcorn] Submit click result:', JSON.stringify(clickResult?.results?.[0]?.passed));
    } catch (err) {
      console.warn('[Popcorn] Submit click failed:', err);
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
   * Ensures the content script is loaded in the given tab.
   * Pings first to avoid re-injection errors.
   */
  private async ensureContentScriptLoaded(tabId: number): Promise<void> {
    try {
      const ping = await chrome.tabs.sendMessage(tabId, { type: 'ping' });
      if (ping?.pong) return;
    } catch {
      // Content script not loaded
    }
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
    await new Promise((r) => setTimeout(r, 200));
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
