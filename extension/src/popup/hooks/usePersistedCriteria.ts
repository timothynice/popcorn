import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'popcorn_criteria';

/**
 * Hook that persists criteria to chrome.storage.local.
 * Criteria survive popup close/reopen.
 */
export function usePersistedCriteria() {
  const [criteria, setCriteriaState] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Load criteria from storage on mount
  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const stored = result[STORAGE_KEY];
      if (Array.isArray(stored)) {
        setCriteriaState(stored);
      }
      setLoaded(true);
    });
  }, []);

  // Persist criteria to storage whenever they change (after initial load)
  const setCriteria = useCallback((newCriteria: string[]) => {
    setCriteriaState(newCriteria);
    chrome.storage.local.set({ [STORAGE_KEY]: newCriteria });
  }, []);

  return { criteria, setCriteria, loaded };
}
