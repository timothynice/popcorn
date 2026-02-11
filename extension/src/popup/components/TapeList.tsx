import React from 'react';
import type { TapeRecord } from '@popcorn/shared';
import { TapeCard } from './TapeCard';
import styles from './TapeList.module.css';

interface TapeListProps {
  tapes: TapeRecord[];
  isLoading: boolean;
  error: string | null;
  selectedTapeId: string | null;
  onSelectTape: (id: string) => void;
}

export function TapeList({
  tapes,
  isLoading,
  error,
  selectedTapeId,
  onSelectTape,
}: TapeListProps) {
  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>
          <span className={styles.errorIcon}>⚠</span>
          <p className={styles.errorMessage}>{error}</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <p className={styles.loadingText}>Loading tapes...</p>
        </div>
      </div>
    );
  }

  if (tapes.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>🎬</span>
          <p className={styles.emptyMessage}>No tapes yet.</p>
          <p className={styles.emptyHint}>
            Modify a frontend file to trigger a demo.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.list}>
        {tapes.map((tape) => (
          <TapeCard
            key={tape.id}
            tape={tape}
            onClick={() => onSelectTape(tape.id)}
            isSelected={selectedTapeId === tape.id}
          />
        ))}
      </div>
    </div>
  );
}
