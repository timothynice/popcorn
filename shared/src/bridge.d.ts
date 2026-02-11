/**
 * Message validation and serialization bridge between the hook and extension.
 * Provides schema validation, serialization helpers, and a handshake protocol.
 */
import type { PopcornMessage } from './messages.js';
export interface ValidationResult {
    valid: boolean;
    message?: PopcornMessage;
    error?: string;
}
/**
 * Validates an unknown value as a PopcornMessage.
 * Returns a typed result with either the validated message or an error.
 */
export declare function validateMessage(value: unknown): ValidationResult;
/**
 * Serializes a PopcornMessage to a JSON string.
 */
export declare function serializeMessage(msg: PopcornMessage): string;
/**
 * Deserializes a JSON string to a PopcornMessage.
 * Returns a ValidationResult.
 */
export declare function deserializeMessage(json: string): ValidationResult;
/**
 * Checks if a message type is a known Popcorn message type.
 */
export declare function isKnownMessageType(type: string): boolean;
//# sourceMappingURL=bridge.d.ts.map