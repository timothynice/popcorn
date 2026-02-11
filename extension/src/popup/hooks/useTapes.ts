import { useState, useEffect, useCallback } from 'react';
import type { TapeRecord as SharedTapeRecord } from '@popcorn/shared';
import { TapeStore } from '../../storage/tape-store.js';
import type { TapeRecord as StoredTapeRecord } from '../../storage/tape-store.js';

/** Map a stored tape record to the shape the popup components expect. */
function toSharedTapeRecord(stored: StoredTapeRecord): SharedTapeRecord {
  return {
    id: stored.id,
    demoName: stored.demoName,
    testPlanId: stored.testPlanId,
    passed: stored.passed,
    steps: stored.results.steps,
    summary: stored.summary,
    videoMetadata: stored.results.videoMetadata,
    screenshots: stored.results.screenshots,
    criteriaResults: stored.results.criteriaResults,
    duration: stored.duration,
    timestamp: stored.timestamp,
  };
}

const tapeStore = new TapeStore();
let storeReady = false;

async function ensureStore(): Promise<void> {
  if (!storeReady) {
    await tapeStore.init();
    storeReady = true;
  }
}

export function useTapes() {
  const [tapes, setTapes] = useState<SharedTapeRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTapeId, setSelectedTapeId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      await ensureStore();
      const stored = await tapeStore.list();
      setTapes(stored.map(toSharedTapeRecord));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tapes');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const selectTape = useCallback((id: string | null) => {
    setSelectedTapeId(id);
  }, []);

  const deleteTape = useCallback(async (id: string) => {
    try {
      await ensureStore();
      await tapeStore.delete(id);
      setTapes((prev) => prev.filter((t) => t.id !== id));
      if (selectedTapeId === id) {
        setSelectedTapeId(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete tape');
    }
  }, [selectedTapeId]);

  useEffect(() => {
    refresh();

    // Listen for new tape saves from the background script
    const messageListener = (message: any) => {
      if (message.type === 'tape_saved') {
        refresh();
      }
    };
    chrome.runtime.onMessage.addListener(messageListener);

    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, [refresh]);

  return {
    tapes,
    isLoading,
    error,
    refresh,
    selectedTapeId,
    selectTape,
    deleteTape,
  };
}
