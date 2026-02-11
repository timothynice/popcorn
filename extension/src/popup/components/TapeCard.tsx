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
  const seconds = (ms / 1000).toFixed(1);
  return `${seconds}s`;
}

export function TapeCard({ tape, onClick, isSelected }: TapeCardProps) {
  return (
    <div
      className={`${styles.tapeCard} ${isSelected ? styles.selected : ''}`}
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
      <div className={styles.header}>
        <h3 className={styles.demoName}>{tape.demoName}</h3>
        <span className={`${styles.badge} ${tape.passed ? styles.badgePass : styles.badgeFail}`}>
          {tape.passed ? '✓' : '✗'}
        </span>
      </div>
      <div className={styles.metadata}>
        <span className={styles.timestamp}>{formatTimestamp(tape.timestamp)}</span>
        <span className={styles.duration}>{formatDuration(tape.duration)}</span>
      </div>
      <p className={styles.summary}>{tape.summary}</p>
    </div>
  );
}
