import React, { useState } from 'react';
import { StatusBar } from './components/StatusBar';
import { TapeList } from './components/TapeList';
import { TapeDetail } from './components/TapeDetail';
import { CriteriaEditor } from './components/CriteriaEditor';
import { PresetSelector } from './components/PresetSelector';
import { useExtensionState } from './hooks/useExtensionState';
import { useTapes } from './hooks/useTapes';
import type { TestPlan, StartDemoMessage } from '@popcorn/shared';
import { createMessage } from '@popcorn/shared';
import styles from './App.module.css';

type View = 'tapes' | 'criteria';

/** A minimal sample test plan used for quick demos from the popup. */
function buildQuickTestPlan(pageUrl: string): TestPlan {
  return {
    planName: 'quick-demo',
    description: 'Quick demo from popup – captures a recording of the active tab',
    baseUrl: pageUrl,
    steps: [
      { stepNumber: 1, action: 'wait', description: 'Wait for page', condition: 'timeout', timeout: 500 },
      { stepNumber: 2, action: 'screenshot', description: 'Capture screenshot' },
    ],
  };
}

function App() {
  const { status, connected, error: extensionError } = useExtensionState();
  const { tapes, isLoading, error: tapesError, selectedTapeId, selectTape, refresh: refreshTapes } = useTapes();
  const [currentView, setCurrentView] = useState<View>('tapes');
  const [criteria, setCriteria] = useState<string[]>([]);
  const [demoRunning, setDemoRunning] = useState(false);
  const [demoResult, setDemoResult] = useState<{ passed: boolean; summary: string } | null>(null);

  const selectedTape = selectedTapeId
    ? tapes.find((tape) => tape.id === selectedTapeId)
    : null;

  /** Send a start_demo message to the background script. */
  const sendStartDemo = async (plan: TestPlan, demoCriteria: string[]) => {
    setDemoRunning(true);
    setDemoResult(null);

    try {
      const message = createMessage<StartDemoMessage>('start_demo', {
        testPlanId: plan.planName,
        testPlan: plan,
        acceptanceCriteria: demoCriteria,
        triggeredBy: 'popup',
      });

      const response = await chrome.runtime.sendMessage(message);

      if (response?.success && response.result?.payload) {
        const result = response.result.payload;
        setDemoResult({ passed: result.passed, summary: result.summary });
      } else if (response?.success && response.result) {
        setDemoResult({ passed: response.result.passed, summary: response.result.summary });
      } else {
        setDemoResult({ passed: false, summary: response?.error || 'Unknown error' });
      }

      // Refresh tapes list so the new tape shows up
      refreshTapes();
    } catch (err) {
      setDemoResult({
        passed: false,
        summary: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDemoRunning(false);
    }
  };

  /** Run demo with custom criteria from the Criteria view. */
  const handleRunDemo = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const pageUrl = tab?.url || 'about:blank';
    const plan = buildQuickTestPlan(pageUrl);
    await sendStartDemo(plan, criteria);
  };

  /** Quick demo: record the active tab for a few seconds. */
  const handleQuickDemo = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const pageUrl = tab?.url || 'about:blank';
    const plan = buildQuickTestPlan(pageUrl);
    await sendStartDemo(plan, ['All steps pass']);
  };

  const renderDemoResult = () => {
    if (!demoResult) return null;
    return (
      <div className={`${styles.demoResult} ${demoResult.passed ? styles.demoResultPassed : styles.demoResultFailed}`}>
        <span className={styles.demoResultIcon}>{demoResult.passed ? '\u2713' : '\u2717'}</span>
        <span className={styles.demoResultText}>{demoResult.summary}</span>
      </div>
    );
  };

  const renderCriteriaView = () => (
    <div className={styles.criteriaView}>
      <div className={styles.criteriaHeader}>
        <h2 className={styles.criteriaTitle}>Test Criteria</h2>
        <p className={styles.criteriaSubtitle}>
          Define what should be validated during the demo
        </p>
      </div>
      <div className={styles.criteriaContent}>
        <PresetSelector onSelect={setCriteria} />
        <CriteriaEditor criteria={criteria} onChange={setCriteria} />
        {renderDemoResult()}
        <button
          type="button"
          onClick={handleRunDemo}
          disabled={criteria.length === 0 || demoRunning}
          className={styles.runButton}
        >
          {demoRunning ? 'Running...' : 'Run Demo'}
        </button>
      </div>
    </div>
  );

  return (
    <div className={styles.app}>
      <StatusBar status={status} connected={connected} error={extensionError} />
      <nav className={styles.nav}>
        <button
          type="button"
          onClick={() => setCurrentView('tapes')}
          className={`${styles.navButton} ${currentView === 'tapes' ? styles.navButtonActive : ''}`}
        >
          Tapes
        </button>
        <button
          type="button"
          onClick={() => setCurrentView('criteria')}
          className={`${styles.navButton} ${currentView === 'criteria' ? styles.navButtonActive : ''}`}
        >
          Criteria
        </button>
      </nav>
      <main className={styles.main}>
        {currentView === 'criteria' ? (
          renderCriteriaView()
        ) : selectedTape ? (
          <TapeDetail tape={selectedTape} onBack={() => selectTape(null)} />
        ) : (
          <>
            <div className={styles.quickDemoBar}>
              {renderDemoResult()}
              <button
                type="button"
                onClick={handleQuickDemo}
                disabled={demoRunning}
                className={styles.quickDemoButton}
              >
                {demoRunning ? 'Recording...' : '\u25CF Record Demo'}
              </button>
            </div>
            <TapeList
              tapes={tapes}
              isLoading={isLoading}
              error={tapesError}
              selectedTapeId={selectedTapeId}
              onSelectTape={selectTape}
            />
          </>
        )}
      </main>
    </div>
  );
}

export default App;
