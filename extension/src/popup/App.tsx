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
function buildQuickTestPlan(): TestPlan {
  return {
    planName: 'quick-demo',
    description: 'Quick demo from popup – captures a recording of the active tab',
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
  const [demoStarting, setDemoStarting] = useState(false);
  const [demoResult, setDemoResult] = useState<{ passed: boolean; summary: string } | null>(null);

  const selectedTape = selectedTapeId
    ? tapes.find((tape) => tape.id === selectedTapeId)
    : null;

  /** Build and send a start_demo message to the background script. */
  const buildDemoMessage = (plan: TestPlan, demoCriteria: string[]) => {
    return createMessage<StartDemoMessage>('start_demo', {
      testPlanId: plan.planName,
      testPlan: plan,
      acceptanceCriteria: demoCriteria,
      triggeredBy: 'popup',
    });
  };

  /** Send start_demo and await the result (used from Criteria view). */
  const sendStartDemo = async (plan: TestPlan, demoCriteria: string[]) => {
    setDemoRunning(true);
    setDemoResult(null);

    try {
      const message = buildDemoMessage(plan, demoCriteria);
      const response = await chrome.runtime.sendMessage(message);

      if (response?.success && response.result?.payload) {
        const result = response.result.payload;
        setDemoResult({ passed: result.passed, summary: result.summary });
      } else if (response?.success && response.result) {
        setDemoResult({ passed: response.result.passed, summary: response.result.summary });
      } else {
        setDemoResult({ passed: false, summary: response?.error || 'Unknown error' });
      }

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
    const plan = buildQuickTestPlan();
    await sendStartDemo(plan, criteria);
  };

  /** Quick demo: shows a brief message, then fires recording.
   *  The popup will close when recording starts (Chrome behavior)
   *  but the extension icon badge shows recording progress. */
  const handleQuickDemo = () => {
    setDemoStarting(true);
    setDemoResult(null);

    // Show the starting message briefly, then send the actual message.
    // The popup will close when the offscreen document is created.
    setTimeout(() => {
      const plan = buildQuickTestPlan();
      const message = buildDemoMessage(plan, ['All steps pass']);
      chrome.runtime.sendMessage(message).catch((err) => {
        console.warn('[Popcorn] Failed to start demo:', err);
      });
    }, 1500);
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
              {demoStarting ? (
                <div className={styles.demoStartingMessage}>
                  <span className={styles.demoStartingDot} />
                  <span>Recording Starting, Popup Closing</span>
                </div>
              ) : (
                renderDemoResult()
              )}
              <button
                type="button"
                onClick={handleQuickDemo}
                disabled={demoRunning || demoStarting}
                className={styles.quickDemoButton}
              >
                {demoStarting ? 'Starting...' : demoRunning ? 'Recording...' : '\u25CF Record Demo'}
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
