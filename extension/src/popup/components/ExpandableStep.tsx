import React, { useState } from 'react';
import type { StepResult, ConsoleLogEntry, TestStep } from '@popcorn/shared';
import styles from './ExpandableStep.module.css';

interface PriorStepsContext {
  totalBefore: number;
  passedBefore: number;
  failedBefore: number;
}

interface ExpandableStepProps {
  step: StepResult;
  testStep?: TestStep;
  testPlanName?: string;
  priorStepsContext?: PriorStepsContext;
  onScreenshotClick?: (dataUrl: string) => void;
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatKey(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
}

function formatValue(value: unknown): { text: string; className?: string } {
  if (value === true) return { text: 'true', className: styles.metadataValueTrue };
  if (value === false) return { text: 'false', className: styles.metadataValueFalse };
  if (value === null || value === undefined) return { text: '-' };
  if (typeof value === 'object') {
    try {
      return { text: JSON.stringify(value, null, 2) };
    } catch {
      return { text: String(value) };
    }
  }
  return { text: String(value) };
}

const CONSOLE_STYLES: Record<string, string> = {
  log: styles.consoleLog,
  warn: styles.consoleWarn,
  error: styles.consoleError,
  info: styles.consoleInfo,
};

// Keys consumed by semantic sections — anything not listed here falls through to the generic fallback
const INTERNAL_KEYS = new Set(['screenshotDataUrl', 'needsBackgroundScreenshot']);

const NAVIGATION_KEYS = new Set(['urlBefore', 'urlAfter', 'targetUrl', 'finalUrl', 'urlChanged']);
const ASSERTION_KEYS = new Set([
  'assertionType', 'expectedText', 'actualText', 'expectedUrl', 'actualUrl',
  'expectedCount', 'actualCount', 'expectedValue', 'actualValue', 'attrName',
]);
const DOM_STATE_KEYS = new Set(['domSettled', 'modalDetected']);
const ACTIONABILITY_KEYS = new Set(['actionable', 'reason']);
const PAGE_STATE_KEYS = new Set(['url', 'title']);
const MODAL_DISMISS_KEYS = new Set(['dismissed', 'modalType', 'method', 'reason']);

function getConsumedKeys(action: string): Set<string> {
  const consumed = new Set<string>();
  if (['click', 'navigate', 'go_back'].includes(action)) NAVIGATION_KEYS.forEach((k) => consumed.add(k));
  if (action === 'assert') ASSERTION_KEYS.forEach((k) => consumed.add(k));
  if (['click', 'wait'].includes(action)) DOM_STATE_KEYS.forEach((k) => consumed.add(k));
  if (action === 'check_actionability') ACTIONABILITY_KEYS.forEach((k) => consumed.add(k));
  if (action === 'get_page_state') PAGE_STATE_KEYS.forEach((k) => consumed.add(k));
  if (action === 'dismiss_modal') MODAL_DISMISS_KEYS.forEach((k) => consumed.add(k));
  return consumed;
}

// --- Semantic section renderers ---

function NavigationSection({ meta }: { meta: Record<string, unknown> }) {
  const urlBefore = meta.urlBefore as string | undefined;
  const urlAfter = meta.urlAfter as string | undefined;
  const targetUrl = meta.targetUrl as string | undefined;
  const finalUrl = meta.finalUrl as string | undefined;
  const urlChanged = meta.urlChanged as boolean | undefined;

  if (!urlBefore && !targetUrl && urlChanged === undefined) return null;

  return (
    <div className={styles.metadataSection}>
      <div className={styles.sectionLabel}>Navigation</div>
      {urlBefore && urlAfter && (
        <div className={styles.comparisonRow}>
          <div className={styles.comparisonValues}>
            <div className={styles.valueBefore}>{urlBefore}</div>
            <span className={styles.arrow}>{'\u2192'}</span>
            <div className={styles.valueAfter}>{urlAfter}</div>
          </div>
        </div>
      )}
      {targetUrl && finalUrl && !(urlBefore && urlAfter) && (
        <div className={styles.comparisonRow}>
          <div className={styles.comparisonValues}>
            <div className={styles.expected}>Target: {targetUrl}</div>
            <div className={styles.actual}>Final: {finalUrl}</div>
          </div>
        </div>
      )}
      {urlChanged !== undefined && (
        <div className={styles.metadataRow}>
          <span className={styles.metadataKey}>URL Changed</span>
          <span className={formatValue(urlChanged).className}>{formatValue(urlChanged).text}</span>
        </div>
      )}
    </div>
  );
}

function AssertionSection({ meta }: { meta: Record<string, unknown> }) {
  const assertionType = meta.assertionType as string | undefined;
  if (!assertionType) return null;

  const pairs: Array<{ label: string; expected: string; actual: string }> = [];

  if (meta.expectedText !== undefined || meta.actualText !== undefined) {
    pairs.push({ label: 'Text', expected: String(meta.expectedText ?? ''), actual: String(meta.actualText ?? 'N/A') });
  }
  if (meta.expectedUrl !== undefined || meta.actualUrl !== undefined) {
    pairs.push({ label: 'URL', expected: String(meta.expectedUrl ?? ''), actual: String(meta.actualUrl ?? 'N/A') });
  }
  if (meta.expectedCount !== undefined || meta.actualCount !== undefined) {
    pairs.push({ label: 'Count', expected: String(meta.expectedCount ?? ''), actual: String(meta.actualCount ?? 'N/A') });
  }
  if (meta.expectedValue !== undefined || meta.actualValue !== undefined) {
    const label = meta.attrName ? `Attribute (${meta.attrName})` : 'Value';
    pairs.push({ label, expected: String(meta.expectedValue ?? ''), actual: String(meta.actualValue ?? 'N/A') });
  }

  return (
    <div className={styles.metadataSection}>
      <div className={styles.sectionLabel}>Assertion: {assertionType}</div>
      {pairs.map((pair) => (
        <div key={pair.label} className={styles.comparisonRow}>
          <span className={styles.comparisonLabel}>{pair.label}</span>
          <div className={styles.comparisonValues}>
            <div className={styles.expected}>Expected: {pair.expected}</div>
            <div className={styles.actual}>Actual: {pair.actual}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function DOMStateSection({ meta }: { meta: Record<string, unknown> }) {
  const domSettled = meta.domSettled as boolean | undefined;
  const modalDetected = meta.modalDetected as { type: string; selector: string; dismissSelector?: string } | null | undefined;

  if (domSettled === undefined && !modalDetected) return null;

  return (
    <div className={styles.metadataSection}>
      <div className={styles.sectionLabel}>DOM State</div>
      {domSettled !== undefined && (
        <div className={styles.metadataRow}>
          <span className={styles.metadataKey}>DOM Settled</span>
          <span className={formatValue(domSettled).className}>{formatValue(domSettled).text}</span>
        </div>
      )}
      {modalDetected && (
        <>
          <div className={styles.metadataRow}>
            <span className={styles.metadataKey}>Modal</span>
            <span className={styles.metadataValue}>{modalDetected.type}</span>
          </div>
          <div className={styles.metadataRow}>
            <span className={styles.metadataKey}>Selector</span>
            <code className={styles.codeValue}>{modalDetected.selector}</code>
          </div>
          {modalDetected.dismissSelector && (
            <div className={styles.metadataRow}>
              <span className={styles.metadataKey}>Dismiss</span>
              <code className={styles.codeValue}>{modalDetected.dismissSelector}</code>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ActionabilitySection({ meta }: { meta: Record<string, unknown> }) {
  const actionable = meta.actionable as boolean | undefined;
  const reason = meta.reason as string | undefined;
  if (actionable === undefined) return null;

  return (
    <div className={styles.metadataSection}>
      <div className={styles.sectionLabel}>Actionability</div>
      <div className={styles.metadataRow}>
        <span className={styles.metadataKey}>Actionable</span>
        <span className={formatValue(actionable).className}>{formatValue(actionable).text}</span>
      </div>
      {!actionable && reason && (
        <div className={styles.metadataRow}>
          <span className={styles.metadataKey}>Reason</span>
          <span className={styles.metadataValue}>{reason}</span>
        </div>
      )}
    </div>
  );
}

function PageStateSection({ meta }: { meta: Record<string, unknown> }) {
  const url = meta.url as string | undefined;
  const title = meta.title as string | undefined;
  if (!url && !title) return null;

  return (
    <div className={styles.metadataSection}>
      <div className={styles.sectionLabel}>Page State</div>
      {url && (
        <div className={styles.metadataRow}>
          <span className={styles.metadataKey}>URL</span>
          <span className={styles.metadataValue}>{url}</span>
        </div>
      )}
      {title && (
        <div className={styles.metadataRow}>
          <span className={styles.metadataKey}>Title</span>
          <span className={styles.metadataValue}>{title}</span>
        </div>
      )}
    </div>
  );
}

function ModalDismissSection({ meta }: { meta: Record<string, unknown> }) {
  const dismissed = meta.dismissed as boolean | undefined;
  if (dismissed === undefined) return null;

  return (
    <div className={styles.metadataSection}>
      <div className={styles.sectionLabel}>Modal Dismiss</div>
      <div className={styles.metadataRow}>
        <span className={styles.metadataKey}>Dismissed</span>
        <span className={formatValue(dismissed).className}>{formatValue(dismissed).text}</span>
      </div>
      {dismissed && meta.modalType && (
        <div className={styles.metadataRow}>
          <span className={styles.metadataKey}>Type</span>
          <span className={styles.metadataValue}>{String(meta.modalType)}</span>
        </div>
      )}
      {dismissed && meta.method && (
        <div className={styles.metadataRow}>
          <span className={styles.metadataKey}>Method</span>
          <span className={styles.metadataValue}>{String(meta.method)}</span>
        </div>
      )}
      {!dismissed && meta.reason && (
        <div className={styles.metadataRow}>
          <span className={styles.metadataKey}>Reason</span>
          <span className={styles.metadataValue}>{String(meta.reason)}</span>
        </div>
      )}
    </div>
  );
}

// --- AI Fix Prompt ---

function generateAIFixPrompt(
  step: StepResult,
  testStep: TestStep | undefined,
  testPlanName: string | undefined,
  priorStepsContext: PriorStepsContext | undefined,
): string {
  const lines: string[] = [];

  lines.push('Fix the following UI test failure:\n');

  if (testPlanName) {
    lines.push(`Test Plan: ${testPlanName}`);
  }

  if (priorStepsContext) {
    const total = priorStepsContext.totalBefore + 1;
    lines.push(`Step ${step.stepNumber} of ${total} failed (${priorStepsContext.passedBefore} of ${priorStepsContext.totalBefore} prior steps passed)\n`);
  } else {
    lines.push(`Step ${step.stepNumber} failed\n`);
  }

  lines.push('## Failed Step');
  lines.push(`Action: ${step.action}`);
  lines.push(`Description: ${step.description}`);

  if (testStep) {
    if (testStep.selector) {
      lines.push(`Selector: ${testStep.selector}`);
      if (testStep.selectorFallback) {
        lines.push(`Fallback Selector: ${testStep.selectorFallback}`);
      }
    }
    if (testStep.target) lines.push(`Target: ${testStep.target}`);
    if (testStep.expected !== undefined) lines.push(`Expected: ${JSON.stringify(testStep.expected)}`);
    if (testStep.value !== undefined) lines.push(`Value: ${JSON.stringify(testStep.value)}`);
  }

  if (step.error) {
    lines.push(`\nError: ${step.error}`);
  }

  if (step.metadata) {
    const entries = Object.entries(step.metadata)
      .filter(([key]) => !INTERNAL_KEYS.has(key))
      .map(([key, value]) => `  ${key}: ${JSON.stringify(value)}`);
    if (entries.length > 0) {
      lines.push(`\nResult Details:\n${entries.join('\n')}`);
    }
  }

  if (step.consoleLogs && step.consoleLogs.length > 0) {
    lines.push('\nConsole Output:');
    for (const log of step.consoleLogs) {
      lines.push(`  [${log.level}] ${log.message}`);
    }
  }

  lines.push('\nPlease analyze this failure and fix the underlying issue. Consider:');
  lines.push('1. Whether the CSS selector needs updating (element may have changed)');
  lines.push('2. Whether timing/wait conditions need adjustment');
  lines.push('3. Whether the expected behavior has changed');
  lines.push('4. Any console errors that indicate the root cause');

  return lines.join('\n');
}

// --- Main Component ---

export function ExpandableStep({
  step,
  testStep,
  testPlanName,
  priorStepsContext,
  onScreenshotClick,
}: ExpandableStepProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const metadata = step.metadata;
  const hasConsoleLogs = step.consoleLogs && step.consoleLogs.length > 0;

  // Determine expandable content
  const hasMetadata = metadata && Object.keys(metadata).some((k) => !INTERNAL_KEYS.has(k));
  const hasTestStepInput = !step.passed && testStep && (testStep.selector || testStep.target || testStep.expected !== undefined);
  const hasExpandableContent = hasMetadata || hasConsoleLogs || step.error || step.screenshotDataUrl || hasTestStepInput;

  // Fallback metadata: keys not consumed by any semantic section
  const consumedKeys = metadata ? getConsumedKeys(step.action) : new Set<string>();
  const fallbackEntries = metadata
    ? Object.entries(metadata).filter(([key]) => !INTERNAL_KEYS.has(key) && !consumedKeys.has(key))
    : [];

  const handleToggle = () => {
    if (hasExpandableContent) setExpanded(!expanded);
  };

  const handleKeyDown = hasExpandableContent
    ? (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setExpanded(!expanded);
        }
      }
    : undefined;

  const handleCopyPrompt = async () => {
    const prompt = generateAIFixPrompt(step, testStep, testPlanName, priorStepsContext);
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  return (
    <div className={`${styles.step} ${step.passed ? styles.stepPassed : styles.stepFailed} ${hasExpandableContent ? styles.expandable : ''}`}>
      <div
        className={`${styles.clickArea} ${hasExpandableContent ? styles.clickAreaExpandable : ''}`}
        onClick={handleToggle}
        role={hasExpandableContent ? 'button' : undefined}
        tabIndex={hasExpandableContent ? 0 : undefined}
        onKeyDown={handleKeyDown}
        aria-expanded={hasExpandableContent ? expanded : undefined}
      >
        {hasExpandableContent && (
          <span className={`${styles.chevron} ${expanded ? styles.chevronExpanded : ''}`}>
            {'\u25B6'}
          </span>
        )}
        <div className={styles.body}>
          <div className={styles.header}>
            <span className={styles.stepIcon}>
              {step.passed ? '\u2713' : '\u2717'}
            </span>
            <span className={styles.stepNumber}>Step {step.stepNumber}</span>
            <span className={styles.stepAction}>{step.action}</span>
            <span className={styles.stepDuration}>{formatDuration(step.duration)}</span>
          </div>
          <p className={styles.description}>{step.description}</p>
          {!expanded && step.error && (
            <div className={styles.errorCompact}>{step.error}</div>
          )}
        </div>
      </div>

      {expanded && (
        <div className={styles.detail}>
          {/* 1. Error detail */}
          {step.error && (
            <div className={styles.errorDetail}>
              <div className={styles.errorLabel}>Error</div>
              <div className={styles.errorMessage}>{step.error}</div>
            </div>
          )}

          {/* 2. Selector (failures only) */}
          {!step.passed && testStep?.selector && (
            <div className={styles.selectorSection}>
              <div className={styles.sectionLabel}>Selector</div>
              <div className={styles.selectorRow}>
                <span className={styles.selectorLabel}>Primary</span>
                <code className={styles.selectorValue}>{testStep.selector}</code>
              </div>
              {testStep.selectorFallback && (
                <div className={styles.selectorRow}>
                  <span className={styles.selectorLabel}>Fallback</span>
                  <code className={styles.selectorValue}>{testStep.selectorFallback}</code>
                </div>
              )}
            </div>
          )}

          {/* 3. Expected vs Actual from test plan */}
          {testStep && (testStep.target || testStep.expected !== undefined || testStep.value !== undefined) && (
            <div className={styles.metadataSection}>
              <div className={styles.sectionLabel}>Expected vs Actual</div>
              {testStep.target && (
                <div className={styles.comparisonRow}>
                  <span className={styles.comparisonLabel}>Target URL</span>
                  <div className={styles.comparisonValues}>
                    <div className={styles.expected}>Expected: {testStep.target}</div>
                    <div className={styles.actual}>Actual: {String(metadata?.finalUrl ?? metadata?.urlAfter ?? 'N/A')}</div>
                  </div>
                </div>
              )}
              {testStep.expected !== undefined && (
                <div className={styles.comparisonRow}>
                  <span className={styles.comparisonLabel}>{testStep.assertionType ?? 'Assertion'}</span>
                  <div className={styles.comparisonValues}>
                    <div className={styles.expected}>Expected: {String(testStep.expected)}</div>
                    <div className={styles.actual}>Actual: {String(
                      metadata?.actualText ?? metadata?.actualUrl ?? metadata?.actualCount ?? metadata?.actualValue ?? 'N/A'
                    )}</div>
                  </div>
                </div>
              )}
              {testStep.value !== undefined && testStep.expected === undefined && (
                <div className={styles.comparisonRow}>
                  <span className={styles.comparisonLabel}>Input Value</span>
                  <div className={styles.comparisonValues}>
                    <div className={styles.expected}>Planned: {String(testStep.value)}</div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 4. Semantic metadata sections */}
          {metadata && (
            <>
              {['click', 'navigate', 'go_back'].includes(step.action) && <NavigationSection meta={metadata} />}
              {step.action === 'assert' && <AssertionSection meta={metadata} />}
              {['click', 'wait'].includes(step.action) && <DOMStateSection meta={metadata} />}
              {step.action === 'check_actionability' && <ActionabilitySection meta={metadata} />}
              {step.action === 'get_page_state' && <PageStateSection meta={metadata} />}
              {step.action === 'dismiss_modal' && <ModalDismissSection meta={metadata} />}
            </>
          )}

          {/* 5. Fallback metadata (keys not consumed by semantic sections) */}
          {fallbackEntries.length > 0 && (
            <div className={styles.metadataSection}>
              <div className={styles.sectionLabel}>Details</div>
              {fallbackEntries.map(([key, value]) => {
                const formatted = formatValue(value);
                return (
                  <div key={key} className={styles.metadataRow}>
                    <span className={styles.metadataKey}>{formatKey(key)}</span>
                    <span className={`${styles.metadataValue} ${formatted.className || ''}`}>
                      {formatted.text}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* 6. Console logs */}
          {hasConsoleLogs && (
            <div className={styles.consoleLogs}>
              <div className={styles.consoleTitle}>Console ({step.consoleLogs!.length})</div>
              {step.consoleLogs!.map((entry: ConsoleLogEntry, i: number) => (
                <div key={i} className={`${styles.consoleEntry} ${CONSOLE_STYLES[entry.level] || ''}`}>
                  <span className={styles.consoleBadge}>{entry.level}</span>
                  <span className={styles.consoleMessage}>{entry.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* 7. Step screenshot */}
          {step.screenshotDataUrl && (
            <img
              src={step.screenshotDataUrl}
              alt={`Step ${step.stepNumber} screenshot`}
              className={styles.stepScreenshot}
              onClick={() => onScreenshotClick?.(step.screenshotDataUrl!)}
            />
          )}

          {/* 8. Copy AI Fix Prompt (failures only) */}
          {!step.passed && (
            <button
              className={`${styles.copyPromptButton} ${copied ? styles.copyPromptButtonCopied : ''}`}
              onClick={handleCopyPrompt}
            >
              {copied ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M3.5 7.5l2 2 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Copied!
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="4.5" y="4.5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" />
                    <path d="M9.5 4.5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v5.5a1 1 0 001 1h1.5" stroke="currentColor" strokeWidth="1.2" />
                  </svg>
                  Copy AI Fix Prompt
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
