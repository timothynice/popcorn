import React from 'react';
import type { ExtensionStatus } from '../hooks/useExtensionState';
import styles from './StatusBar.module.css';

interface StatusBarProps {
  status: ExtensionStatus;
  connected: boolean;
  error: string | null;
  hookConnected: boolean;
  onSettingsClick: () => void;
  onTestClick: () => void;
  /** When true, show a back button instead of the status dot + text. */
  showBack?: boolean;
  /** Callback fired when the back button is clicked. */
  onBack?: () => void;
}

export function StatusBar({
  status,
  connected,
  error,
  hookConnected,
  onSettingsClick,
  onTestClick,
  showBack,
  onBack,
}: StatusBarProps) {
  const getStatusText = () => {
    if (error) return error;
    if (!connected) return 'Disconnected';
    switch (status) {
      case 'recording':
        return 'Recording';
      case 'processing':
        return 'Processing';
      case 'error':
        return 'Error';
      default:
        return 'Idle';
    }
  };

  const getStatusClass = () => {
    if (error || status === 'error' || !connected) return styles.statusError;
    if (status === 'recording') return styles.statusRecording;
    if (status === 'processing') return styles.statusProcessing;
    return styles.statusIdle;
  };

  return (
    <div className={styles.bar}>
      {showBack && onBack ? (
        <button
          type="button"
          className={styles.backButton}
          onClick={onBack}
          aria-label="Back to feed"
        >
          {'\u2190'} Back
        </button>
      ) : (
        <div className={styles.statusGroup}>
          <span className={`${styles.dot} ${getStatusClass()}`} />
          <span className={styles.statusText}>{getStatusText()}</span>
        </div>
      )}
      <div className={styles.hookIndicator}>
        <span className={`${styles.hookDot} ${hookConnected ? styles.hookConnected : styles.hookDisconnected}`} />
        <span className={styles.hookLabel}>Hook</span>
      </div>
      <button
        type="button"
        className={styles.testButton}
        onClick={onTestClick}
        aria-label="Test"
        title="Run tests on current page"
      >
        <svg width="10" height="12" viewBox="0 0 10 12" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 1L9 6L1 11V1Z" fill="currentColor" />
        </svg>
        Test
      </button>
      <button
        type="button"
        className={styles.gearButton}
        onClick={onSettingsClick}
        aria-label="Settings"
        title="Settings"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M6.5 1.5L6.8 3.1C6.2 3.3 5.7 3.6 5.2 4L3.7 3.3L2.2 5.7L3.5 6.7C3.4 7.2 3.4 7.8 3.5 8.3L2.2 9.3L3.7 11.7L5.2 11C5.7 11.4 6.2 11.7 6.8 11.9L6.5 13.5H9.5L9.2 11.9C9.8 11.7 10.3 11.4 10.8 11L12.3 11.7L13.8 9.3L12.5 8.3C12.6 7.8 12.6 7.2 12.5 6.7L13.8 5.7L12.3 3.3L10.8 4C10.3 3.6 9.8 3.3 9.2 3.1L9.5 1.5H6.5Z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="8" cy="7.5" r="2" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
    </div>
  );
}
