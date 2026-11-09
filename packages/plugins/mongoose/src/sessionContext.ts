import type { ClientSession } from "mongoose";

import { AsyncLocalStorage } from "node:async_hooks";

interface TransactionContext {
    session: ClientSession;
    // Stable builder invalidators deduplicate writes across driver callback retries.
    writtenCaches: Set<() => void>;
}

export const sessionContext = new AsyncLocalStorage<TransactionContext>();
