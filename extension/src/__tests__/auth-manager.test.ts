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
    sendMessage: vi.fn(() => Promise.resolve({ results: [{ passed: true }] })),
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
      chromeMock.storage.local.get.mockResolvedValueOnce({
        popcorn_auth_settings: {
          enabled: true,
          username: 'test',
          password: 'pass',
          loginPatterns: ['/login'],
        },
      });
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

    it('uses content script to fill and click on login page', async () => {
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

      // Tab starts on login page, then redirects
      chromeMock.tabs.get
        .mockResolvedValueOnce({ url: 'http://localhost:3000/login' }) // isLoginPage
        .mockResolvedValue({ url: 'http://localhost:3000/dashboard' }); // redirect detected

      // detectLoginFormElements
      chromeMock.scripting.executeScript.mockResolvedValueOnce([{
        result: {
          isLogin: true,
          usernameSelector: '#email',
          passwordSelector: '#password',
          submitSelector: 'button[type="submit"]',
        },
      }]);

      // Content script ping (not loaded) — triggers injection
      chromeMock.tabs.sendMessage
        .mockRejectedValueOnce(new Error('No content script')) // ping fails
        .mockResolvedValueOnce({ results: [{ passed: true }] }) // fill username
        .mockResolvedValueOnce({ results: [{ passed: true }] }) // fill password
        .mockResolvedValueOnce({ results: [{ passed: true }] }); // click submit

      // Content script injection
      chromeMock.scripting.executeScript.mockResolvedValueOnce([{}]);

      const result = await authManager.autoLogin(1);

      expect(result.success).toBe(true);
      expect(result.finalUrl).toBe('http://localhost:3000/dashboard');

      // Verify sendMessage was called for fill and click
      const sendMessageCalls = chromeMock.tabs.sendMessage.mock.calls;
      // ping + fill username + fill password + click submit = 4 calls
      expect(sendMessageCalls.length).toBe(4);

      // Verify fill username
      const fillUserMsg = sendMessageCalls[1][1];
      expect(fillUserMsg.type).toBe('execute_plan');
      expect(fillUserMsg.payload.steps[0].action).toBe('fill');
      expect(fillUserMsg.payload.steps[0].value).toBe('test@example.com');

      // Verify fill password
      const fillPassMsg = sendMessageCalls[2][1];
      expect(fillPassMsg.payload.steps[0].action).toBe('fill');

      // Verify click
      const clickMsg = sendMessageCalls[3][1];
      expect(clickMsg.payload.steps[0].action).toBe('click');
      expect(clickMsg.payload.steps[0].selector).toBe('button[type="submit"]');
    });

    it('returns error when fill fails', { timeout: 15000 }, async () => {
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

      // Stays on login page (fill/click fails)
      chromeMock.tabs.get.mockResolvedValue({ url: 'http://localhost:3000/login' });

      // detectLoginFormElements
      chromeMock.scripting.executeScript
        .mockResolvedValueOnce([{
          result: {
            isLogin: true,
            usernameSelector: '#email',
            passwordSelector: '#password',
            submitSelector: 'button[type="submit"]',
          },
        }])
        // content script injection
        .mockResolvedValueOnce([{}])
        // password field check (still present during redirect poll)
        .mockResolvedValue([{ result: false }]);

      // Content script ping succeeds (already loaded)
      chromeMock.tabs.sendMessage
        .mockResolvedValueOnce({ pong: true }) // ping
        .mockRejectedValueOnce(new Error('Element not found')) // fill fails
        .mockResolvedValueOnce({ results: [{ passed: true }] }) // fill password
        .mockResolvedValueOnce({ results: [{ passed: true }] }); // click

      const result = await authManager.autoLogin(1);

      // Still times out because login didn't actually work
      expect(result.success).toBe(false);
      expect(result.error).toBe('Timed out waiting for login redirect');
    });
  });
});
