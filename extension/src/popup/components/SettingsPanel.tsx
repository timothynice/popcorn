import React, { useState, useEffect } from 'react';
import type { ExtensionStatus } from '../hooks/useExtensionState';
import styles from './SettingsPanel.module.css';

interface SettingsPanelProps {
  onBack: () => void;
  connected: boolean;
  status: ExtensionStatus;
  hookConnected: boolean;
}

export function SettingsPanel({
  onBack,
  connected,
  status,
  hookConnected,
}: SettingsPanelProps) {
  const [tapeCount, setTapeCount] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [editingBaseUrl, setEditingBaseUrl] = useState(false);
  const [baseUrlValue, setBaseUrlValue] = useState('');
  const [navigateBackEnabled, setNavigateBackEnabled] = useState(true);
  const [loadingNavigateBack, setLoadingNavigateBack] = useState(true);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'get_tape_count' })
      .then((response) => {
        if (response?.count !== undefined) {
          setTapeCount(response.count);
        }
      })
      .catch(() => {
        // Background may not handle this yet
      });
  }, [clearing]);

  useEffect(() => {
    if (hookConnected) {
      setLoadingConfig(true);
      setConfigError(null);
      chrome.runtime.sendMessage({ type: 'get_config' })
        .then((response) => {
          if (response?.success && response.config) {
            setConfig(response.config);
            setBaseUrlValue(response.config.baseUrl || '');
          } else {
            setConfigError(response?.error || 'Failed to load config');
          }
        })
        .catch((err) => {
          setConfigError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          setLoadingConfig(false);
        });
    }
  }, [hookConnected]);

  useEffect(() => {
    chrome.storage.local.get('popcorn_navigate_back')
      .then((result) => {
        setNavigateBackEnabled(result.popcorn_navigate_back !== false);
      })
      .catch(() => {
        setNavigateBackEnabled(true);
      })
      .finally(() => {
        setLoadingNavigateBack(false);
      });
  }, []);

  const getStatusLabel = () => {
    switch (status) {
      case 'recording': return 'Recording';
      case 'processing': return 'Processing';
      case 'error': return 'Error';
      default: return 'Idle';
    }
  };

  const handleClearTapes = async () => {
    setClearing(true);
    try {
      await chrome.runtime.sendMessage({ type: 'clear_tapes' });
      setTapeCount(0);
    } catch {
      // ignore
    } finally {
      setClearing(false);
    }
  };

  const handleSaveBaseUrl = async () => {
    if (!config) return;

    const updatedConfig = { ...config, baseUrl: baseUrlValue };
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'set_config',
        payload: { config: updatedConfig },
      });
      if (response?.success) {
        setConfig(updatedConfig);
        setEditingBaseUrl(false);
      }
    } catch {
      // ignore
    }
  };

  const handleCancelBaseUrl = () => {
    setBaseUrlValue(config?.baseUrl || '');
    setEditingBaseUrl(false);
  };

  const handleNavigateBackToggle = async (enabled: boolean) => {
    setNavigateBackEnabled(enabled);
    try {
      await chrome.storage.local.set({ popcorn_navigate_back: enabled });
    } catch {
      setNavigateBackEnabled(!enabled);
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
        {/* Status */}
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
            Demos run on the active tab. Make sure your app is open in Chrome.
            You can set <code>baseUrl</code> in <code>popcorn.config.json</code> as a fallback.
          </p>
        </section>

        {/* Configuration */}
        {hookConnected && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Configuration</h3>
            {loadingConfig && (
              <p className={styles.configLoading}>Loading configuration...</p>
            )}
            {configError && (
              <p className={styles.configError}>{configError}</p>
            )}
            {config && !loadingConfig && (
              <div className={styles.configGrid}>
                <span className={styles.configLabel}>Watch Directory:</span>
                <code className={styles.configValue}>{config.watchDir || 'N/A'}</code>

                <span className={styles.configLabel}>Bridge Port:</span>
                <code className={styles.configValue}>{config.bridgePort || '7890'}</code>

                <span className={styles.configLabel}>Base URL:</span>
                <div className={styles.editableField}>
                  {editingBaseUrl ? (
                    <>
                      <input
                        type="text"
                        className={styles.configInput}
                        value={baseUrlValue}
                        onChange={(e) => setBaseUrlValue(e.target.value)}
                        placeholder="http://localhost:3000"
                      />
                      <div className={styles.editActions}>
                        <button className={styles.saveButton} onClick={handleSaveBaseUrl}>
                          Save
                        </button>
                        <button className={styles.cancelButton} onClick={handleCancelBaseUrl}>
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <code className={styles.configValue}>{config.baseUrl || '(not set)'}</code>
                      <button
                        className={styles.editButton}
                        onClick={() => setEditingBaseUrl(true)}
                      >
                        Edit
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Storage */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Storage</h3>
          <div className={styles.storageRow}>
            <span className={styles.storageLabel}>
              {tapeCount !== null ? `${tapeCount} tape${tapeCount !== 1 ? 's' : ''} saved` : 'Loading...'}
            </span>
            <button
              className={styles.clearButton}
              onClick={handleClearTapes}
              disabled={clearing || tapeCount === 0}
            >
              {clearing ? 'Clearing...' : 'Clear All Tapes'}
            </button>
          </div>
        </section>

        {/* Demo Behavior */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Demo Behavior</h3>
          <div className={styles.behaviorRow}>
            <label className={styles.toggleLabel}>
              <input
                type="checkbox"
                className={styles.toggleCheckbox}
                checked={navigateBackEnabled}
                disabled={loadingNavigateBack}
                onChange={(e) => handleNavigateBackToggle(e.target.checked)}
              />
              <span className={styles.toggleText}>
                Return to original page after demo
              </span>
            </label>
            <p className={styles.behaviorHint}>
              When enabled, the browser navigates back to where you were before the demo started.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
