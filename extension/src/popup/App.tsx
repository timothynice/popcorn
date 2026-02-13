import React, { useState } from 'react';
import { StatusBar } from './components/StatusBar';
import { HeroCard } from './components/HeroCard';
import { TapeList } from './components/TapeList';
import { TapeDetail } from './components/TapeDetail';
import { SettingsPanel } from './components/SettingsPanel';
import { useExtensionState } from './hooks/useExtensionState';
import { useTapes } from './hooks/useTapes';
import type { TestPlan, StartDemoMessage } from '@popcorn/shared';
import { createMessage } from '@popcorn/shared';
import styles from './App.module.css';

type View = 'feed' | 'detail' | 'settings';

/** A minimal sample test plan used for quick demos from the popup. */
function buildQuickTestPlan(): TestPlan {
  return {
    planName: 'quick-demo',
    description: 'Quick demo from popup - captures a recording of the active tab',
    steps: [
      { stepNumber: 1, action: 'wait', description: 'Wait for page', condition: 'timeout', timeout: 500 },
      { stepNumber: 2, action: 'screenshot', description: 'Capture screenshot' },
    ],
  };
}

function App() {
  const { status, connected, error: extensionError, hookConnected } = useExtensionState();
  const { tapes, isLoading, error: tapesError, selectedTapeId, selectTape, refresh: refreshTapes } = useTapes();
  const [currentView, setCurrentView] = useState<View>('feed');
  const [demoRunning, setDemoRunning] = useState(false);

  const selectedTape = selectedTapeId
    ? tapes.find((tape) => tape.id === selectedTapeId)
    : null;

  // Sort tapes by timestamp descending (most recent first)
  const sortedTapes = [...tapes].sort((a, b) => b.timestamp - a.timestamp);
  const latestTape = sortedTapes[0] ?? null;
  const olderTapes = sortedTapes.slice(1);

  const handleTapeClick = (tapeId: string) => {
    selectTape(tapeId);
    setCurrentView('detail');
  };

  const handleBackToFeed = () => {
    selectTape(null);
    setCurrentView('feed');
  };

  /** Send start_demo and await the result. */
  const sendStartDemo = async (plan: TestPlan, demoCriteria: string[]) => {
    setDemoRunning(true);
    try {
      const message = createMessage<StartDemoMessage>('start_demo', {
        testPlanId: plan.planName,
        testPlan: plan,
        acceptanceCriteria: demoCriteria,
        triggeredBy: 'popup',
      });
      await chrome.runtime.sendMessage(message);
      refreshTapes();
    } catch (err) {
      console.warn('[Popcorn] Demo failed:', err);
    } finally {
      setDemoRunning(false);
    }
  };

  /** Run a manual demo with given criteria. */
  const handleRunManualDemo = async (criteria: string[]) => {
    const plan = buildQuickTestPlan();
    await sendStartDemo(plan, criteria);
  };

  const renderContent = () => {
    if (currentView === 'settings') {
      return (
        <SettingsPanel
          onBack={handleBackToFeed}
          onRunDemo={handleRunManualDemo}
          demoRunning={demoRunning}
          connected={connected}
          status={status}
          hookConnected={hookConnected}
        />
      );
    }

    if (currentView === 'detail' && selectedTape) {
      return (
        <TapeDetail tape={selectedTape} onBack={handleBackToFeed} />
      );
    }

    // Feed view (default)
    return (
      <div className={styles.feed}>
        {latestTape && (
          <HeroCard
            tape={latestTape}
            onClick={() => handleTapeClick(latestTape.id)}
          />
        )}
        <TapeList
          tapes={olderTapes}
          isLoading={isLoading}
          error={tapesError}
          selectedTapeId={selectedTapeId}
          onSelectTape={handleTapeClick}
        />
      </div>
    );
  };

  return (
    <div className={styles.app}>
      {currentView !== 'settings' && (
        <StatusBar
          status={status}
          connected={connected}
          error={extensionError}
          hookConnected={hookConnected}
          onSettingsClick={() => setCurrentView('settings')}
        />
      )}
      <main className={styles.main}>
        {renderContent()}
      </main>
    </div>
  );
}

export default App;
