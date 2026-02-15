import React, { useState } from 'react';
import type { StepResult, ConsoleLogEntry } from '@popcorn/shared';
import styles from './ExpandableStep.module.css';

interface ExpandableStepProps {
  step: StepResult;
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

export function ExpandableStep({ step, onScreenshotClick }: ExpandableStepProps) {
  const [expanded, setExpanded] = useState(false);

  const metadata = step.metadata;
  const hasMetadata = metadata && Object.keys(metadata).length > 0;
  const hasConsoleLogs = step.consoleLogs && step.consoleLogs.length > 0;
  const hasExpandableContent = hasMetadata || hasConsoleLogs || step.error || step.screenshotDataUrl;

  // Filter out internal metadata keys
  const metadataEntries = metadata
    ? Object.entries(metadata).filter(([key]) => key !== 'screenshotDataUrl' && key !== 'needsBackgroundScreenshot')
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
          {/* Error detail */}
          {step.error && (
            <div className={styles.errorDetail}>
              <div className={styles.errorLabel}>Error</div>
              <div className={styles.errorMessage}>{step.error}</div>
            </div>
          )}

          {/* Metadata */}
          {metadataEntries.length > 0 && (
            <div className={styles.metadataSection}>
              <div className={styles.metadataTitle}>Details</div>
              {metadataEntries.map(([key, value]) => {
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

          {/* Console logs */}
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

          {/* Step screenshot */}
          {step.screenshotDataUrl && (
            <img
              src={step.screenshotDataUrl}
              alt={`Step ${step.stepNumber} screenshot`}
              className={styles.stepScreenshot}
              onClick={() => onScreenshotClick?.(step.screenshotDataUrl!)}
            />
          )}
        </div>
      )}
    </div>
  );
}
