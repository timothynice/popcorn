import { describe, it, expect, beforeEach } from 'vitest';
import type { DemoResult } from '@popcorn/shared';
import { MockTapeStore } from '../storage/tape-store.js';
import type { TapeRecord } from '../storage/tape-store.js';

// ---------------------------------------------------------------------------
// Helper: build a minimal DemoResult
// ---------------------------------------------------------------------------

function makeDemoResult(overrides: Partial<DemoResult> = {}): DemoResult {
  return {
    testPlanId: 'plan-1',
    passed: true,
    steps: [],
    summary: 'All steps passed',
    videoMetadata: null,
    screenshots: [],
    duration: 1.5,
    timestamp: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper: build a minimal TapeRecord (without `id`, since save() assigns it)
// ---------------------------------------------------------------------------

function makeTape(
  overrides: Partial<Omit<TapeRecord, 'id'>> = {},
): Omit<TapeRecord, 'id'> {
  return {
    demoName: 'login-flow',
    testPlanId: 'plan-1',
    timestamp: Date.now(),
    duration: 3.2,
    fileSize: 524_288,
    resolution: { width: 1920, height: 1080 },
    status: 'complete',
    passed: true,
    summary: 'Demo completed successfully.',
    videoBlob: new Blob(['video-data'], { type: 'video/webm' }),
    thumbnailDataUrl: 'data:image/png;base64,thumb',
    results: makeDemoResult(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TapeStore (MockTapeStore)', () => {
  let store: MockTapeStore;

  beforeEach(async () => {
    store = new MockTapeStore();
    await store.init();
  });

  // -- save ---------------------------------------------------------------

  it('save() stores a tape and returns a string id', async () => {
    const id = await store.save(makeTape());
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('save() assigns unique ids to different tapes', async () => {
    const id1 = await store.save(makeTape({ demoName: 'tape-1' }));
    const id2 = await store.save(makeTape({ demoName: 'tape-2' }));
    expect(id1).not.toBe(id2);
  });

  // -- get ----------------------------------------------------------------

  it('get() retrieves a saved tape by id', async () => {
    const tape = makeTape({ demoName: 'my-demo' });
    const id = await store.save(tape);

    const retrieved = await store.get(id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(id);
    expect(retrieved!.demoName).toBe('my-demo');
    expect(retrieved!.fileSize).toBe(tape.fileSize);
    expect(retrieved!.resolution).toEqual(tape.resolution);
  });

  it('get() returns null for non-existent id', async () => {
    const result = await store.get('does-not-exist');
    expect(result).toBeNull();
  });

  // -- list ---------------------------------------------------------------

  it('list() returns tapes sorted by timestamp descending', async () => {
    const now = Date.now();
    await store.save(makeTape({ demoName: 'oldest', timestamp: now - 2000 }));
    await store.save(makeTape({ demoName: 'newest', timestamp: now }));
    await store.save(makeTape({ demoName: 'middle', timestamp: now - 1000 }));

    const tapes = await store.list();
    expect(tapes).toHaveLength(3);
    expect(tapes[0].demoName).toBe('newest');
    expect(tapes[1].demoName).toBe('middle');
    expect(tapes[2].demoName).toBe('oldest');
  });

  it('list() returns empty array when store is empty', async () => {
    const tapes = await store.list();
    expect(tapes).toEqual([]);
  });

  // -- delete -------------------------------------------------------------

  it('delete() removes a tape by id', async () => {
    const id = await store.save(makeTape());
    expect(await store.get(id)).not.toBeNull();

    await store.delete(id);
    expect(await store.get(id)).toBeNull();
  });

  it('delete() is a no-op for non-existent id', async () => {
    // Should not throw
    await expect(store.delete('missing-id')).resolves.toBeUndefined();
  });

  it('delete() only removes the targeted tape', async () => {
    const id1 = await store.save(makeTape({ demoName: 'keep' }));
    const id2 = await store.save(makeTape({ demoName: 'remove' }));

    await store.delete(id2);

    const remaining = await store.list();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(id1);
    expect(remaining[0].demoName).toBe('keep');
  });

  // -- getStorageUsage ----------------------------------------------------

  it('getStorageUsage() returns correct count and total size', async () => {
    await store.save(makeTape({ fileSize: 1000 }));
    await store.save(makeTape({ fileSize: 2000 }));
    await store.save(makeTape({ fileSize: 3000 }));

    const usage = await store.getStorageUsage();
    expect(usage.count).toBe(3);
    expect(usage.totalSize).toBe(6000);
  });

  it('getStorageUsage() returns zeros for empty store', async () => {
    const usage = await store.getStorageUsage();
    expect(usage.count).toBe(0);
    expect(usage.totalSize).toBe(0);
  });

  // -- handles empty store ------------------------------------------------

  it('all operations work gracefully on a fresh (empty) store', async () => {
    const freshStore = new MockTapeStore();
    await freshStore.init();

    expect(await freshStore.list()).toEqual([]);
    expect(await freshStore.get('any-id')).toBeNull();
    await expect(freshStore.delete('any-id')).resolves.toBeUndefined();

    const usage = await freshStore.getStorageUsage();
    expect(usage.count).toBe(0);
    expect(usage.totalSize).toBe(0);
  });

  // -- data integrity -----------------------------------------------------

  it('stored tape contains all expected fields', async () => {
    const tape = makeTape({
      demoName: 'full-fields',
      testPlanId: 'plan-42',
      duration: 7.8,
      fileSize: 999_999,
      resolution: { width: 1280, height: 720 },
      status: 'partial',
      passed: false,
      summary: 'Partial recording',
      thumbnailDataUrl: null,
      videoBlob: null,
    });

    const id = await store.save(tape);
    const record = await store.get(id);

    expect(record).not.toBeNull();
    expect(record!.demoName).toBe('full-fields');
    expect(record!.testPlanId).toBe('plan-42');
    expect(record!.duration).toBe(7.8);
    expect(record!.fileSize).toBe(999_999);
    expect(record!.resolution).toEqual({ width: 1280, height: 720 });
    expect(record!.status).toBe('partial');
    expect(record!.passed).toBe(false);
    expect(record!.summary).toBe('Partial recording');
    expect(record!.thumbnailDataUrl).toBeNull();
    expect(record!.videoBlob).toBeNull();
    expect(record!.results).toBeDefined();
    expect(record!.results.testPlanId).toBe('plan-1');
  });
});
