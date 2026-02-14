import React, { useState, useEffect } from 'react';
import type { TestPlan, TestStep, BuildStepsMode } from '@popcorn/shared';
import { buildSteps } from '@popcorn/shared';
import type { DetectedElement } from '@popcorn/shared';
import { usePersistedCriteria } from '../hooks/usePersistedCriteria';
import { CriteriaEditor } from './CriteriaEditor';
import { PresetSelector } from './PresetSelector';
import styles from './TestPanel.module.css';

interface TestPanelProps {
  onBack: () => void;
  onRunDemo: (plan: TestPlan, criteria: string[]) => Promise<void>;
  demoRunning: boolean;
}

/** Type labels for display (singular → plural handled inline). */
const TYPE_LABELS: Record<string, string> = {
  form: 'form',
  input: 'input',
  button: 'button',
  link: 'link',
  select: 'dropdown',
  textarea: 'textarea',
  checkbox: 'checkbox',
};

interface ElementGroup {
  type: string;
  label: string;
  count: number;
  names: string[];
}

/** Group scanned elements by type with human-readable labels. */
function groupElements(elements: DetectedElement[]): ElementGroup[] {
  const groups = new Map<string, { count: number; names: string[] }>();

  for (const el of elements) {
    const existing = groups.get(el.type) || { count: 0, names: [] };
    existing.count++;
    // Collect labels/names for display (cap at 4 to avoid clutter)
    const name = el.label || el.name;
    if (name && existing.names.length < 4) {
      existing.names.push(name);
    }
    groups.set(el.type, existing);
  }

  return Array.from(groups.entries()).map(([type, { count, names }]) => ({
    type,
    label: TYPE_LABELS[type] || type,
    count,
    names,
  }));
}

/** Pluralize a word simply. */
function plural(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
}

export function TestPanel({ onBack, onRunDemo, demoRunning }: TestPanelProps) {
  const { criteria, setCriteria, loaded } = usePersistedCriteria();
  const [scanning, setScanning] = useState(true); // starts true — auto-scan on mount
  const [scanError, setScanError] = useState<string | null>(null);
  const [scannedElements, setScannedElements] = useState<DetectedElement[] | null>(null);
  const [generatedPlan, setGeneratedPlan] = useState<TestPlan | null>(null);
  const [mode, setMode] = useState<BuildStepsMode>('smart');
  const [baseUrl, setBaseUrl] = useState<string>('/');

  // Auto-scan on mount
  useEffect(() => {
    let cancelled = false;

    async function scan() {
      setScanning(true);
      setScanError(null);

      try {
        const response = await chrome.runtime.sendMessage({ type: 'scan_page' });
        if (cancelled) return;

        if (!response?.success) {
          setScanError(response?.error || 'Scan failed');
          return;
        }

        const elements: DetectedElement[] = response.elements || [];
        setScannedElements(elements);

        // Build test plan from scanned elements
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (cancelled) return;
        const url = tabs[0]?.url || '/';
        setBaseUrl(url);

        const steps = buildSteps(elements, url, mode);
        const plan: TestPlan = {
          planName: 'page-scan',
          description: 'Test plan generated from live DOM scan',
          baseUrl: url,
          steps,
          tags: ['auto-generated', 'page-scan'],
        };
        setGeneratedPlan(plan);
      } catch (err) {
        if (!cancelled) {
          setScanError(err instanceof Error ? err.message : 'Scan failed');
        }
      } finally {
        if (!cancelled) {
          setScanning(false);
        }
      }
    }

    scan();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rebuild plan when mode changes (without re-scanning)
  useEffect(() => {
    if (!scannedElements) return;
    const steps = buildSteps(scannedElements, baseUrl, mode);
    setGeneratedPlan({
      planName: 'page-scan',
      description: 'Test plan generated from live DOM scan',
      baseUrl,
      steps,
      tags: ['auto-generated', 'page-scan'],
    });
  }, [mode, scannedElements, baseUrl]);

  const handleRunDemo = async () => {
    const plan = generatedPlan || buildFallbackPlan();
    try {
      await onRunDemo(plan, criteria);
    } catch {
      // Error handling is in App.tsx
    }
  };

  const elementGroups = scannedElements ? groupElements(scannedElements) : [];

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backButton} onClick={onBack} aria-label="Back to feed">
          {'\u2190'} Back
        </button>
        <h2 className={styles.title}>Test</h2>
      </div>

      <div className={styles.content}>
        {/* Scan summary */}
        <section className={styles.section}>
          {scanning && (
            <p className={styles.scanningText}>Scanning page...</p>
          )}

          {scanError && (
            <p className={styles.errorText}>{scanError}</p>
          )}

          {!scanning && !scanError && scannedElements && elementGroups.length > 0 && (
            <div className={styles.summary}>
              <p className={styles.summaryTitle}>Found on this page:</p>
              <ul className={styles.summaryList}>
                {elementGroups.map((group) => (
                  <li key={group.type} className={styles.summaryItem}>
                    <span className={styles.summaryCount}>{group.count}</span>
                    <span className={styles.summaryType}>
                      {plural(group.label, group.count)}
                    </span>
                    {group.names.length > 0 && (
                      <span className={styles.summaryNames}>
                        {' \u2014 '}
                        {group.names.join(', ')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!scanning && !scanError && scannedElements && elementGroups.length === 0 && (
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>No interactive elements found.</p>
              <p className={styles.emptyHint}>Demo will capture a screenshot.</p>
            </div>
          )}
        </section>

        {/* Mode toggle */}
        {!scanning && scannedElements && scannedElements.length > 0 && (
          <div className={styles.modeToggle}>
            <button
              type="button"
              className={`${styles.modeOption} ${mode === 'smart' ? styles.modeActive : ''}`}
              onClick={() => setMode('smart')}
            >
              Smart
            </button>
            <button
              type="button"
              className={`${styles.modeOption} ${mode === 'exhaustive' ? styles.modeActive : ''}`}
              onClick={() => setMode('exhaustive')}
            >
              All Elements
            </button>
          </div>
        )}

        {/* Acceptance Criteria (collapsible) */}
        {loaded && !scanning && (
          <details className={styles.criteriaDetails}>
            <summary className={styles.criteriaSummary}>
              Criteria
              <span className={styles.optionalBadge}>optional</span>
            </summary>
            <div className={styles.criteriaContent}>
              <PresetSelector onSelect={setCriteria} />
              <CriteriaEditor criteria={criteria} onChange={setCriteria} />
            </div>
          </details>
        )}
      </div>

      {/* Fixed footer with Run Demo */}
      {!scanning && (
        <div className={styles.footer}>
          <button
            type="button"
            onClick={handleRunDemo}
            disabled={demoRunning}
            className={styles.runButton}
          >
            {demoRunning ? 'Running...' : '\u25B6 Start Test'}
          </button>
        </div>
      )}
    </div>
  );
}

/** Fallback plan when scan found nothing. */
function buildFallbackPlan(): TestPlan {
  return {
    planName: 'quick-demo',
    description: 'Quick demo from popup - captures a recording of the active tab',
    steps: [
      { stepNumber: 1, action: 'wait', description: 'Wait for page', condition: 'timeout', timeout: 500 } as TestStep,
      { stepNumber: 2, action: 'screenshot', description: 'Capture screenshot' } as TestStep,
    ],
  };
}
