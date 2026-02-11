import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadTestPlan, listTestPlans } from '../plan-loader.js';

describe('plan-loader', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'popcorn-plans-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('loadTestPlan', () => {
    it('loads a valid test plan JSON', async () => {
      const plan = {
        planName: 'login-flow',
        description: 'Test login',
        baseUrl: '/',
        steps: [
          { stepNumber: 1, action: 'navigate', target: '/login', description: 'Go to login' },
          { stepNumber: 2, action: 'click', selector: '#btn', description: 'Click button' },
        ],
        tags: ['auth'],
      };

      fs.writeFileSync(path.join(tempDir, 'login-flow.json'), JSON.stringify(plan));

      const loaded = await loadTestPlan('login-flow', tempDir);
      expect(loaded.planName).toBe('login-flow');
      expect(loaded.baseUrl).toBe('/');
      expect(loaded.steps).toHaveLength(2);
      expect(loaded.steps[0].action).toBe('navigate');
      expect(loaded.tags).toEqual(['auth']);
    });

    it('loads plan when .json extension is included in the name', async () => {
      const plan = { planName: 'test', baseUrl: '/', steps: [] };
      fs.writeFileSync(path.join(tempDir, 'test.json'), JSON.stringify(plan));

      const loaded = await loadTestPlan('test.json', tempDir);
      expect(loaded.planName).toBe('test');
    });

    it('throws on missing file', async () => {
      await expect(
        loadTestPlan('nonexistent', tempDir),
      ).rejects.toThrow('Test plan not found');
    });

    it('throws on invalid JSON', async () => {
      fs.writeFileSync(path.join(tempDir, 'bad.json'), 'not valid json {{{');

      await expect(
        loadTestPlan('bad', tempDir),
      ).rejects.toThrow('Invalid JSON');
    });

    it('throws on missing planName field', async () => {
      const plan = { baseUrl: '/', steps: [] };
      fs.writeFileSync(path.join(tempDir, 'no-name.json'), JSON.stringify(plan));

      await expect(
        loadTestPlan('no-name', tempDir),
      ).rejects.toThrow("missing required field 'planName'");
    });

    it('throws on missing steps field', async () => {
      const plan = { planName: 'test', baseUrl: '/' };
      fs.writeFileSync(path.join(tempDir, 'no-steps.json'), JSON.stringify(plan));

      await expect(
        loadTestPlan('no-steps', tempDir),
      ).rejects.toThrow("missing required field 'steps'");
    });

    it('throws on missing baseUrl field', async () => {
      const plan = { planName: 'test', steps: [] };
      fs.writeFileSync(path.join(tempDir, 'no-url.json'), JSON.stringify(plan));

      await expect(
        loadTestPlan('no-url', tempDir),
      ).rejects.toThrow("missing required field 'baseUrl'");
    });

    it('throws when steps is not an array', async () => {
      const plan = { planName: 'test', baseUrl: '/', steps: 'not-an-array' };
      fs.writeFileSync(path.join(tempDir, 'bad-steps.json'), JSON.stringify(plan));

      await expect(
        loadTestPlan('bad-steps', tempDir),
      ).rejects.toThrow("missing required field 'steps'");
    });

    it('throws when the file contains a non-object JSON value', async () => {
      fs.writeFileSync(path.join(tempDir, 'array.json'), '[]');

      await expect(
        loadTestPlan('array', tempDir),
      ).rejects.toThrow('must be a JSON object');
    });
  });

  describe('listTestPlans', () => {
    it('lists available plan names without .json extension', async () => {
      fs.writeFileSync(path.join(tempDir, 'alpha.json'), '{}');
      fs.writeFileSync(path.join(tempDir, 'beta.json'), '{}');
      fs.writeFileSync(path.join(tempDir, 'gamma.json'), '{}');
      // Non-JSON files should be excluded
      fs.writeFileSync(path.join(tempDir, 'readme.md'), '# Plans');

      const plans = await listTestPlans(tempDir);
      expect(plans).toEqual(expect.arrayContaining(['alpha', 'beta', 'gamma']));
      expect(plans).toHaveLength(3);
      expect(plans).not.toContain('readme');
    });

    it('returns empty array for nonexistent directory', async () => {
      const plans = await listTestPlans(path.join(tempDir, 'does-not-exist'));
      expect(plans).toEqual([]);
    });

    it('returns empty array for empty directory', async () => {
      const emptyDir = path.join(tempDir, 'empty');
      fs.mkdirSync(emptyDir);

      const plans = await listTestPlans(emptyDir);
      expect(plans).toEqual([]);
    });
  });
});
