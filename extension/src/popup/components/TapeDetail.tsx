import React from 'react';
import type { TapeRecord } from '@popcorn/shared';
import styles from './TapeDetail.module.css';

interface TapeDetailProps {
  tape: TapeRecord;
  onBack: () => void;
}

function formatDuration(ms: number): string {
  const seconds = (ms / 1000).toFixed(1);
  return `${seconds}s`;
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString();
}

export function TapeDetail({ tape, onBack }: TapeDetailProps) {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backButton} onClick={onBack} aria-label="Back to list">
          ← Back
        </button>
        <div className={styles.titleSection}>
          <h2 className={styles.demoName}>{tape.demoName}</h2>
          <span className={`${styles.badge} ${tape.passed ? styles.badgePass : styles.badgeFail}`}>
            {tape.passed ? 'PASSED' : 'FAILED'}
          </span>
        </div>
      </div>

      <div className={styles.content}>
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Overview</h3>
          <div className={styles.metadata}>
            <div className={styles.metadataItem}>
              <span className={styles.metadataLabel}>Timestamp:</span>
              <span className={styles.metadataValue}>{formatTimestamp(tape.timestamp)}</span>
            </div>
            <div className={styles.metadataItem}>
              <span className={styles.metadataLabel}>Duration:</span>
              <span className={styles.metadataValue}>{formatDuration(tape.duration)}</span>
            </div>
            <div className={styles.metadataItem}>
              <span className={styles.metadataLabel}>Steps:</span>
              <span className={styles.metadataValue}>{tape.steps.length}</span>
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Summary</h3>
          <p className={styles.summary}>{tape.summary}</p>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Steps</h3>
          <div className={styles.steps}>
            {tape.steps.map((step) => (
              <div
                key={step.stepNumber}
                className={`${styles.step} ${step.passed ? styles.stepPassed : styles.stepFailed}`}
              >
                <div className={styles.stepHeader}>
                  <span className={styles.stepIcon}>{step.passed ? '✓' : '✗'}</span>
                  <span className={styles.stepNumber}>Step {step.stepNumber}</span>
                  <span className={styles.stepAction}>{step.action}</span>
                  <span className={styles.stepDuration}>{formatDuration(step.duration)}</span>
                </div>
                <p className={styles.stepDescription}>{step.description}</p>
                {step.error && (
                  <div className={styles.stepError}>
                    <span className={styles.stepErrorLabel}>Error:</span>
                    <span className={styles.stepErrorMessage}>{step.error}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {tape.videoMetadata && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Video</h3>
            <div className={styles.videoPlaceholder}>
              <span className={styles.videoIcon}>🎥</span>
              <p className={styles.videoText}>Video playback coming soon</p>
              <p className={styles.videoMetadata}>
                {tape.videoMetadata.filename} • {formatDuration(tape.videoMetadata.duration * 1000)} • {tape.videoMetadata.resolution.width}x{tape.videoMetadata.resolution.height}
              </p>
            </div>
          </section>
        )}

        {tape.screenshots.length > 0 && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Screenshots</h3>
            <div className={styles.screenshots}>
              {tape.screenshots.map((screenshot, index) => (
                <div key={index} className={styles.screenshot}>
                  <img
                    src={screenshot.dataUrl}
                    alt={screenshot.label || `Step ${screenshot.stepNumber}`}
                    className={styles.screenshotImage}
                  />
                  <p className={styles.screenshotLabel}>
                    {screenshot.label || `Step ${screenshot.stepNumber}`}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
