import { useState, useEffect, useCallback, useRef } from 'react';
import type { TapeRecord as SharedTapeRecord } from '@popcorn/shared';
import { TapeStore } from '../../storage/tape-store.js';
import type { TapeRecord as StoredTapeRecord } from '../../storage/tape-store.js';

/** Track created object URLs so we can revoke them on cleanup. */
const activeObjectUrls = new Set<string>();

/** Map a stored tape record to the shape the popup components expect. */
function toSharedTapeRecord(stored: StoredTapeRecord): SharedTapeRecord {
  // Convert video blob to a playable object URL
  let videoUrl: string | null = null;
  if (stored.videoBlob) {
    videoUrl = URL.createObjectURL(stored.videoBlob);
    activeObjectUrls.add(videoUrl);
  }

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
    videoUrl,
    thumbnailDataUrl: stored.thumbnailDataUrl,
  };
}

/** Revoke all active object URLs to free memory. */
function revokeObjectUrls(): void {
  for (const url of activeObjectUrls) {
    URL.revokeObjectURL(url);
  }
  activeObjectUrls.clear();
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
      // Revoke previous object URLs before creating new ones
      revokeObjectUrls();
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
        // Auto-select the newly saved tape so the user sees the result immediately
        if (message.payload?.tapeId) {
          setSelectedTapeId(message.payload.tapeId);
        }
      }
    };
    chrome.runtime.onMessage.addListener(messageListener);

    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
      // Revoke all object URLs when the hook unmounts
      revokeObjectUrls();
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
