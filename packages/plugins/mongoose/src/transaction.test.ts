import type { ClientSession } from "mongoose";
import type { Vimcord } from "vimcord";
import type { TransactionResult } from "./index.js";

import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { abort, createMongoSchema, MongoosePlugin, TransactionAbort, tryTransaction } from "./index.js";
import { sessionContext } from "./sessionContext.js";

const plugin = new MongoosePlugin();
const Records = Object.assign(
    createMongoSchema("transactionRecords", {
        key: { type: String, required: true },
        count: { type: Number, default: 0 }
    }),
    { plugin, client: { logger: { plugin: { debug: () => {} } } } as unknown as Vimcord }
);
let replSet: MongoMemoryReplSet;

beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await plugin.mongoose.connect(replSet.getUri(), { dbName: "transactionHelpers" });
    await Records.create({ key: "init" });
}, 120_000);

beforeEach(async () => {
    await Records.deleteAll({});
    await Records.create({ key: "counter", count: 0 });
    vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

afterAll(async () => {
    await plugin.disconnect();
    await replSet.stop();
});

describe("transaction results", () => {
    it("throws a recognizable Error without returning from abort", () => {
        expectTypeOf(abort).returns.toBeNever();
        expect(() => abort("Expected failure")).toThrow(TransactionAbort);
        expect(new TransactionAbort("Expected failure")).toBeInstanceOf(Error);
    });

    it.each([undefined, null, false, 0, "", { count: 1 }])("preserves successful values: %j", async value => {
        const result = await tryTransaction(async () => value);
        expect(result).toEqual({ success: true, value });
        if (result.success) expect(result.value).toBe(value);
        expect(console.warn).not.toHaveBeenCalled();
    });

    it("infers and narrows the public result type", async () => {
        const result = await tryTransaction(async () => ({ count: 1 }));
        expectTypeOf(result).toEqualTypeOf<TransactionResult<{ count: number }>>();
        if (result.success) {
            expectTypeOf(result.value).toEqualTypeOf<{ count: number }>();
        } else {
            expectTypeOf(result.error).toBeString();
        }
    });

    it.each([undefined, "Fallback"])("keeps expected abort messages without logging (fallback: %j)", async fallback => {
        expect(await tryTransaction(async () => abort("Expected failure"), fallback)).toEqual({
            success: false,
            error: "Expected failure"
        });
        expect(console.warn).not.toHaveBeenCalled();
    });

    it.each([new Error("Unexpected failure"), null, undefined, "failure", { message: "failure" }])(
        "rethrows unexpected errors unchanged without a fallback: %j",
        async error => {
            await expect(
                tryTransaction(async () => {
                    throw error;
                })
            ).rejects.toBe(error);
            expect(console.warn).not.toHaveBeenCalled();
        }
    );

    it.each(["Could not complete the transaction.", ""])("logs the original error with fallback %j", async fallback => {
        const error = new Error("Unexpected failure");
        const result = await tryTransaction(async () => {
            throw error;
        }, fallback);
        expect(result).toEqual({ success: false, error: fallback });
        expect(console.warn).toHaveBeenCalledExactlyOnceWith(`Transaction failed: ${fallback}`, error);
    });
});

describe("transaction boundaries", () => {
    it("rolls back earlier writes before returning an expected failure and ends the session", async () => {
        let session: ClientSession | undefined;
        const run = vi.fn(async (s: ClientSession) => {
            session = s;
            expect(sessionContext.getStore()).toBe(s);
            await Records.updateOne({ key: "counter" }, { $inc: { count: 1 } });
            await Records.create({ key: "new" });
            expect(await Records.count()).toBe(2);
            abort("Business rule failed");
        });

        const result = await tryTransaction(() => Records.useTransaction(run), "Fallback");

        expect(result).toEqual({ success: false, error: "Business rule failed" });
        expect(run).toHaveBeenCalledOnce();
        expect(session?.hasEnded).toBe(true);
        expect(sessionContext.getStore()).toBeUndefined();
        expect(await Records.fetch({ key: "counter" })).toMatchObject({ count: 0 });
        expect(await Records.count({ key: "new" })).toBe(0);
        expect(console.warn).not.toHaveBeenCalled();
    });

    it.each(["builder", "plugin"] as const)("commits sequential writes and returns the %s callback value", async target => {
        let session: ClientSession | undefined;
        const value = { committed: true };
        const owner = target === "builder" ? Records : plugin;
        const result = await tryTransaction(() =>
            owner.useTransaction(async s => {
                session = s;
                await Records.updateOne({ key: "counter" }, { $inc: { count: 1 } });
                await Records.updateOne({ key: "counter" }, { $inc: { count: 1 } });
                return value;
            })
        );

        expect(result).toEqual({ success: true, value });
        if (result.success) expect(result.value).toBe(value);
        expect(session?.hasEnded).toBe(true);
        expect(sessionContext.getStore()).toBeUndefined();
        expect(await Records.fetch({ key: "counter" })).toMatchObject({ count: 2 });
    });

    it.each([undefined, "Fallback"])(
        "rolls back unexpected errors before propagating or returning fallback %j",
        async fallback => {
            const error = new Error("Unexpected failure");
            let session: ClientSession | undefined;
            const result = tryTransaction(
                () =>
                    plugin.useTransaction(async s => {
                        session = s;
                        await Records.updateOne({ key: "counter" }, { $inc: { count: 1 } });
                        throw error;
                    }),
                fallback
            );

            if (fallback === undefined) {
                await expect(result).rejects.toBe(error);
                expect(console.warn).not.toHaveBeenCalled();
            } else {
                expect(await result).toEqual({ success: false, error: fallback });
                expect(console.warn).toHaveBeenCalledExactlyOnceWith(`Transaction failed: ${fallback}`, error);
            }
            expect(session?.hasEnded).toBe(true);
            expect(sessionContext.getStore()).toBeUndefined();
            expect(await Records.fetch({ key: "counter" })).toMatchObject({ count: 0 });
        }
    );

    it.each([false, true])("preserves driver retries and the final outcome (abort: %j)", async shouldAbort => {
        let attempts = 0;
        let session: ClientSession | undefined;
        const result = await tryTransaction(
            () =>
                Records.useTransaction(async s => {
                    if (session) expect(s).toBe(session);
                    session = s;
                    expect(sessionContext.getStore()).toBe(s);
                    attempts++;
                    await Records.updateOne({ key: "counter" }, { $inc: { count: 1 } });
                    if (attempts === 1) {
                        throw new mongoose.mongo.MongoServerError({
                            message: "Retry this transaction",
                            errorLabels: ["TransientTransactionError"]
                        });
                    }
                    if (shouldAbort) abort("Retry no longer allowed");
                    return { attempts };
                }),
            "Fallback"
        );

        expect(attempts).toBe(2);
        expect(result).toEqual(
            shouldAbort ? { success: false, error: "Retry no longer allowed" } : { success: true, value: { attempts: 2 } }
        );
        expect(await Records.fetch({ key: "counter" })).toMatchObject({ count: shouldAbort ? 0 : 1 });
        expect(session?.hasEnded).toBe(true);
        expect(sessionContext.getStore()).toBeUndefined();
        expect(console.warn).not.toHaveBeenCalled();
    });

    it("restores an enclosing session after an aborted transaction", async () => {
        let outer: ClientSession | undefined;
        await plugin.useSession(async session => {
            outer = session;
            const result = await tryTransaction(() =>
                Records.useTransaction(async inner => {
                    expect(inner).not.toBe(session);
                    expect(sessionContext.getStore()).toBe(inner);
                    await Records.updateOne({ key: "counter" }, { $inc: { count: 1 } });
                    abort("Expected failure");
                })
            );

            expect(result).toEqual({ success: false, error: "Expected failure" });
            expect(sessionContext.getStore()).toBe(session);
            expect(session.hasEnded).toBe(false);
            expect(await Records.fetch({ key: "counter" })).toMatchObject({ count: 0 });
        });
        expect(outer?.hasEnded).toBe(true);
        expect(sessionContext.getStore()).toBeUndefined();
    });
});
