import React, { useState } from 'react';
import type { ExtensionStatus } from '../hooks/useExtensionState';
import { CriteriaEditor } from './CriteriaEditor';
import { PresetSelector } from './PresetSelector';
import styles from './SettingsPanel.module.css';

interface SettingsPanelProps {
  onBack: () => void;
  onRunDemo: (criteria: string[]) => Promise<void>;
  demoRunning: boolean;
  connected: boolean;
  status: ExtensionStatus;
  hookConnected: boolean;
}

export function SettingsPanel({
  onBack,
  onRunDemo,
  demoRunning,
  connected,
  status,
  hookConnected,
}: SettingsPanelProps) {
  const [criteria, setCriteria] = useState<string[]>([]);

  const handleRunDemo = async () => {
    if (criteria.length > 0) {
      await onRunDemo(criteria);
    }
  };

  const getStatusLabel = () => {
    switch (status) {
      case 'recording': return 'Recording';
      case 'processing': return 'Processing';
      case 'error': return 'Error';
      default: return 'Idle';
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backButton} onClick={onBack} aria-label="Back to feed">
          {'\u2190'} Back
        </button>
        <h2 className={styles.title}>Settings</h2>
      </div>

      <div className={styles.content}>
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Manual Demo</h3>
          <p className={styles.sectionHint}>
            Run a demo on the current tab with custom criteria
          </p>
          <PresetSelector onSelect={setCriteria} />
          <CriteriaEditor criteria={criteria} onChange={setCriteria} />
          <button
            type="button"
            onClick={handleRunDemo}
            disabled={criteria.length === 0 || demoRunning}
            className={styles.runButton}
          >
            {demoRunning ? 'Running...' : 'Run Demo'}
          </button>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Status</h3>
          <div className={styles.statusGrid}>
            <span className={styles.statusLabel}>Extension:</span>
            <span className={styles.statusValue}>
              {connected ? getStatusLabel() : 'Disconnected'}
            </span>
            <span className={styles.statusLabel}>Hook:</span>
            <span className={styles.statusValue}>
              {hookConnected ? 'Connected' : 'Waiting for hook...'}
            </span>
          </div>
          <p className={styles.statusHint}>
            Demos run on the active tab. Make sure your app is open in Chrome before triggering a demo. You can set <code>baseUrl</code> in <code>popcorn.config.json</code> as a fallback.
          </p>
        </section>
      </div>
    </div>
  );
}
