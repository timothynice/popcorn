import type { DemoResult } from './results.js';

export interface TapeRecord extends DemoResult {
  id: string;
  demoName: string;
  /** Object URL for video playback (created from stored Blob). */
  videoUrl?: string | null;
  /** Base64 data URL of a thumbnail screenshot. */
  thumbnailDataUrl?: string | null;
}
