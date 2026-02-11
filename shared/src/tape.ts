import type { DemoResult } from './results.js';

export interface TapeRecord extends DemoResult {
  id: string;
  demoName: string;
}
