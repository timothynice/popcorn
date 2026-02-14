import React from 'react';
import styles from './TestButtonArea.module.css';

interface TestButtonAreaProps {
  onClick: () => void;
}

export function TestButtonArea({ onClick }: TestButtonAreaProps) {
  return (
    <div className={styles.area}>
      <button
        type="button"
        className={styles.button}
        onClick={onClick}
        aria-label="Run test on current page"
        title="Configure and run a test on the current page"
      >
        <svg width="14" height="16" viewBox="0 0 10 12" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 1L9 6L1 11V1Z" fill="currentColor" />
        </svg>
        Run Test
      </button>
    </div>
  );
}
