import React, { useState, useMemo } from 'react';
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

type FilterStatus = 'all' | 'passed' | 'failed';

export function TapeList({
  tapes,
  isLoading,
  error,
  selectedTapeId,
  onSelectTape,
  onRerun,
}: TapeListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');

  const filteredTapes = useMemo(() => {
    let result = tapes;

    // Text search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (tape) =>
          tape.testPlanId.toLowerCase().includes(query) ||
          (tape.summary && tape.summary.toLowerCase().includes(query))
      );
    }

    // Status filter
    if (filterStatus === 'passed') {
      result = result.filter((tape) => tape.passed === true);
    } else if (filterStatus === 'failed') {
      result = result.filter((tape) => tape.passed === false);
    }

    return result;
  }, [tapes, searchQuery, filterStatus]);

  const handleFilterClick = (status: FilterStatus) => {
    setFilterStatus(filterStatus === status ? 'all' : status);
  };

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
      {tapes.length > 0 && (
        <div className={styles.toolbar}>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search tapes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <button
            className={`${styles.filterButton} ${
              filterStatus === 'passed' ? styles.active : ''
            } ${filterStatus === 'passed' ? styles.passed : ''}`}
            onClick={() => handleFilterClick('passed')}
            title="Filter passed"
          >
            ✓
          </button>
          <button
            className={`${styles.filterButton} ${
              filterStatus === 'failed' ? styles.active : ''
            } ${filterStatus === 'failed' ? styles.failed : ''}`}
            onClick={() => handleFilterClick('failed')}
            title="Filter failed"
          >
            ✗
          </button>
          {(searchQuery.trim() || filterStatus !== 'all') && (
            <div className={styles.count}>
              {filteredTapes.length} of {tapes.length} tapes
            </div>
          )}
        </div>
      )}
      <div className={styles.list}>
        <h3 className={styles.sectionLabel}>Most Recent Test</h3>
        {filteredTapes.map((tape, index) => (
          <React.Fragment key={tape.id}>
            {index === 1 && filteredTapes.length > 1 && (
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
