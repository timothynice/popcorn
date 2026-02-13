import React from 'react';
import type { TapeRecord } from '@popcorn/shared';
import styles from './TapeCard.module.css';

interface TapeCardProps {
  tape: TapeRecord;
  onClick: () => void;
  isSelected: boolean;
  onRerun?: () => void;
  variant?: 'compact' | 'hero';
}

function formatTimestamp(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return `${seconds}s ago`;
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function TapeCard({ tape, onClick, isSelected, onRerun, variant = 'compact' }: TapeCardProps) {
  const isHero = variant === 'hero';
  const passedSteps = tape.steps.filter((s) => s.passed).length;
  const totalSteps = tape.steps.length;

  if (isHero) {
    return (
      <div
        className={`${styles.heroRow} ${isSelected ? styles.selected : ''}`}
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
        {/* Hero thumbnail — large 16:9 */}
        <div className={styles.heroThumbnail}>
          {tape.thumbnailDataUrl ? (
            <img
              src={tape.thumbnailDataUrl}
              alt={`${tape.demoName} preview`}
              className={styles.heroThumbnailImg}
            />
          ) : (
            <div className={styles.heroThumbnailFallback} />
          )}
          <span className={`${styles.heroStatusDot} ${tape.passed ? styles.statusPass : styles.statusFail}`}>
            {tape.passed ? '✓' : '✗'}
          </span>
          {/* Re-run overlay button in bottom-right corner */}
          {tape.testPlan && !tape.videoUrl && onRerun && (
            <button
              className={styles.heroRerunBtn}
              onClick={(e) => {
                e.stopPropagation();
                onRerun();
              }}
              aria-label="Re-run with recording"
              title="Re-run with recording"
            >
              {'\u25CF'}
            </button>
          )}
        </div>

        {/* Info below thumbnail */}
        <div className={styles.heroInfo}>
          <div className={styles.heroNameRow}>
            <span className={styles.heroDemoName}>{tape.demoName}</span>
            <span className={styles.heroTime}>{formatTimestamp(tape.timestamp)}</span>
          </div>
          <div className={styles.heroStats}>
            <span>{passedSteps}/{totalSteps} steps passed</span>
            <span className={styles.metaDot}>{'\u00B7'}</span>
            <span>{formatDuration(tape.duration)}</span>
          </div>
          {tape.summary && (
            <p className={styles.heroSummary}>{tape.summary}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`${styles.row} ${isSelected ? styles.selected : ''}`}
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
      <div className={styles.thumbnail}>
        {tape.thumbnailDataUrl ? (
          <img
            src={tape.thumbnailDataUrl}
            alt={`${tape.demoName} thumbnail`}
            className={styles.thumbnailImg}
          />
        ) : (
          <div className={styles.thumbnailFallback} />
        )}
        <span className={`${styles.statusDot} ${tape.passed ? styles.statusPass : styles.statusFail}`}>
          {tape.passed ? '✓' : '✗'}
        </span>
      </div>
      <div className={styles.info}>
        <div className={styles.nameRow}>
          <span className={styles.demoName}>{tape.demoName}</span>
        </div>
        <div className={styles.meta}>
          <span>{formatTimestamp(tape.timestamp)}</span>
          <span className={styles.metaDot}>{'\u00B7'}</span>
          <span>{formatDuration(tape.duration)}</span>
        </div>
      </div>
      {tape.testPlan && !tape.videoUrl && onRerun && (
        <button
          className={styles.rerunBtn}
          onClick={(e) => {
            e.stopPropagation();
            onRerun();
          }}
          aria-label="Re-run with recording"
          title="Re-run with recording"
        >
          {'\u25CF'}
        </button>
      )}
    </div>
  );
}
