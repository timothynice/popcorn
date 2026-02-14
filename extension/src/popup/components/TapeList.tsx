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
  onRerun?: (tapeId: string) => void;
}

export function TapeList({
  tapes,
  isLoading,
  error,
  selectedTapeId,
  onSelectTape,
  onRerun,
}: TapeListProps) {
  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>
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
          <p className={styles.emptyMessage}>No tapes yet</p>
          <p className={styles.emptyHint}>
            Modify a frontend file to trigger a demo, or use the settings panel to run one manually.
          </p>
          <div className={styles.tip}>
            <span className={styles.tipIcon}>i</span>
            <p className={styles.tipText}>
              Keep your app tab active in Chrome when demos run. If your app isn't open, set <code>baseUrl</code> in <code>popcorn.config.json</code> as a fallback.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.list}>
        <h3 className={styles.sectionLabel}>Most Recent Test</h3>
        {tapes.map((tape, index) => (
          <React.Fragment key={tape.id}>
            {index === 1 && tapes.length > 1 && (
              <h3 className={styles.sectionLabel}>Previous Tests</h3>
            )}
            <TapeCard
              tape={tape}
              onClick={() => onSelectTape(tape.id)}
              isSelected={selectedTapeId === tape.id}
              onRerun={onRerun ? () => onRerun(tape.id) : undefined}
              variant={index === 0 ? 'hero' : 'compact'}
            />
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
