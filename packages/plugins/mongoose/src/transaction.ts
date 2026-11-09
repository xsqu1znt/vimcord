import type { ClientSession, mongo } from "mongoose";

import { Vimcord } from "vimcord";
import { PLUGIN_NAME } from "./constants.js";
import { MongoosePlugin } from "./index.js";
import { MongoosePluginError } from "./MongoosePluginError.js";
import { sessionContext } from "./sessionContext.js";

/** The committed callback value or a message from an aborted transaction. */
export type TransactionResult<T> = { success: true; value: T } | { success: false; error: string };

/** An expected failure thrown inside a transaction so its writes roll back. */
export class TransactionAbort extends Error {}

/** Throws an expected failure; let it escape the transaction callback to roll back its writes. */
export function abort(message: string): never {
    throw new TransactionAbort(message);
}

/**
 * Runs a transaction and invalidates every written builder's cache after commit or rollback.
 * Builder calls use the session automatically; pass `{ session: null }` to run a call outside it.
 * Await all work started in the callback, because unawaited work keeps the session after it ends.
 * @param fn Callback receiving the transaction session; the driver may retry it
 * @param options MongoDB transaction options
 */
export async function useTransaction<T>(
    fn: (session: ClientSession) => Promise<T>,
    options?: mongo.TransactionOptions
): Promise<T> {
    const client = Vimcord.getInstance();
    if (!client) throw new MongoosePluginError("Vimcord client does not exist");
    const plugin = client.plugins.get<MongoosePlugin>(PLUGIN_NAME, true);
    const session = await plugin.mongoose.startSession();
    const context = { session, writtenCaches: new Set<() => void>() };
    try {
        return await session.withTransaction(() => sessionContext.run(context, () => fn(session)), options);
    } finally {
        for (const invalidate of context.writtenCaches) invalidate();
        await session.endSession();
    }
}

/**
 * Converts expected aborts to failed results after the transaction rejects and rolls back.
 * @param run Starts the whole transaction, e.g. `() => useTransaction(...)`.
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
