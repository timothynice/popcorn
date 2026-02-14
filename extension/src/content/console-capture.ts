import type { ConsoleLogEntry } from '@popcorn/shared';

type ConsoleLevel = 'log' | 'warn' | 'error' | 'info';

const LEVELS: ConsoleLevel[] = ['log', 'warn', 'error', 'info'];
const MAX_ENTRIES = 500;

function serializeArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

export class ConsoleCapture {
  private entries: ConsoleLogEntry[] = [];
  private originals = new Map<ConsoleLevel, (...args: unknown[]) => void>();
  private active = false;

  start(): void {
    if (this.active) return;
    this.entries = [];
    this.active = true;

    for (const level of LEVELS) {
      this.originals.set(level, console[level].bind(console));
      console[level] = (...args: unknown[]) => {
        // Pass through to original
        this.originals.get(level)!(...args);
        // Capture
        const message = args.map(serializeArg).join(' ');
        if (this.entries.length >= MAX_ENTRIES) {
          this.entries.shift();
        }
        this.entries.push({ level, message, timestamp: Date.now() });
      };
    }
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;

    for (const level of LEVELS) {
      const original = this.originals.get(level);
      if (original) {
        console[level] = original;
      }
    }
    this.originals.clear();
  }

  getLogsSince(timestamp: number): ConsoleLogEntry[] {
    return this.entries.filter((e) => e.timestamp >= timestamp);
  }
}
