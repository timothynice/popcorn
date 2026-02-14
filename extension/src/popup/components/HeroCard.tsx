import React from 'react';
import type { TapeRecord } from '@popcorn/shared';
import styles from './HeroCard.module.css';

interface HeroCardProps {
  tape: TapeRecord;
  onClick: () => void;
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTimestamp(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  if (seconds > 0) return `${seconds}s ago`;
  return 'Just now';
}

export function HeroCard({ tape, onClick }: HeroCardProps) {
  const stepCount = tape.steps.length;
  const passedSteps = tape.steps.filter((s) => s.passed).length;

  return (
    <div
      className={styles.hero}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className={styles.headerRow}>
        <div className={styles.nameGroup}>
          <span className={`${styles.badge} ${tape.passed ? styles.badgePass : styles.badgeFail}`}>
            {tape.passed ? '\u2713' : '\u2717'}
          </span>
          <h3 className={styles.demoName}>{tape.demoName}</h3>
        </div>
        <span className={styles.time}>{formatTimestamp(tape.timestamp)}</span>
      </div>

      {tape.thumbnailDataUrl ? (
        <div className={styles.thumbnailWrap}>
          <img
            src={tape.thumbnailDataUrl}
            alt={`${tape.demoName} preview`}
            className={styles.thumbnail}
          />
          {tape.videoUrl && (
            <div className={styles.thumbnailOverlay}>
              <span className={styles.playIcon}>{'\u25B6'}</span>
            </div>
          )}
        </div>
      ) : tape.videoUrl ? (
        <div className={styles.thumbnailWrap}>
          <div className={styles.videoPlaceholder}>
            <span className={styles.playIcon}>{'\u25B6'}</span>
          </div>
        </div>
      ) : null}

      <div className={styles.stats}>
        <span className={styles.stat}>
          {passedSteps}/{stepCount} steps passed
        </span>
        <span className={styles.statDot}>{'\u00B7'}</span>
        <span className={styles.stat}>{formatDuration(tape.duration)}</span>
      </div>

      {tape.summary && (
        <p className={styles.summary}>{tape.summary}</p>
      )}
    </div>
  );
}
