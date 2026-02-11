/**
 * Message validation and serialization bridge between the hook and extension.
 * Provides schema validation, serialization helpers, and a handshake protocol.
 */

import type { PopcornMessage } from './messages.js';
import { isPopcornMessage } from './messages.js';

export interface ValidationResult {
  valid: boolean;
  message?: PopcornMessage;
  error?: string;
}

/**
 * Validates an unknown value as a PopcornMessage.
 * Returns a typed result with either the validated message or an error.
 */
export function validateMessage(value: unknown): ValidationResult {
  if (value === null || value === undefined) {
    return { valid: false, error: 'Message is null or undefined' };
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return validateMessage(parsed);
    } catch {
      return { valid: false, error: 'Message is not valid JSON' };
    }
  }

  if (typeof value !== 'object') {
    return { valid: false, error: `Expected object, got ${typeof value}` };
  }

  if (!isPopcornMessage(value)) {
    const msg = value as Record<string, unknown>;
    const missing: string[] = [];
    if (typeof msg.type !== 'string') missing.push('type (string)');
    if (typeof msg.timestamp !== 'number') missing.push('timestamp (number)');
    if (typeof msg.payload !== 'object' || msg.payload === null) missing.push('payload (object)');
    return {
      valid: false,
      error: `Invalid message structure. Missing: ${missing.join(', ')}`,
    };
  }

  return { valid: true, message: value };
}

/**
 * Serializes a PopcornMessage to a JSON string.
 */
export function serializeMessage(msg: PopcornMessage): string {
  return JSON.stringify(msg);
}

/**
 * Deserializes a JSON string to a PopcornMessage.
 * Returns a ValidationResult.
 */
export function deserializeMessage(json: string): ValidationResult {
  try {
    const parsed = JSON.parse(json);
    return validateMessage(parsed);
  } catch {
    return { valid: false, error: 'Failed to parse JSON' };
  }
}

/** Known message types for validation */
const KNOWN_TYPES = new Set([
  'start_demo',
  'demo_result',
  'hook_ready',
  'extension_ready',
  'hook_error',
]);

/**
 * Checks if a message type is a known Popcorn message type.
 */
export function isKnownMessageType(type: string): boolean {
  return KNOWN_TYPES.has(type);
}
