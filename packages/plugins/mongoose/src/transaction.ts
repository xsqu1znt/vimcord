import type { ClientSession, mongo } from "mongoose";

import { Vimcord } from "vimcord";
import { PLUGIN_NAME } from "./constants.js";
import { MongoosePlugin } from "./index.js";
import { MongoosePluginError } from "./MongoosePluginError.js";
import { sessionContext } from "./sessionContext.js";

/** The committed callback value or a message from an aborted transaction. */
export type TransactionResult<T> =
    | {
          /** Whether the transaction committed successfully. */
          success: true;
          /** The callback's return value. */
          value: T;
      }
    | {
          /** Whether the transaction committed successfully. */
          success: false;
          /** The abort message. */
          error: string;
      };

/** An expected failure thrown inside a transaction so its writes roll back. */
export class TransactionAbort extends Error {}

/** Throws an expected failure; let it escape the transaction callback to roll back its writes. */
export function abort(message: string): never {
    throw new TransactionAbort(message);
}

/**
 * Runs a transaction with an inherited builder session and invalidates written caches after commit or rollback.
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

/**
 * Runs a transaction and returns its result, turning `abort()` into `{ success: false }`. The default choice; it equals `tryTransaction(() => useTransaction(fn))`.
 * @param fn Callback receiving the transaction session; the driver may retry it
 */
export function transaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<TransactionResult<T>> {
    return tryTransaction(() => useTransaction(fn));
}
