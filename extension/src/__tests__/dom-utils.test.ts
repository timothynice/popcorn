/**
 * Tests for DOM utilities: stability detection, actionability checks, modal detection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  waitForDomStability,
  checkActionability,
  detectModalOrDialog,
} from '../content/dom-utils.js';

describe('dom-utils', () => {
  describe('waitForDomStability', () => {
    it('resolves true when DOM is already stable', async () => {
      const result = await waitForDomStability(1000, 50);
      expect(result).toBe(true);
    });

    it('resolves true after DOM stops mutating', async () => {
      // Start mutating then stop
      const interval = setInterval(() => {
        const el = document.createElement('span');
        document.body.appendChild(el);
      }, 10);

      // Stop after 100ms
      setTimeout(() => clearInterval(interval), 100);

      const result = await waitForDomStability(2000, 200);
      expect(result).toBe(true);
    });

    it('resolves false when DOM keeps mutating beyond timeout', async () => {
      // Continuously mutate DOM
      const interval = setInterval(() => {
        const el = document.createElement('span');
        document.body.appendChild(el);
      }, 10);

      const result = await waitForDomStability(200, 150);
      clearInterval(interval);
      expect(result).toBe(false);
    });
  });

  describe('checkActionability', () => {
    beforeEach(() => {
      document.body.innerHTML = '';
    });

    it('returns actionable for a visible enabled button', async () => {
      const btn = document.createElement('button');
      btn.id = 'test-btn';
      btn.textContent = 'Click me';
      document.body.appendChild(btn);

      // jsdom doesn't calculate layout, so offsetWidth/Height are 0
      // We need to mock these
      Object.defineProperty(btn, 'offsetWidth', { value: 100, configurable: true });
      Object.defineProperty(btn, 'offsetHeight', { value: 40, configurable: true });

      // Mock getBoundingClientRect for stability check
      btn.getBoundingClientRect = vi.fn(() => ({
        left: 10, top: 10, width: 100, height: 40,
        right: 110, bottom: 50, x: 10, y: 10, toJSON: () => {},
      }));

      // Mock elementFromPoint to return the button itself
      document.elementFromPoint = vi.fn(() => btn) as any;

      // Mock requestAnimationFrame
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        setTimeout(() => cb(0), 0);
        return 0;
      });

      const result = await checkActionability('#test-btn');
      expect(result.actionable).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('returns not_found for missing element', async () => {
      const result = await checkActionability('#nonexistent');
      expect(result.actionable).toBe(false);
      expect(result.reason).toBe('not_found');
    });

    it('returns hidden for zero-dimension element', async () => {
      const btn = document.createElement('button');
      btn.id = 'hidden-btn';
      document.body.appendChild(btn);
      // offsetWidth/Height default to 0 in jsdom

      const result = await checkActionability('#hidden-btn');
      expect(result.actionable).toBe(false);
      expect(result.reason).toBe('hidden');
    });

    it('returns disabled for disabled button', async () => {
      const btn = document.createElement('button');
      btn.id = 'disabled-btn';
      btn.disabled = true;
      document.body.appendChild(btn);

      Object.defineProperty(btn, 'offsetWidth', { value: 100, configurable: true });
      Object.defineProperty(btn, 'offsetHeight', { value: 40, configurable: true });

      const result = await checkActionability('#disabled-btn');
      expect(result.actionable).toBe(false);
      expect(result.reason).toBe('disabled');
    });

    it('returns disabled for aria-disabled element', async () => {
      const btn = document.createElement('button');
      btn.id = 'aria-disabled-btn';
      btn.setAttribute('aria-disabled', 'true');
      document.body.appendChild(btn);

      Object.defineProperty(btn, 'offsetWidth', { value: 100, configurable: true });
      Object.defineProperty(btn, 'offsetHeight', { value: 40, configurable: true });

      const result = await checkActionability('#aria-disabled-btn');
      expect(result.actionable).toBe(false);
      expect(result.reason).toBe('disabled');
    });

    it('tries fallback selector when primary not found', async () => {
      const btn = document.createElement('button');
      btn.className = 'fallback-btn';
      btn.textContent = 'Fallback';
      document.body.appendChild(btn);

      Object.defineProperty(btn, 'offsetWidth', { value: 100, configurable: true });
      Object.defineProperty(btn, 'offsetHeight', { value: 40, configurable: true });

      btn.getBoundingClientRect = vi.fn(() => ({
        left: 10, top: 10, width: 100, height: 40,
        right: 110, bottom: 50, x: 10, y: 10, toJSON: () => {},
      }));
      document.elementFromPoint = vi.fn(() => btn) as any;
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        setTimeout(() => cb(0), 0);
        return 0;
      });

      const result = await checkActionability('#nonexistent', '.fallback-btn');
      expect(result.actionable).toBe(true);
    });
  });

  describe('detectModalOrDialog', () => {
    beforeEach(() => {
      document.body.innerHTML = '';
    });

    it('returns null when no modal is present', () => {
      document.body.innerHTML = '<p>Normal content</p>';
      const result = detectModalOrDialog();
      expect(result).toBeNull();
    });

    it('detects an open dialog element', () => {
      const dialog = document.createElement('dialog');
      dialog.setAttribute('open', '');
      dialog.innerHTML = '<p>Dialog content</p><button aria-label="Close">X</button>';
      document.body.appendChild(dialog);

      Object.defineProperty(dialog, 'offsetWidth', { value: 300, configurable: true });
      Object.defineProperty(dialog, 'offsetHeight', { value: 200, configurable: true });

      const result = detectModalOrDialog();
      expect(result).not.toBeNull();
      expect(result!.type).toBe('dialog');
      expect(result!.selector).toBe('dialog[open]');
    });

    it('detects element with role="dialog"', () => {
      const modal = document.createElement('div');
      modal.setAttribute('role', 'dialog');
      modal.innerHTML = '<button class="modal-close">X</button>';
      document.body.appendChild(modal);

      Object.defineProperty(modal, 'offsetWidth', { value: 400, configurable: true });
      Object.defineProperty(modal, 'offsetHeight', { value: 300, configurable: true });

      const result = detectModalOrDialog();
      expect(result).not.toBeNull();
      expect(result!.type).toBe('dialog');
      expect(result!.selector).toBe('[role="dialog"]');
    });

    it('finds dismiss button with aria-label close', () => {
      const dialog = document.createElement('dialog');
      dialog.setAttribute('open', '');
      const closeBtn = document.createElement('button');
      closeBtn.setAttribute('aria-label', 'Close dialog');
      closeBtn.id = 'close-btn';
      dialog.appendChild(closeBtn);
      document.body.appendChild(dialog);

      Object.defineProperty(dialog, 'offsetWidth', { value: 300, configurable: true });
      Object.defineProperty(dialog, 'offsetHeight', { value: 200, configurable: true });
      Object.defineProperty(closeBtn, 'offsetWidth', { value: 30, configurable: true });
      Object.defineProperty(closeBtn, 'offsetHeight', { value: 30, configurable: true });

      const result = detectModalOrDialog();
      expect(result).not.toBeNull();
      expect(result!.dismissSelector).toBe('#close-btn');
    });
  });
});
