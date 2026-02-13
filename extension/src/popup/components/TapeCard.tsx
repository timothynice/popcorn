import React from 'react';
import type { TapeRecord } from '@popcorn/shared';
import styles from './TapeCard.module.css';

interface TapeCardProps {
  tape: TapeRecord;
  onClick: () => void;
  isSelected: boolean;
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

export function TapeCard({ tape, onClick, isSelected }: TapeCardProps) {
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
          <div className={`${styles.thumbnailFallback} ${tape.passed ? styles.thumbnailPass : styles.thumbnailFail}`}>
            <span className={styles.thumbnailIcon}>
              {tape.passed ? '\u2713' : '\u2717'}
            </span>
          </div>
        )}
      </div>
      <div className={styles.info}>
        <div className={styles.nameRow}>
          <span className={`${styles.badge} ${tape.passed ? styles.badgePass : styles.badgeFail}`}>
            {tape.passed ? '\u2713' : '\u2717'}
          </span>
          <span className={styles.demoName}>{tape.demoName}</span>
        </div>
        <div className={styles.meta}>
          <span>{formatTimestamp(tape.timestamp)}</span>
          <span className={styles.metaDot}>{'\u00B7'}</span>
          <span>{formatDuration(tape.duration)}</span>
        </div>
      </div>
    </div>
  );
}
