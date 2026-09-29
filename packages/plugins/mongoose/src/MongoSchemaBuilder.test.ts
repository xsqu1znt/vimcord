import type { Vimcord } from "vimcord";

import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, expectTypeOf, it } from "vitest";
import { MongoosePlugin } from "./index.js";
import { createMongoSchema } from "./MongoSchemaBuilder.js";

const stubClient = { logger: { plugin: { debug: () => {} } } } as unknown as Vimcord;

const plugin = new MongoosePlugin();
let replSet: MongoMemoryReplSet;

/** Wires a builder to the test plugin so it can compile its model without a Vimcord client. */
function attach<B extends object>(builder: B): B {
    return Object.assign(builder, { client: stubClient, plugin });
}

const Cooldowns = attach(
    createMongoSchema("cooldowns", {
        key: { type: String, required: true, unique: true },
        until: { type: Number, default: 0 },
        hits: { type: Number, default: 0 }
    })
);

const CachedCooldowns = attach(
    createMongoSchema(
        "cachedCooldowns",
        { key: { type: String, required: true }, hits: { type: Number, default: 0 } },
        { cache: { key: "key", ttl: 60_000 } }
    )
);

/** Pipeline that takes the cooldown only when the stored one has expired, in a single atomic write. */
function acquire(now: number, ms: number) {
    return [{ $set: { until: { $cond: [{ $lte: ["$until", now] }, now + ms, "$until"] } } }];
}

const bump = [{ $set: { hits: { $add: [{ $ifNull: ["$hits", 0] }, 1] } } }];

beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await plugin.mongoose.connect(replSet.getUri(), { dbName: "test" });
    await Cooldowns.create({ key: "init" }); // Creates the collection, which a transaction can't do
    await Cooldowns.deleteAll({});
    await Cooldowns.model!.init(); // Builds the unique index the contention test relies on
}, 120_000);

afterAll(async () => {
    await plugin.disconnect();
    await replSet.stop();
});

beforeEach(async () => {
    await Cooldowns.deleteAll({});
    await CachedCooldowns.deleteAll({});
});

describe("update() with an aggregation pipeline", () => {
    it("computes the new value from the stored document and returns the updated one by default", async () => {
        await Cooldowns.create({ key: "a", hits: 4 });

        const result = await Cooldowns.update({ key: "a" }, bump);

        expect(result).toMatchObject({ key: "a", hits: 5 });
        expect(await Cooldowns.fetch({ key: "a" })).toMatchObject({ hits: 5 });
    });

    it("returns the updated document for an explicit `after`", async () => {
        await Cooldowns.create({ key: "a", hits: 4 });

        const result = await Cooldowns.update({ key: "a" }, bump, { returnDocument: "after" });

        expect(result?.hits).toBe(5);
    });

    it("returns the previous document for `before` while still applying the update", async () => {
        await Cooldowns.create({ key: "a", hits: 4 });

        const result = await Cooldowns.update({ key: "a" }, bump, { returnDocument: "before" });

        expect(result?.hits).toBe(4);
        expect(await Cooldowns.fetch({ key: "a" })).toMatchObject({ hits: 5 });
    });

    it("returns null when nothing matches and there is no upsert", async () => {
        expect(await Cooldowns.update({ key: "missing" }, bump)).toBeNull();
        expect(await Cooldowns.update({ key: "missing" }, bump, { returnDocument: "before" })).toBeNull();
        expect(await Cooldowns.count({ key: "missing" })).toBe(0);
    });

    it("returns a hydrated document for `lean: false`", async () => {
        await Cooldowns.create({ key: "a", hits: 4 });

        const result = await Cooldowns.update({ key: "a" }, bump, { lean: false, returnDocument: "before" });

        expect(typeof result?.save).toBe("function");
        expect(result?.hits).toBe(4);
    });
});

describe("update() upsert return modes", () => {
    it("returns the inserted document by default", async () => {
        const result = await Cooldowns.update({ key: "a" }, bump, { upsert: true });

        expect(result).toMatchObject({ key: "a", hits: 1 });
    });

    it("returns null for `before` when the upsert inserted, then the previous document afterwards", async () => {
        const inserted = await Cooldowns.update({ key: "a" }, bump, { upsert: true, returnDocument: "before" });
        expect(inserted).toBeNull();
        expect(await Cooldowns.fetch({ key: "a" })).toMatchObject({ hits: 1 });

        const previous = await Cooldowns.update({ key: "a" }, bump, { upsert: true, returnDocument: "before" });
        expect(previous?.hits).toBe(1);
        expect(await Cooldowns.fetch({ key: "a" })).toMatchObject({ hits: 2 });
    });

    it("lets exactly one of many concurrent attempts acquire a cooldown", async () => {
        const now = Date.now();

        const previous = await Promise.all(
            Array.from({ length: 20 }, () =>
                Cooldowns.update({ key: "a" }, acquire(now, 60_000), { upsert: true, returnDocument: "before" })
            )
        );

        // Acquired: no previous document (insert) or an expired one. Blocked: an active cooldown.
        const acquired = previous.filter(p => !p || p.until <= now);
        expect(acquired).toHaveLength(1);
        expect(await Cooldowns.fetch({ key: "a" })).toMatchObject({ until: now + 60_000 });
    });

    it("types nullability from `upsert` and `returnDocument`", async () => {
        const find = await Cooldowns.update({ key: "a" }, bump);
        const upsert = await Cooldowns.update({ key: "a" }, bump, { upsert: true });
        const upsertAfter = await Cooldowns.update({ key: "a" }, bump, { upsert: true, returnDocument: "after" });
        const upsertBefore = await Cooldowns.update({ key: "a" }, bump, { upsert: true, returnDocument: "before" });
        const before = await Cooldowns.update({ key: "a" }, bump, { returnDocument: "before" });

        expectTypeOf<null>().toExtend<typeof find>();
        expectTypeOf<null>().not.toExtend<typeof upsert>();
        expectTypeOf<null>().not.toExtend<typeof upsertAfter>();
        expectTypeOf<null>().toExtend<typeof upsertBefore>();
        expectTypeOf<null>().toExtend<typeof before>();
        expectTypeOf(upsert.hits).toBeNumber();
    });
});

