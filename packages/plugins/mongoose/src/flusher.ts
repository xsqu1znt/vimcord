const FLUSH_EVERY_MS = 5_000; // Flushes every 5 seconds
const flushSubscriptions = new Map<string, () => number>();
let flushTimeout: NodeJS.Timeout | null = null;

function doFlush() {
    if (!flushSubscriptions.size) {
        if (flushTimeout) {
            clearTimeout(flushTimeout);
            flushTimeout = null;
        }
        return;
    }

    // Prevents immediately flushing on subscriber add
    if (!flushTimeout) {
        flushTimeout = setTimeout(doFlush, FLUSH_EVERY_MS);
    }

    for (const flush of flushSubscriptions.values()) {
        flush();
    }

    flushTimeout = setTimeout(doFlush, FLUSH_EVERY_MS);
}

export function subscribeToFlush(id: string, flush: () => number): void {
    flushSubscriptions.set(id, flush);
    if (!flushTimeout) doFlush();
}

export function unsubscribeFromFlush(id: string): void {
    flushSubscriptions.delete(id);
}
