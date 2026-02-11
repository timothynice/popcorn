import type { DemoResult, VideoMetadata } from '@popcorn/shared';

/**
 * A single tape entry representing a recorded demo session.
 */
export interface TapeRecord {
  id: string;
  demoName: string;
  testPlanId: string;
  timestamp: number;
  duration: number;
  fileSize: number;
  resolution: { width: number; height: number };
  status: 'complete' | 'partial' | 'error';
  passed: boolean;
  summary: string;
  videoBlob: Blob | null;
  thumbnailDataUrl: string | null;
  results: DemoResult;
}

/** Generate a unique ID for a tape record. */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// IndexedDB-backed TapeStore
// ---------------------------------------------------------------------------

/**
 * Persist tape records in IndexedDB so they survive page reloads and
 * extension restarts.
 *
 * Usage:
 * ```ts
 * const store = new TapeStore();
 * await store.init();
 * const id = await store.save({ ...tape });
 * const tapes = await store.list();
 * ```
 *
 * IndexedDB is not available in vitest/jsdom, so tests should use the
 * companion `MockTapeStore` (same interface, backed by an in-memory Map).
 */
export class TapeStore {
  private dbName = 'popcorn-tapes';
  private storeName = 'tapes';
  private db: IDBDatabase | null = null;

  /** Open (or create) the IndexedDB database. */
  async init(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('testPlanId', 'testPlanId', { unique: false });
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onerror = () => {
        reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`));
      };
    });
  }

  /**
   * Persist a new tape record.
   * @returns The generated `id` assigned to the record.
   */
  async save(tape: Omit<TapeRecord, 'id'>): Promise<string> {
    const db = this.requireDb();
    const id = generateId();
    const record: TapeRecord = { ...tape, id };

    return new Promise<string>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const request = store.add(record);

      request.onsuccess = () => resolve(id);
      request.onerror = () =>
        reject(new Error(`Failed to save tape: ${request.error?.message}`));
    });
  }

  /** Retrieve all tapes, sorted by timestamp descending (newest first). */
  async list(): Promise<TapeRecord[]> {
    const db = this.requireDb();

    return new Promise<TapeRecord[]>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const request = store.getAll();

      request.onsuccess = () => {
        const records: TapeRecord[] = request.result;
        records.sort((a, b) => b.timestamp - a.timestamp);
        resolve(records);
      };

      request.onerror = () =>
        reject(new Error(`Failed to list tapes: ${request.error?.message}`));
    });
  }

  /** Retrieve a single tape by ID, or `null` if not found. */
  async get(id: string): Promise<TapeRecord | null> {
    const db = this.requireDb();

    return new Promise<TapeRecord | null>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () =>
        reject(new Error(`Failed to get tape: ${request.error?.message}`));
    });
  }

  /** Delete a tape by ID. */
  async delete(id: string): Promise<void> {
    const db = this.requireDb();

    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () =>
        reject(new Error(`Failed to delete tape: ${request.error?.message}`));
    });
  }

  /** Return aggregate storage statistics. */
  async getStorageUsage(): Promise<{ count: number; totalSize: number }> {
    const tapes = await this.list();
    const totalSize = tapes.reduce((sum, t) => sum + t.fileSize, 0);
    return { count: tapes.length, totalSize };
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private requireDb(): IDBDatabase {
    if (!this.db) {
      throw new Error('TapeStore not initialized. Call init() first.');
    }
    return this.db;
  }
}

// ---------------------------------------------------------------------------
// In-memory mock (for tests that cannot use IndexedDB)
// ---------------------------------------------------------------------------

/**
 * Drop-in replacement for `TapeStore` that keeps everything in a `Map`.
 * Useful for unit tests running in Node / jsdom where IndexedDB is
 * unavailable.
 */
export class MockTapeStore {
  private records: Map<string, TapeRecord> = new Map();

  async init(): Promise<void> {
    // No-op -- nothing to initialise in memory
  }

  async save(tape: Omit<TapeRecord, 'id'>): Promise<string> {
    const id = generateId();
    const record: TapeRecord = { ...tape, id };
    this.records.set(id, record);
    return id;
  }

  async list(): Promise<TapeRecord[]> {
    const all = Array.from(this.records.values());
    all.sort((a, b) => b.timestamp - a.timestamp);
    return all;
  }

  async get(id: string): Promise<TapeRecord | null> {
    return this.records.get(id) ?? null;
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }

  async getStorageUsage(): Promise<{ count: number; totalSize: number }> {
    const tapes = await this.list();
    const totalSize = tapes.reduce((sum, t) => sum + t.fileSize, 0);
    return { count: tapes.length, totalSize };
  }
}
