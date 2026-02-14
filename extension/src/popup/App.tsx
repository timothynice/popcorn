import React, { useState, useEffect } from 'react';
import { StatusBar } from './components/StatusBar';
import { TestButtonArea } from './components/TestButtonArea';
import { TapeList } from './components/TapeList';
import { TapeDetail } from './components/TapeDetail';
import { SettingsPanel } from './components/SettingsPanel';
import { TestPanel } from './components/TestPanel';
import { PlansPanel } from './components/PlansPanel';
import { DemoProgress } from './components/DemoProgress';
import { useExtensionState } from './hooks/useExtensionState';
import { useTapes } from './hooks/useTapes';
import type { TestPlan, StartDemoMessage, ExplorationPlan } from '@popcorn/shared';
import { createMessage } from '@popcorn/shared';
import styles from './App.module.css';

type View = 'feed' | 'detail' | 'settings' | 'test' | 'plans';

function App() {
  const { status, connected, error: extensionError, hookConnected } = useExtensionState();
  const { tapes, isLoading, error: tapesError, selectedTapeId, selectTape, refresh: refreshTapes } = useTapes();
  const [currentView, setCurrentView] = useState<View>('feed');
  const [demoRunning, setDemoRunning] = useState(false);
  const [progressStep, setProgressStep] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [progressDescription, setProgressDescription] = useState('');

  const selectedTape = selectedTapeId
    ? tapes.find((tape) => tape.id === selectedTapeId)
    : null;

  // Sort tapes by timestamp descending (most recent first)
  const sortedTapes = [...tapes].sort((a, b) => b.timestamp - a.timestamp);

  // Listen for step_progress messages from background
  useEffect(() => {
    const listener = (message: Record<string, unknown>) => {
      if (message?.type === 'step_progress' && message.payload) {
        const p = message.payload as { stepNumber: number; totalSteps: number; description: string };
        setProgressStep(p.stepNumber);
        setProgressTotal(p.totalSteps);
        setProgressDescription(p.description);
      }
      if (message?.type === 'status_update') {
        const p = message.payload as { status: string };
        if (p.status === 'idle' || p.status === 'complete' || p.status === 'error') {
          setProgressStep(0);
          setProgressTotal(0);
          setProgressDescription('');
        }
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const handleTapeClick = (tapeId: string) => {
    selectTape(tapeId);
    setCurrentView('detail');
  };

  const handleBackToFeed = () => {
    selectTape(null);
    setCurrentView('feed');
  };

  /** Send start_demo and close popup immediately. */
  const sendStartDemo = async (plan: TestPlan | ExplorationPlan, demoCriteria: string[]) => {
    try {
      // ExplorationPlan has `targets`, TestPlan has `planName`
      const planName = 'planName' in plan ? plan.planName : `exploration-${plan.mode}`;
      const message = createMessage<StartDemoMessage>('start_demo', {
        testPlanId: planName,
        testPlan: plan as any, // background discriminates via 'targets' field
        acceptanceCriteria: demoCriteria,
        triggeredBy: 'popup',
      });
      // Fire-and-forget: don't await — background runs the demo async
      // and sendMessage won't resolve until the entire demo finishes
      chrome.runtime.sendMessage(message).catch(() => {});
      // Close popup immediately so it doesn't overlay screenshots
      window.close();
    } catch (err) {
      console.warn('[Popcorn] Demo send failed:', err);
    }
  };

  /** Re-run a tape with video recording from the list view. */
  const handleRerun = async (tapeId: string) => {
    try {
      await chrome.runtime.sendMessage({
        type: 'rerun_with_recording',
        payload: { tapeId },
      });
    } catch (err) {
      console.warn('[Popcorn] Re-run from card failed:', err);
    }
  };

  /** Run a plan from the PlansPanel (no criteria). */
  const handleRunPlanFromList = (plan: TestPlan) => {
    sendStartDemo(plan, []);
  };

  const renderContent = () => {
    if (currentView === 'test') {
      return (
        <TestPanel
          onBack={handleBackToFeed}
          onRunDemo={sendStartDemo}
          demoRunning={demoRunning}
        />
      );
    }

    if (currentView === 'settings') {
      return (
        <SettingsPanel
          onBack={handleBackToFeed}
          connected={connected}
          status={status}
          hookConnected={hookConnected}
        />
      );
    }

    if (currentView === 'plans') {
      return (
        <PlansPanel
          onBack={handleBackToFeed}
          hookConnected={hookConnected}
          onRunPlan={handleRunPlanFromList}
        />
      );
    }

    if (currentView === 'detail' && selectedTape) {
      return (
        <TapeDetail tape={selectedTape} onBack={handleBackToFeed} />
      );
    }

    // Check if the last error was about no web page open
    const showNoPageWarning = extensionError?.includes('No web page open');

    // Feed view (default)
    return (
      <div className={styles.feed}>
        <TestButtonArea onClick={() => setCurrentView('test')} />
        {status === 'recording' && progressTotal > 0 && (
          <DemoProgress
            currentStep={progressStep}
            totalSteps={progressTotal}
            stepDescription={progressDescription}
          />
        )}
        {showNoPageWarning && (
          <div className={styles.warningBanner}>
            <span className={styles.warningIcon}>!</span>
            <div className={styles.warningContent}>
              <p className={styles.warningTitle}>No app tab detected</p>
              <p className={styles.warningText}>
                Open your app in Chrome and keep its tab active before triggering a demo.
                Alternatively, set <code>baseUrl</code> in <code>popcorn.config.json</code> to auto-navigate.
              </p>
            </div>
          </div>
        )}
        <TapeList
          tapes={sortedTapes}
          isLoading={isLoading}
          error={tapesError}
          selectedTapeId={selectedTapeId}
          onSelectTape={handleTapeClick}
          onRerun={handleRerun}
        />
      </div>
    );
  };

  const showStatusBar = currentView !== 'settings' && currentView !== 'test' && currentView !== 'plans';

  return (
    <div className={styles.app}>
      {showStatusBar && (
        <StatusBar
          status={status}
          connected={connected}
          error={extensionError}
          hookConnected={hookConnected}
          onSettingsClick={() => setCurrentView('settings')}
          onPlansClick={() => setCurrentView('plans')}
          showBack={currentView === 'detail'}
          onBack={handleBackToFeed}
        />
      )}
      <main className={styles.main}>
        {renderContent()}
      </main>
    </div>
  );
}

export default App;
