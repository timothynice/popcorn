/**
 * Tests for the AuthManager class.
 * Verifies settings persistence, login page detection, and auto-login flow.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthManager } from '../background/auth-manager.js';
import type { AuthSettings } from '../background/auth-manager.js';

// -- Chrome mock --
const chromeMock = {
  storage: {
    local: {
      get: vi.fn(() => Promise.resolve({})),
      set: vi.fn(() => Promise.resolve()),
    },
  },
  tabs: {
    get: vi.fn(() => Promise.resolve({ url: 'http://localhost:3000/login' })),
  },
  scripting: {
    executeScript: vi.fn(() => Promise.resolve([{
      result: {
        isLogin: true,
        usernameSelector: 'input[type="email"]',
        passwordSelector: 'input[type="password"]',
        submitSelector: 'button[type="submit"]',
      },
    }])),
  },
};

vi.stubGlobal('chrome', chromeMock);

describe('AuthManager', () => {
  let authManager: AuthManager;

  beforeEach(() => {
    vi.clearAllMocks();
    authManager = new AuthManager();
  });

  describe('getSettings', () => {
    it('returns default settings when nothing stored', async () => {
      chromeMock.storage.local.get.mockResolvedValueOnce({});

      const settings = await authManager.getSettings();

      expect(settings.enabled).toBe(false);
      expect(settings.username).toBe('');
      expect(settings.password).toBe('');
      expect(settings.loginPatterns).toContain('/login');
      expect(settings.loginPatterns).toContain('/signin');
      expect(settings.loginPatterns).toContain('/auth');
    });

    it('returns stored settings when available', async () => {
      const stored: AuthSettings = {
        enabled: true,
        username: 'test@example.com',
        password: 'testpass',
        loginPatterns: ['/login', '/custom-auth'],
      };

      chromeMock.storage.local.get.mockResolvedValueOnce({
        popcorn_auth_settings: stored,
      });

      const settings = await authManager.getSettings();

      expect(settings.enabled).toBe(true);
      expect(settings.username).toBe('test@example.com');
      expect(settings.password).toBe('testpass');
      expect(settings.loginPatterns).toEqual(['/login', '/custom-auth']);
    });

    it('merges stored settings with defaults', async () => {
      chromeMock.storage.local.get.mockResolvedValueOnce({
        popcorn_auth_settings: { enabled: true, username: 'user' },
      });

      const settings = await authManager.getSettings();

      expect(settings.enabled).toBe(true);
      expect(settings.username).toBe('user');
      // Default values should fill in missing fields
      expect(settings.password).toBe('');
      expect(settings.loginPatterns.length).toBeGreaterThan(0);
    });
  });

  describe('saveSettings', () => {
    it('saves merged settings to chrome.storage.local', async () => {
      chromeMock.storage.local.get.mockResolvedValueOnce({});

      await authManager.saveSettings({ enabled: true, username: 'newuser' });

      expect(chromeMock.storage.local.set).toHaveBeenCalledWith({
        popcorn_auth_settings: expect.objectContaining({
          enabled: true,
          username: 'newuser',
        }),
      });
    });
  });

  describe('isLoginPage', () => {
    it('detects login page by URL pattern and DOM', async () => {
      chromeMock.tabs.get.mockResolvedValueOnce({ url: 'http://localhost:3000/login' });
      chromeMock.scripting.executeScript.mockResolvedValueOnce([{
        result: {
          isLogin: true,
          usernameSelector: 'input[type="email"]',
          passwordSelector: 'input[type="password"]',
          submitSelector: 'button[type="submit"]',
        },
      }]);

      // Need to set up stored settings with loginPatterns
      chromeMock.storage.local.get.mockResolvedValueOnce({
        popcorn_auth_settings: {
          enabled: true,
          username: 'test',
          password: 'pass',
          loginPatterns: ['/login'],
        },
      });

      const result = await authManager.isLoginPage(1);

      expect(result.isLogin).toBe(true);
      expect(result.passwordSelector).toBe('input[type="password"]');
    });

    it('returns false for non-login pages', async () => {
      chromeMock.tabs.get.mockResolvedValueOnce({ url: 'http://localhost:3000/dashboard' });
      chromeMock.scripting.executeScript.mockResolvedValueOnce([{
        result: {
          isLogin: false,
          usernameSelector: null,
          passwordSelector: null,
          submitSelector: null,
        },
      }]);
      chromeMock.storage.local.get.mockResolvedValueOnce({
        popcorn_auth_settings: {
          enabled: true,
          username: 'test',
          password: 'pass',
          loginPatterns: ['/login'],
        },
      });

      const result = await authManager.isLoginPage(1);

      expect(result.isLogin).toBe(false);
    });

    it('handles script injection failure gracefully', async () => {
      chromeMock.tabs.get.mockResolvedValueOnce({ url: 'chrome://extensions' });
      chromeMock.scripting.executeScript.mockRejectedValueOnce(new Error('Cannot inject'));
      chromeMock.storage.local.get.mockResolvedValueOnce({});

      const result = await authManager.isLoginPage(1);

      expect(result.isLogin).toBe(false);
    });
  });

  describe('autoLogin', () => {
    it('returns error when auth not configured', async () => {
      chromeMock.storage.local.get.mockResolvedValueOnce({});

      const result = await authManager.autoLogin(1);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Auth not configured');
    });

    it('succeeds when not on a login page', async () => {
      // First call: getSettings
      chromeMock.storage.local.get.mockResolvedValueOnce({
        popcorn_auth_settings: {
          enabled: true,
          username: 'test',
          password: 'pass',
          loginPatterns: ['/login'],
        },
      });
      // Second call: isLoginPage -> getSettings
      chromeMock.storage.local.get.mockResolvedValueOnce({
        popcorn_auth_settings: {
          enabled: true,
          username: 'test',
          password: 'pass',
          loginPatterns: ['/login'],
        },
      });

      chromeMock.tabs.get.mockResolvedValue({ url: 'http://localhost:3000/dashboard' });
      chromeMock.scripting.executeScript.mockResolvedValueOnce([{
        result: {
          isLogin: false,
          usernameSelector: null,
          passwordSelector: null,
          submitSelector: null,
        },
      }]);

      const result = await authManager.autoLogin(1);

      expect(result.success).toBe(true);
      expect(result.finalUrl).toBe('http://localhost:3000/dashboard');
    });

    it('fills credentials and clicks submit on login page', async () => {
      const authSettings = {
        enabled: true,
        username: 'test@example.com',
        password: 'pass123',
        loginPatterns: ['/login'],
      };

      // getSettings (autoLogin)
      chromeMock.storage.local.get.mockResolvedValueOnce({
        popcorn_auth_settings: authSettings,
      });
      // getSettings (isLoginPage)
      chromeMock.storage.local.get.mockResolvedValueOnce({
        popcorn_auth_settings: authSettings,
      });

      // Tab starts on login page
      chromeMock.tabs.get.mockResolvedValue({ url: 'http://localhost:3000/login' });

      // Call sequence for executeScript:
      // 1. detectLoginFormElements (isLoginPage)
      // 2. performFillCredentials
      // 3. performVerifyFormReady
      // 4. performClickSubmit
      // 5+ waitForLoginRedirect polls (password field check)
      chromeMock.scripting.executeScript
        // 1. detectLoginFormElements
        .mockResolvedValueOnce([{
          result: {
            isLogin: true,
            usernameSelector: '#email',
            passwordSelector: '#password',
            submitSelector: 'button[type="submit"]',
          },
        }])
        // 2. performFillCredentials
        .mockResolvedValueOnce([{
          result: { filled: true, usernameVerified: true, passwordVerified: true },
        }])
        // 3. performVerifyFormReady
        .mockResolvedValueOnce([{
          result: { ready: true, reason: 'all_ready' },
        }])
        // 4. performClickSubmit
        .mockResolvedValueOnce([{
          result: { clicked: true, method: 'simulateClick' },
        }])
        // 5. waitForLoginRedirect: password field check (still present)
        .mockResolvedValueOnce([{ result: false }]);

      // After submit, URL changes on second poll
      chromeMock.tabs.get
        .mockResolvedValueOnce({ url: 'http://localhost:3000/login' }) // isLoginPage
        .mockResolvedValueOnce({ url: 'http://localhost:3000/login' }) // autoLogin not-on-login check (unused, tabs.get returns login)
        .mockResolvedValueOnce({ url: 'http://localhost:3000/dashboard' }); // redirect poll

      const result = await authManager.autoLogin(1);

      expect(result.success).toBe(true);
      expect(result.finalUrl).toBe('http://localhost:3000/dashboard');

      // Verify executeScript was called for fill, readiness, and submit
      const executeScriptCalls = chromeMock.scripting.executeScript.mock.calls;
      expect(executeScriptCalls.length).toBeGreaterThanOrEqual(4);
    });

    it('returns error when fill fails', async () => {
      const authSettings = {
        enabled: true,
        username: 'test@example.com',
        password: 'pass123',
        loginPatterns: ['/login'],
      };

      chromeMock.storage.local.get.mockResolvedValueOnce({
        popcorn_auth_settings: authSettings,
      });
      chromeMock.storage.local.get.mockResolvedValueOnce({
        popcorn_auth_settings: authSettings,
      });

      chromeMock.tabs.get.mockResolvedValue({ url: 'http://localhost:3000/login' });

      chromeMock.scripting.executeScript
        // detectLoginFormElements
        .mockResolvedValueOnce([{
          result: {
            isLogin: true,
            usernameSelector: '#email',
            passwordSelector: '#password',
            submitSelector: 'button[type="submit"]',
          },
        }])
        // performFillCredentials — fails
        .mockResolvedValueOnce([{
          result: { filled: false, error: 'Username input not found' },
        }]);

      const result = await authManager.autoLogin(1);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Username input not found');
    });
  });
});
