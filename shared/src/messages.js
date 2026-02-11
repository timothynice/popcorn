export function createMessage(type, payload) {
    return { type, payload, timestamp: Date.now() };
}
export function isPopcornMessage(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const msg = value;
    return (typeof msg.type === 'string' &&
        typeof msg.timestamp === 'number' &&
        typeof msg.payload === 'object' &&
        msg.payload !== null);
}
//# sourceMappingURL=messages.js.map