describe("update() with an update object", () => {
    it("keeps returning the updated document by default", async () => {
        await Cooldowns.create({ key: "a", hits: 1 });

        expect(await Cooldowns.update({ key: "a" }, { $inc: { hits: 1 } })).toMatchObject({ hits: 2 });
    });

    it("honors `before` for an update object too", async () => {
        await Cooldowns.create({ key: "a", hits: 1 });

        const result = await Cooldowns.update({ key: "a" }, { $inc: { hits: 1 } }, { returnDocument: "before" });

        expect(result?.hits).toBe(1);
        expect(await Cooldowns.fetch({ key: "a" })).toMatchObject({ hits: 2 });
    });
});

describe("update() inside a transaction", () => {
    it("rolls back a pipeline upsert when the transaction throws", async () => {
        await expect(
            Cooldowns.useTransaction(async () => {
                const previous = await Cooldowns.update({ key: "a" }, bump, { upsert: true, returnDocument: "before" });
                expect(previous).toBeNull();
                expect(await Cooldowns.count({ key: "a" })).toBe(1); // Visible to the session that wrote it
                throw new Error("abort");
            })
        ).rejects.toThrow("abort");

        expect(await Cooldowns.count({ key: "a" })).toBe(0);
    });

    it("rolls back a pipeline update on an existing document", async () => {
        await Cooldowns.create({ key: "a", hits: 4 });

        await expect(
            Cooldowns.useTransaction(async () => {
                await Cooldowns.update({ key: "a" }, bump);
                throw new Error("abort");
            })
        ).rejects.toThrow("abort");

        expect(await Cooldowns.fetch({ key: "a" })).toMatchObject({ hits: 4 });
    });

    it("commits sequential pipeline updates that see each other's writes", async () => {
        const previous = await Cooldowns.useTransaction(async () => {
            await Cooldowns.update({ key: "a" }, bump, { upsert: true });
            return await Cooldowns.update({ key: "a" }, bump, { returnDocument: "before" });
        });

        expect(previous?.hits).toBe(1);
        expect(await Cooldowns.fetch({ key: "a" })).toMatchObject({ hits: 2 });
    });

    it("skips the transaction for `session: null`, so that write survives a rollback", async () => {
        await expect(
            Cooldowns.useTransaction(async () => {
                await Cooldowns.update({ key: "in" }, bump, { upsert: true });
                await Cooldowns.update({ key: "out" }, bump, { upsert: true, session: null });
                throw new Error("abort");
            })
        ).rejects.toThrow("abort");

        expect(await Cooldowns.count({ key: "in" })).toBe(0);
        expect(await Cooldowns.count({ key: "out" })).toBe(1);
    });
});

describe("update() cache invalidation", () => {
    it("drops the cached entry for the filter's cache key after a pipeline update", async () => {
        await CachedCooldowns.create({ key: "a", hits: 1 });
        await CachedCooldowns.create({ key: "b", hits: 1 });
        await CachedCooldowns.fetch({ key: "a" });
        await CachedCooldowns.fetch({ key: "b" });

        await CachedCooldowns.update({ key: "a" }, bump);
        // Written behind the cache's back: only `b`'s entry, which survives invalidation, hides it.
        await CachedCooldowns.model!.updateOne({ key: "b" }, { hits: 99 });

        expect(await CachedCooldowns.fetch({ key: "a" })).toMatchObject({ hits: 2 });
        expect(await CachedCooldowns.fetch({ key: "b" })).toMatchObject({ hits: 1 });
    });

    it("clears every entry when the filter is not a plain cache key lookup", async () => {
        await CachedCooldowns.create({ key: "a", hits: 1 });
        await CachedCooldowns.fetch({ key: "a" });

        await CachedCooldowns.update({ hits: 1 }, bump, { returnDocument: "before" });

        expect(await CachedCooldowns.fetch({ key: "a" })).toMatchObject({ hits: 2 });
    });
});
