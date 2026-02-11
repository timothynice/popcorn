import React from 'react';
import type { ExtensionStatus } from '../hooks/useExtensionState';
import styles from './StatusBar.module.css';

interface StatusBarProps {
  status: ExtensionStatus;
  connected: boolean;
  error: string | null;
}

export function StatusBar({ status, connected, error }: StatusBarProps) {
  const getStatusText = () => {
    if (error) return error;
    switch (status) {
      case 'idle':
        return 'Idle';
      case 'recording':
        return 'Recording demo...';
      case 'processing':
        return 'Processing results...';
      case 'error':
        return 'Error occurred';
      default:
        return 'Unknown';
    }
  };

  const getStatusClass = () => {
    if (error || status === 'error') return styles.statusError;
    if (status === 'recording') return styles.statusRecording;
    if (status === 'processing') return styles.statusProcessing;
    return styles.statusIdle;
  };

  return (
    <div className={styles.statusBar}>
      <div className={styles.statusSection}>
        <span className={`${styles.statusIndicator} ${getStatusClass()}`} />
        <span className={styles.statusText}>{getStatusText()}</span>
      </div>
      <div className={styles.connectionSection}>
        <span
          className={`${styles.connectionDot} ${
            connected ? styles.connectionConnected : styles.connectionDisconnected
          }`}
          title={connected ? 'Connected' : 'Disconnected'}
        />
      </div>
    </div>
  );
}
