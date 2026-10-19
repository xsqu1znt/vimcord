/** The committed callback value or a message from an aborted transaction. */
export type TransactionResult<T> = { success: true; value: T } | { success: false; error: string };

/** An expected failure thrown inside a transaction so its writes roll back. */
export class TransactionAbort extends Error {}

/** Throws an expected failure; let it escape the transaction callback to roll back its writes. */
export function abort(message: string): never {
    throw new TransactionAbort(message);
}

/**
 * Converts expected aborts to failed results after the transaction rejects and rolls back.
 * @param run Starts the whole transaction, e.g. `() => Records.useTransaction(...)`.
 * @param fallback Message for unexpected errors, which are logged. Without it, unexpected errors rethrow.
 */
export async function tryTransaction<T>(run: () => Promise<T>, fallback?: string): Promise<TransactionResult<T>> {
    try {
        return { success: true, value: await run() };
    } catch (error) {
        if (error instanceof TransactionAbort) return { success: false, error: error.message };
        if (fallback === undefined) throw error;

        console.warn(`Transaction failed: ${fallback}`, error);
        return { success: false, error: fallback };
    }
}
