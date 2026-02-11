import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StartDemoMessage, TestPlan } from '@popcorn/shared';
import { createMessage } from '@popcorn/shared';
import {
  handleStartDemo,
  getState,
  resetOrchestratorState,
} from '../background/demo-orchestrator.js';

// Mock chrome APIs
const chromeMock = {
  tabs: {
    sendMessage: vi.fn(),
  },
  runtime: {
    lastError: null,
  },
};

vi.stubGlobal('chrome', chromeMock);

describe('demo-orchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOrchestratorState();
  });

  it('transitions from idle to running to complete', async () => {
    const testPlan: TestPlan = {
      planName: 'test-plan',
      baseUrl: 'https://example.com',
      steps: [
        {
          stepNumber: 1,
          action: 'navigate',
          description: 'Navigate to page',
          target: 'https://example.com',
        },
      ],
    };

    const message: StartDemoMessage = createMessage('start_demo', {
      testPlanId: 'test-1',
      testPlan,
      acceptanceCriteria: ['All steps pass'],
      triggeredBy: 'test',
    });

    // Mock successful execution
    chromeMock.tabs.sendMessage.mockResolvedValue({
      results: [
        {
          stepNumber: 1,
          action: 'navigate',
          description: 'Navigate to page',
          passed: true,
          duration: 100,
          timestamp: Date.now(),
        },
      ],
    });

    // State should be idle initially
    expect(getState().status).toBe('idle');

    const result = await handleStartDemo(message, 1);

    // Should complete successfully
    expect(result.passed).toBe(true);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].passed).toBe(true);
    expect(result.testPlanId).toBe('test-1');

    // State should be reset to idle after completion
    expect(getState().status).toBe('idle');
  });

  it('handles empty test plans', async () => {
    const testPlan: TestPlan = {
      planName: 'empty-plan',
      baseUrl: 'https://example.com',
      steps: [],
    };

    const message: StartDemoMessage = createMessage('start_demo', {
      testPlanId: 'test-empty',
      testPlan,
      acceptanceCriteria: [],
      triggeredBy: 'test',
    });

    chromeMock.tabs.sendMessage.mockResolvedValue({
      results: [],
    });

    const result = await handleStartDemo(message, 1);

    expect(result.passed).toBe(true);
    expect(result.steps).toHaveLength(0);
    expect(result.summary).toContain('All 0 steps passed');
  });

  it('assembles results correctly', async () => {
    const testPlan: TestPlan = {
      planName: 'multi-step',
      baseUrl: 'https://example.com',
      steps: [
        {
          stepNumber: 1,
          action: 'click',
          description: 'Click button',
          selector: '#btn',
        },
        {
          stepNumber: 2,
          action: 'fill',
          description: 'Fill input',
          selector: '#input',
          value: 'test',
        },
      ],
    };

    const message: StartDemoMessage = createMessage('start_demo', {
      testPlanId: 'test-multi',
      testPlan,
      acceptanceCriteria: ['Steps complete'],
      triggeredBy: 'test',
    });

    const mockResults = [
      {
        stepNumber: 1,
        action: 'click',
        description: 'Click button',
        passed: true,
        duration: 50,
        timestamp: Date.now(),
      },
      {
        stepNumber: 2,
        action: 'fill',
        description: 'Fill input',
        passed: true,
        duration: 30,
        timestamp: Date.now(),
      },
    ];

    chromeMock.tabs.sendMessage.mockResolvedValue({
      results: mockResults,
    });

    const result = await handleStartDemo(message, 1);

    expect(result.passed).toBe(true);
    expect(result.steps).toHaveLength(2);
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.timestamp).toBeGreaterThanOrEqual(0);
    expect(result.summary).toContain('successfully');
  });

  it('handles errors gracefully', async () => {
    const testPlan: TestPlan = {
      planName: 'error-plan',
      baseUrl: 'https://example.com',
      steps: [
        {
          stepNumber: 1,
          action: 'click',
          description: 'Click missing button',
          selector: '#missing',
        },
      ],
    };

    const message: StartDemoMessage = createMessage('start_demo', {
      testPlanId: 'test-error',
      testPlan,
      acceptanceCriteria: [],
      triggeredBy: 'test',
    });

    chromeMock.tabs.sendMessage.mockRejectedValue(
      new Error('Content script not ready'),
    );

    const result = await handleStartDemo(message, 1);

    expect(result.passed).toBe(false);
    expect(result.summary).toContain('failed with error');
  });

  it('extracts screenshots from results', async () => {
    const testPlan: TestPlan = {
      planName: 'screenshot-plan',
      baseUrl: 'https://example.com',
      steps: [
        {
          stepNumber: 1,
          action: 'screenshot',
          description: 'Take screenshot',
        },
      ],
    };

    const message: StartDemoMessage = createMessage('start_demo', {
      testPlanId: 'test-screenshot',
      testPlan,
      acceptanceCriteria: [],
      triggeredBy: 'test',
    });

    chromeMock.tabs.sendMessage.mockResolvedValue({
      results: [
        {
          stepNumber: 1,
          action: 'screenshot',
          description: 'Take screenshot',
          passed: true,
          duration: 10,
          timestamp: Date.now(),
          screenshotDataUrl: 'data:image/png;base64,abc123',
        },
      ],
    });

    const result = await handleStartDemo(message, 1);

    expect(result.screenshots).toHaveLength(1);
    expect(result.screenshots[0].dataUrl).toBe('data:image/png;base64,abc123');
    expect(result.screenshots[0].stepNumber).toBe(1);
  });
});
