import type { TestPlan } from './test-plan.js';
import type { DemoResult } from './results.js';

export interface StartDemoPayload {
  testPlanId: string;
  testPlan: TestPlan;
  acceptanceCriteria: string[];
  triggeredBy: string;
}

export interface DemoResultPayload extends DemoResult {}

export interface HookReadyPayload {
  hookVersion: string;
  watchDir: string;
}

export interface HookErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export interface StartDemoMessage {
  type: 'start_demo';
  payload: StartDemoPayload;
  timestamp: number;
}

export interface DemoResultMessage {
  type: 'demo_result';
  payload: DemoResultPayload;
  timestamp: number;
}

export interface HookReadyMessage {
  type: 'hook_ready';
  payload: HookReadyPayload;
  timestamp: number;
}

export interface ExtensionReadyMessage {
  type: 'extension_ready';
  payload: { extensionVersion: string };
  timestamp: number;
}

export interface HookErrorMessage {
  type: 'hook_error';
  payload: HookErrorPayload;
  timestamp: number;
}

export type PopcornMessage =
  | StartDemoMessage
  | DemoResultMessage
  | HookReadyMessage
  | ExtensionReadyMessage
  | HookErrorMessage;

export type PopcornMessageType = PopcornMessage['type'];

export function createMessage<T extends PopcornMessage>(
  type: T['type'],
  payload: T['payload'],
): T {
  return { type, payload, timestamp: Date.now() } as T;
}

export function isPopcornMessage(value: unknown): value is PopcornMessage {
  if (typeof value !== 'object' || value === null) return false;
  const msg = value as Record<string, unknown>;
  return (
    typeof msg.type === 'string' &&
    typeof msg.timestamp === 'number' &&
    typeof msg.payload === 'object' &&
    msg.payload !== null
  );
}
