import React from 'react';
import styles from './TestButtonArea.module.css';

interface TestButtonAreaProps {
  onClick: () => void;
  onPlansClick: () => void;
}

export function TestButtonArea({ onClick, onPlansClick }: TestButtonAreaProps) {
  return (
    <div className={styles.area}>
      <button
        type="button"
        className={styles.button}
        onClick={onClick}
        aria-label="Test this page"
        title="Test this page"
      >
        <svg width="14" height="16" viewBox="0 0 10 12" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 1L9 6L1 11V1Z" fill="currentColor" />
        </svg>
        Test Page
      </button>
      <button
        type="button"
        className={styles.plansButton}
        onClick={onPlansClick}
        aria-label="Test Plans"
        title="Test Plans"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="3" y="2" width="10" height="12" rx="1" stroke="currentColor" strokeWidth="1.2" />
          <line x1="5" y1="5" x2="11" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="5" y1="8" x2="11" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="5" y1="11" x2="9" y2="11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        Test Plans
      </button>
    </div>
  );
}
