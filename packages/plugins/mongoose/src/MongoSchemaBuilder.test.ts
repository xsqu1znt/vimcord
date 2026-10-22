import type { QueryOptions, Types } from "mongoose";
import type { Vimcord } from "vimcord";
import type { CreateDocument, InferDoc, InferHydratedDoc } from "./MongoSchemaBuilder.js";

import { MongoMemoryReplSet } from "mongodb-memory-server";
import { Document } from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
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

describe("hydrated timestamp inference", () => {
    it("keeps create().toObject() assignable to InferDoc without requiring generated or defaulted input fields", async () => {
        const builder = attach(
            createMongoSchema(
                "timestampedReleases",
                {
                    releaseId: { type: Number, required: true },
                    status: { type: String, enum: ["draft", "released"], required: true },
                    droppable: { type: Boolean, default: true },
                    name: { type: String, default: undefined },
                    cards: [{ name: String }]
                },
                { timestamps: true }
            )
        );
        const input = { releaseId: 1, status: "draft" } satisfies CreateDocument<typeof builder>;
        const doc = await builder.create(input);
        const plain = doc.toObject();

        expectTypeOf(doc).toEqualTypeOf<InferHydratedDoc<typeof builder>>();
        expectTypeOf(plain).toExtend<InferDoc<typeof builder>>();
        expectTypeOf(doc.createdAt).toEqualTypeOf<Date>();
        expectTypeOf(doc.updatedAt).toEqualTypeOf<Date>();
        expectTypeOf(plain.createdAt).toEqualTypeOf<Date>();
        expectTypeOf(plain.updatedAt).toEqualTypeOf<Date>();
        expectTypeOf(plain.status).toEqualTypeOf<"draft" | "released">();
        expectTypeOf(plain.droppable).toEqualTypeOf<boolean>();
        expectTypeOf(plain.name).toEqualTypeOf<string | null | undefined>();
        expect(plain).toMatchObject({ createdAt: expect.any(Date), updatedAt: expect.any(Date), droppable: true });

        doc.cards.push({ name: "card" });
        expectTypeOf(doc.cards[0]!.ownerDocument).toBeFunction();
        await doc.save();
        expect(doc.toObject().cards).toMatchObject([{ name: "card" }]);

        const [created] = await builder.create([{ releaseId: 2, status: "draft" }]);
        expectTypeOf(created!.toObject()).toExtend<InferDoc<typeof builder>>();
        expect(created!.createdAt).toBeInstanceOf(Date);
        const fetched = await builder.fetch({ releaseId: 1 }, undefined, { lean: false, required: true });
        expectTypeOf(fetched).toEqualTypeOf<InferHydratedDoc<typeof builder>>();
        expectTypeOf(fetched.toObject()).toExtend<InferDoc<typeof builder>>();
        expect(fetched.toObject().createdAt).toEqual(plain.createdAt);
    });

    it("uses configured timestamp names", async () => {
        const builder = attach(
            createMongoSchema(
                "renamedTimestamps",
                { key: String },
                { timestamps: { createdAt: "createdOn", updatedAt: "modifiedOn" } }
            )
        );
        const doc = await builder.create({ key: "a" });
        const plain = doc.toObject();

        expectTypeOf(doc.createdOn).toEqualTypeOf<Date>();
        expectTypeOf(doc.modifiedOn).toEqualTypeOf<Date>();
        expectTypeOf(plain).toExtend<InferDoc<typeof builder>>();
        expectTypeOf(plain).not.toHaveProperty("createdAt");
        expectTypeOf(plain).not.toHaveProperty("updatedAt");
        expect(plain).toMatchObject({ createdOn: expect.any(Date), modifiedOn: expect.any(Date) });
        expect(plain).not.toHaveProperty("createdAt");
        expect(plain).not.toHaveProperty("updatedAt");
    });

    it("keeps the default name for a timestamp omitted from the configuration", async () => {
        const builder = attach(
            createMongoSchema("partialTimestamps", { key: String }, { timestamps: { createdAt: "createdOn" } })
        );
        const doc = await builder.create({});
        const plain = doc.toObject();

        expectTypeOf(doc.createdOn).toEqualTypeOf<Date>();
        expectTypeOf(doc.updatedAt).toEqualTypeOf<Date>();
        expectTypeOf(plain.createdOn).toEqualTypeOf<Date>();
        expectTypeOf(plain.updatedAt).toEqualTypeOf<Date>();
        expectTypeOf(plain).toExtend<InferDoc<typeof builder>>();
        expectTypeOf<InferDoc<typeof builder>>().toHaveProperty("updatedAt").toEqualTypeOf<Date>();
        expect(plain).toMatchObject({ createdOn: expect.any(Date), updatedAt: expect.any(Date) });
    });

    it("omits an individually disabled timestamp", async () => {
        const builder = attach(
            createMongoSchema(
                "singleTimestamp",
                { key: String },
                { timestamps: { createdAt: false, updatedAt: "modifiedOn" } }
            )
        );
        const doc = await builder.create({});
        const plain = doc.toObject();

        expectTypeOf(doc.modifiedOn).toEqualTypeOf<Date>();
        expectTypeOf(doc).not.toHaveProperty("createdAt");
        expectTypeOf(plain.modifiedOn).toEqualTypeOf<Date>();
        expectTypeOf(plain).toExtend<InferDoc<typeof builder>>();
        expectTypeOf(plain).not.toHaveProperty("createdAt");
        expectTypeOf(plain).not.toHaveProperty("updatedAt");
        expect(plain.modifiedOn).toBeInstanceOf(Date);
        expect(plain).not.toHaveProperty("createdAt");
        expect(plain).not.toHaveProperty("updatedAt");
    });

    it.each([{}, { timestamps: false }] as const)("omits timestamps when not enabled: %j", async options => {
        const builder = attach(createMongoSchema(`noTimestamps${"timestamps" in options}`, { key: String }, options));
        const doc = await builder.create({});
        const plain = doc.toObject();

        expectTypeOf(doc).not.toHaveProperty("createdAt");
        expectTypeOf(doc).not.toHaveProperty("updatedAt");
        expectTypeOf(plain).toExtend<InferDoc<typeof builder>>();
        expectTypeOf(plain).not.toHaveProperty("createdAt");
        expectTypeOf(plain).not.toHaveProperty("updatedAt");
        expect(plain).not.toHaveProperty("createdAt");
        expect(plain).not.toHaveProperty("updatedAt");
    });
});

describe("distinct() schema paths", () => {
    it("infers nested values through optional objects and keeps filters", async () => {
        const builder = attach(
            createMongoSchema("distinctAssets", {
                active: Boolean,
                asset: { type: { imageUrl: String, metadata: { width: Number } }, required: false },
                tags: [String],
                uploadedAt: Date
            })
        );
        await builder.insertMany([
            { active: true, asset: { imageUrl: "a", metadata: { width: 100 } }, tags: ["a", "b"] },
            { active: true, asset: { imageUrl: "a", metadata: { width: 200 } }, tags: ["b"] },
            { active: false, asset: { imageUrl: "b" } },
            { active: true }
        ]);

        const urls = await builder.distinct("asset.imageUrl", { active: true });
        const widths = await builder.distinct("asset.metadata.width");
        const distinctTopLevel = <Path extends "tags" | "active">(path: Path) => builder.distinct(path);
        const tags = await distinctTopLevel("tags");
        const dates = await builder.distinct("uploadedAt");
        const ids = await builder.distinct("_id");

        expectTypeOf(urls).toEqualTypeOf<string[]>();
        expectTypeOf(widths).toEqualTypeOf<number[]>();
        expectTypeOf(tags).toEqualTypeOf<string[]>();
        expectTypeOf(dates).toEqualTypeOf<Date[]>();
        expectTypeOf(ids).toEqualTypeOf<Types.ObjectId[]>();
        expectTypeOf(() =>
            builder.distinct("asset.imageUrl" as "asset.imageUrl" | "asset.metadata.width")
        ).returns.resolves.toEqualTypeOf<(string | number)[]>();
        expect(urls).toEqual(["a"]);
        expect(widths).toEqual([100, 200]);
        expect(tags).toEqual(["a", "b"]);

        // These closures are type-checked without sending invalid paths to MongoDB.
        // @ts-expect-error Unknown nested field
        expectTypeOf(() => builder.distinct("asset.missing"));
        // @ts-expect-error Strings have no nested schema fields
        expectTypeOf(() => builder.distinct("asset.imageUrl.length"));
        // @ts-expect-error Date methods are not schema fields
        expectTypeOf(() => builder.distinct("uploadedAt.toISOString"));
        // @ts-expect-error ObjectId methods are not schema fields
        expectTypeOf(() => builder.distinct("_id.toHexString"));
        // @ts-expect-error Unknown top-level field
        expectTypeOf(() => builder.distinct("missing"));
        // @ts-expect-error Every member of a path union must be valid
        expectTypeOf(() => builder.distinct("asset.imageUrl" as "asset.imageUrl" | "asset.missing"));
    });

    it("infers distinct elements for dotted paths through document arrays", async () => {
        const builder = attach(
            createMongoSchema("distinctAssetArrays", {
                assets: [{ imageUrl: String, tags: [String] }]
            })
        );
        await builder.insertMany([
            {
                assets: [
                    { imageUrl: "a", tags: ["x", "y"] },
                    { imageUrl: "b", tags: ["x"] }
                ]
            },
            { assets: [{ imageUrl: "a", tags: ["z"] }] }
        ]);

        const urls = await builder.distinct("assets.imageUrl");
        const tags = await builder.distinct("assets.tags");

        expectTypeOf(urls).toEqualTypeOf<string[]>();
        expectTypeOf(tags).toEqualTypeOf<string[]>();
        expect(urls).toEqual(["a", "b"]);
        expect(tags).toEqual(["x", "y", "z"]);
        // @ts-expect-error Unknown document array field
        expectTypeOf(() => builder.distinct("assets.missing"));
        // @ts-expect-error Array properties are not schema fields
        expectTypeOf(() => builder.distinct("assets.length"));
    });
});

describe("update() and upsert() projections", () => {
    it.each([
        [undefined, ["_id", "key", "until", "hits"]],
        [{}, ["_id", "key", "until", "hits"]],
        [{ hits: 1 }, ["_id", "hits"]],
        [{ hits: 1, _id: 0 }, ["hits"]],
        [{ _id: 0, hits: 1 }, ["hits"]],
        [{ hits: true, _id: false }, ["hits"]],
        [{ key: 0 }, ["_id", "until", "hits"]],
        [{ key: 0, _id: 0 }, ["until", "hits"]],
        [{ _id: 0 }, ["key", "until", "hits"]],
        [{ _id: false }, ["key", "until", "hits"]],
        [{ _id: 1 }, ["_id"]],
        [{ hits: 1, _id: 1 }, ["_id", "hits"]],
        ["hits -_id", ["hits"]]
    ] as const)("preserves MongoDB's projection contract for %j", async (projection, keys) => {
        await Cooldowns.create({ key: "a", hits: 4 });

        for (const update of [{ $inc: { hits: 1 } }, bump]) {
            for (const lean of [true, false]) {
                const result = await Cooldowns.update({ key: "a" }, update, { projection, lean });
                const object = result instanceof Document ? result.toObject() : result;

                expect(Object.keys(object!).sort()).toEqual([...keys].sort());
            }
        }
        for (const lean of [true, false]) {
            const result = await Cooldowns.upsert({ key: "b" }, { hits: 4 }, { projection, lean });
            const object = result instanceof Document ? result.toObject() : result;

            expect(Object.keys(object).sort()).toEqual([...keys].sort());
        }
    });

    it("omits explicitly excluded _id from update and upsert types", async () => {
        const inserted = await Cooldowns.upsert({ key: "a" }, { hits: 4 }, { projection: { _id: 0, hits: 1 } });
        const updated = await Cooldowns.update({ key: "a" }, bump, { projection: { _id: 0 } });
        const before = await Cooldowns.update({ key: "a" }, bump, {
            projection: { _id: false, key: false },
            returnDocument: "before",
            lean: false
        });
        const upserted = await Cooldowns.update({ key: "b" }, bump, { projection: { _id: 0, hits: 1 }, upsert: true });
        const missing = await Cooldowns.update({ key: "missing" }, bump, {
            projection: { _id: 0 },
            upsert: true,
            returnDocument: "before"
        });

        expect(inserted).toEqual({ hits: 4 });
        expect(updated).toEqual({ key: "a", until: 0, hits: 5 });
        expect(before?.toObject()).toEqual({ until: 0, hits: 5 });
        expect(upserted).toEqual({ hits: 1 });
        expect(missing).toBeNull();
        expectTypeOf<null>().toExtend<typeof updated>();
        expectTypeOf<null>().not.toExtend<typeof upserted>();
        expectTypeOf<null>().toExtend<typeof missing>();
        expectTypeOf(inserted.hits).toBeNumber();
        expectTypeOf(before!.save).toBeFunction();
        expectTypeOf(upserted.hits).toBeNumber();
        // @ts-expect-error Explicit exclusion removes _id from the inferred result.
        expectTypeOf(inserted._id);
        // @ts-expect-error Explicit exclusion also applies to nullable update results.
        expectTypeOf(updated!._id);
        // @ts-expect-error Hydrated documents still respect explicit _id exclusion.
        expectTypeOf(before!._id);
        // @ts-expect-error Upserting through update() respects the same projection.
        expectTypeOf(upserted._id);
    });

    it("keeps _id types for default and inclusive projections and broadly typed options", async () => {
        await Cooldowns.create({ key: "a" });
        const options: QueryOptions = { projection: { _id: 0 } };
        const defaultResult = await Cooldowns.update({ key: "a" }, bump);
        const included = await Cooldowns.update({ key: "a" }, bump, { projection: { hits: 1 } });
        const excludedField = await Cooldowns.update({ key: "a" }, bump, { projection: { key: 0 } });
        const explicitId = await Cooldowns.update({ key: "a" }, bump, { projection: { _id: 1 } });
        const broad = await Cooldowns.update({ key: "a" }, bump, options);
        const upserted = await Cooldowns.upsert({ key: "b" }, { hits: 1 });

        expectTypeOf(defaultResult!._id).toEqualTypeOf<Types.ObjectId>();
        expectTypeOf(included!._id).toEqualTypeOf<Types.ObjectId>();
        expectTypeOf(excludedField!._id).toEqualTypeOf<Types.ObjectId>();
        expectTypeOf(explicitId!._id).toEqualTypeOf<Types.ObjectId>();
        expectTypeOf(broad!._id).toEqualTypeOf<Types.ObjectId>();
        expectTypeOf(upserted._id).toEqualTypeOf<Types.ObjectId>();
        expect(broad).not.toHaveProperty("_id");
    });

    it("preserves validation, sorting, and update middleware without running findOne middleware", async () => {
        const builder = attach(
            createMongoSchema(
                "projectedWrites",
                { key: String, hits: { type: Number, min: 0, default: 0 } },
                { leanByDefault: false }
            )
        );
        const found = vi.fn();
        const updated = vi.fn();
        builder.schema.pre("findOne", function () {
            found();
        });
        builder.schema.pre("findOneAndUpdate", function () {
            updated();
        });
        await builder.insertMany([
            { key: "a", hits: 1 },
            { key: "b", hits: 2 }
        ]);

        const result = await builder.update({}, { hits: 3 }, { projection: { key: 1, _id: 0 }, sort: { hits: -1 } });
        const upserted = await builder.upsert({ key: "c" }, { hits: 4 }, { projection: { hits: 1, _id: false } });

        expect(result?.toObject()).toEqual({ key: "b" });
        expect(upserted.toObject()).toEqual({ hits: 4 });
        expect(found).not.toHaveBeenCalled();
        expect(updated).toHaveBeenCalledTimes(2);
        expectTypeOf(result!.save).toBeFunction();
        expectTypeOf(upserted.save).toBeFunction();
        // @ts-expect-error Builder-default hydrated documents also exclude _id.
        expectTypeOf(result!._id);
        // @ts-expect-error Upsert preserves hydration and explicit _id exclusion.
        expectTypeOf(upserted._id);
        await expect(
            builder.update({ key: "a" }, { hits: -1 }, { runValidators: true, projection: { hits: 1, _id: 0 } })
        ).rejects.toThrow();
        expect(await builder.fetch({ key: "a" })).toMatchObject({ hits: 1 });
    });
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

describe("update cache invalidation", () => {
    it.each(["update", "upsert", "updateOne", "updateAll"] as const)(
        "%s preserves unrelated entries when the filter pins an unchanged cache key",
        async write => {
            await CachedCooldowns.insertMany([
                { key: "a", hits: 1 },
                { key: "b", hits: 1 }
            ]);
            const other = await CachedCooldowns.fetch({ key: "b" });

            for (const update of [{ hits: 2 }, { $set: { hits: 2 } }, { $inc: { hits: 1 } }]) {
                const previous = await CachedCooldowns.fetch({ key: "a" });
                const filter = { key: { $eq: "a" }, hits: previous!.hits };
                if (write === "update") await CachedCooldowns.update(filter, update);
                else if (write === "upsert") await CachedCooldowns.upsert(filter, update);
                else if (write === "updateOne") await CachedCooldowns.updateOne(filter, update);
                else await CachedCooldowns.updateAll(filter, update);
                const fresh = await CachedCooldowns.fetch({ key: "a" });
                expect(fresh).not.toBe(previous);
                expect(fresh?.hits).toBe("$inc" in update ? previous!.hits + 1 : 2);
                expect(await CachedCooldowns.fetch({ key: "b" })).toBe(other);
            }
        }
    );

    it.each([
        [bump],
        [[{ $addFields: { hits: 2 } }]],
        [[{ $unset: "hits" }, { $set: { hits: 2 } }]],
        [[{ $unset: ["hits"] }, { $set: { hits: 2 } }]]
    ])("preserves unrelated entries after a key-preserving pipeline update: %j", async update => {
        await CachedCooldowns.create({ key: "a", hits: 1 });
        await CachedCooldowns.create({ key: "b", hits: 1 });
        await CachedCooldowns.fetch({ key: "a" });
        const other = await CachedCooldowns.fetch({ key: "b" });

        await CachedCooldowns.update({ key: "a" }, update);

        expect(await CachedCooldowns.fetch({ key: "a" })).toMatchObject({ hits: 2 });
        expect(await CachedCooldowns.fetch({ key: "b" })).toBe(other);
    });

    it.each([{}, { hits: 1 }, { key: { $in: ["a"] } }, { $or: [{ key: "a" }] }])(
        "clears every entry when the filter does not pin a cache key: %j",
        async filter => {
            await CachedCooldowns.insertMany([
                { key: "a", hits: 1 },
                { key: "b", hits: 1 }
            ]);
            await CachedCooldowns.fetch({ key: "a" });
            const other = await CachedCooldowns.fetch({ key: "b" });

            await CachedCooldowns.update(filter, bump);

            expect(await CachedCooldowns.fetch({ key: "a" })).toMatchObject({ hits: 2 });
            expect(await CachedCooldowns.fetch({ key: "b" })).not.toBe(other);
        }
    );

    const keyChanges: Parameters<typeof CachedCooldowns.update>[1][] = [
        { key: "c" },
        { $set: { key: "c" } },
        { $unset: { key: 1 } },
        { $rename: { key: "hits" } },
        { $rename: { hits: "key" } },
        { $setOnInsert: { key: "c" } },
        [{ $set: { key: "c" } }],
        [{ $unset: "key" }],
        [{ $project: { hits: 1 } }],
        [{ $replaceWith: { key: "c", hits: 2 } }]
    ];
    it.each(keyChanges.map(update => [update] as const))(
        "clears every entry when an update may change the cache key: %j",
        async update => {
            await CachedCooldowns.insertMany([
                { key: "a", hits: 1 },
                { key: "b", hits: 1 }
            ]);
            await CachedCooldowns.fetch({ key: "a" });
            const other = await CachedCooldowns.fetch({ key: "b" });

            await CachedCooldowns.update({ key: "a" }, update);

            expect(await CachedCooldowns.fetch({ key: "b" })).not.toBe(other);
            expect(await CachedCooldowns.fetch({ key: "a" })).toEqual(
                await CachedCooldowns.model!.findOne({ key: "a" }).lean()
            );
        }
    );

    it("clears every entry for a collated update that can match a different cache key", async () => {
        await CachedCooldowns.create({ key: "a", hits: 1 });
        await CachedCooldowns.fetch({ key: "a" });

        await CachedCooldowns.update({ key: "A" }, { $inc: { hits: 1 } }, { collation: { locale: "en", strength: 2 } });

        expect(await CachedCooldowns.fetch({ key: "a" })).toMatchObject({ hits: 2 });
    });

    it.each(["update", "upsert", "updateOne", "updateAll"] as const)(
        "%s preserves an unrelated pending read",
        async write => {
            await CachedCooldowns.insertMany([
                { key: "a", hits: 1 },
                { key: "b", hits: 1 }
            ]);
            const model = CachedCooldowns.model!;
            const findOne = model.findOne.bind(model);
            let release!: () => void;
            let started!: () => void;
            const gate = new Promise<void>(r => (release = r));
            const ready = new Promise<void>(r => (started = r));
            const spy = vi.spyOn(model, "findOne").mockImplementationOnce((...args) => {
                const query = findOne(...args);
                const exec = query.exec.bind(query);
                vi.spyOn(query, "exec").mockImplementationOnce(async () => {
                    const result = await exec();
                    started();
                    await gate;
                    return result;
                });
                return query;
            });
            try {
                const pending = CachedCooldowns.fetch({ key: "b" });
                await ready;
                if (write === "update") await CachedCooldowns.update({ key: "a" }, { $inc: { hits: 1 } });
                else if (write === "upsert") await CachedCooldowns.upsert({ key: "a" }, { $inc: { hits: 1 } });
                else if (write === "updateOne") await CachedCooldowns.updateOne({ key: "a" }, { $inc: { hits: 1 } });
                else await CachedCooldowns.updateAll({ key: "a" }, { $inc: { hits: 1 } });
                spy.mockClear();
                const coalesced = CachedCooldowns.fetch({ key: "b" });
                release();
                const result = await pending;
                expect(await coalesced).toBe(result);
                expect(await CachedCooldowns.fetch({ key: "b" })).toBe(result);
                expect(spy).not.toHaveBeenCalled();
            } finally {
                release();
                spy.mockRestore();
            }
        }
    );

    it("clears every entry when an update changes a parent or child of a dotted cache key", async () => {
        const builder = attach(
            createMongoSchema(
                "nestedCacheKeys",
                { agency: { id: String }, hits: Number },
                { cache: { key: "agency.id", ttl: 60_000 } }
            )
        );
        await builder.insertMany([
            { agency: { id: "a" }, hits: 1 },
            { agency: { id: "b" }, hits: 1 }
        ]);
        const other = await builder.fetch({ "agency.id": "b" });
        await builder.update({ "agency.id": "a" }, { $set: { agency: { id: "c" } } });
        expect(await builder.fetch({ "agency.id": "a" })).toBeNull();
        expect(await builder.fetch({ "agency.id": "b" })).not.toBe(other);

        const cached = await builder.fetch({ "agency.id": "b" });
        await builder.update({ "agency.id": "c" }, [{ $set: { "agency.id.child": "d" } }]);
        expect(await builder.fetch({ "agency.id": "c" })).toBeNull();
        expect(await builder.fetch({ "agency.id": "b" })).not.toBe(cached);
    });
});

describe("bounded read cache", () => {
    it("does not refreeze cache hits or share populated/projection/option reads", async () => {
        await CachedCooldowns.create({ key: "a", hits: 1 });
        const first = await CachedCooldowns.fetch({ key: "a" });
        const freeze = vi.spyOn(Object, "freeze");
        expect(await CachedCooldowns.fetch({ key: "a" })).toBe(first);
        expect(freeze).not.toHaveBeenCalled();
        freeze.mockRestore();
        await CachedCooldowns.model!.updateOne({ key: "a" }, { hits: 2 });
        for (const opts of [{ populate: "key" }, { collation: { locale: "en" } }, { lean: {} }]) {
            expect(await CachedCooldowns.fetch({ key: "a" }, undefined, opts as QueryOptions)).toMatchObject({ hits: 2 });
        }
        expect(await CachedCooldowns.fetch({ key: "a" }, { hits: 1 })).toMatchObject({ hits: 2 });
    });

    it("evicts oldest insertions and expires one-time keys without another read", async () => {
        const builder = attach(
            createMongoSchema("bounded", { key: String }, { cache: { key: "key", ttl: 100, maxEntries: 2 } })
        );
        await builder.insertMany(["a", "b", "c"].map(key => ({ key })));
        for (const key of ["a", "b", "c"]) await builder.fetch({ key });
        const entries = Reflect.get(builder, "cacheEntries") as Map<string, unknown>;
        expect([...entries.keys()]).toEqual(["b", "c"]);
        await new Promise(r => setTimeout(r, 150));
        expect(entries.size).toBe(0);
    });

    it.each([
        "delete",
        "update",
        "upsert",
        "updateOne",
        "updateAll",
        "deleteAll",
        "bulkWrite",
        "bulkSave",
        "create",
        "insertMany"
    ] as const)("prevents a pending read from repopulating after %s and from deleting a newer pending read", async write => {
        await CachedCooldowns.create({ key: "a", hits: 1 });
        const model = CachedCooldowns.model!;
        const findOne = model.findOne.bind(model);
        let release!: () => void;
        let started!: () => void;
        const gate = new Promise<void>(r => (release = r));
        const ready = new Promise<void>(r => (started = r));
        const spy = vi.spyOn(model, "findOne").mockImplementationOnce((...args) => {
            const query = findOne(...args);
            const exec = query.exec.bind(query);
            vi.spyOn(query, "exec").mockImplementationOnce(async () => {
                const result = await exec();
                started();
                await gate;
                return result;
            });
            return query;
        });
        const old = CachedCooldowns.fetch({ key: "a" });
        await ready;
        if (write === "bulkWrite")
            await CachedCooldowns.bulkWrite([{ updateOne: { filter: { key: "a" }, update: { hits: 2 } } }]);
        else if (write === "bulkSave") {
            const doc = await CachedCooldowns.fetch({ key: "a" }, undefined, { lean: false, required: true });
            doc.hits = 2;
            await CachedCooldowns.bulkSave([doc]);
        } else if (write === "insertMany") await CachedCooldowns.insertMany([{ key: "b" }]);
        else if (write === "update") await CachedCooldowns.update({ key: "a" }, { hits: 2 });
        else if (write === "upsert") await CachedCooldowns.upsert({ key: "a" }, { hits: 2 });
        else if (write === "updateOne") await CachedCooldowns.updateOne({ key: "a" }, { hits: 2 });
        else if (write === "create") await CachedCooldowns.create({ key: "b" });
        else if (write === "updateAll") await CachedCooldowns.updateAll({}, { hits: 2 });
        else await CachedCooldowns[write]({ key: "a" });
        const fresh = CachedCooldowns.fetch({ key: "a" });
        release();
        expect(await old).toMatchObject({ hits: 1 });
        const result = await fresh;
        expect(await CachedCooldowns.fetch({ key: "a" })).toEqual(result);
        if (write === "delete" || write === "deleteAll") expect(result).toBeNull();
        else expect(result?.hits).toBe(write === "create" || write === "insertMany" ? 1 : 2);
        spy.mockRestore();
    });

    it("invalidates writes made by aggregation and by queries with failing post middleware", async () => {
        await CachedCooldowns.create({ key: "a", hits: 1 });
        await CachedCooldowns.fetch({ key: "a" });
        await CachedCooldowns.aggregate([
            { $set: { hits: 2 } },
            { $merge: { into: "cachedCooldowns", on: "_id", whenMatched: "replace" } }
        ]);
        expect(await CachedCooldowns.fetch({ key: "a" })).toMatchObject({ hits: 2 });
        const builder = attach(
            createMongoSchema("postMiddleware", { key: String, hits: Number }, { cache: { key: "key", ttl: 60_000 } })
        );
        builder.schema.post("updateMany", function () {
            throw new Error("post failed");
        });
        await builder.create({ key: "a", hits: 1 });
        await builder.fetch({ key: "a" });
        await expect(builder.updateAll({}, { hits: 2 })).rejects.toThrow("post failed");
        expect(await builder.fetch({ key: "a" })).toMatchObject({ hits: 2 });
    });

    it("invalidates both old and new keys when an update moves a document", async () => {
        await CachedCooldowns.create({ key: "a", hits: 1 });
        await CachedCooldowns.fetch({ key: "a" });
        await CachedCooldowns.update({ key: "a" }, { key: "b" });
        expect(await CachedCooldowns.fetch({ key: "a" })).toBeNull();
        expect(await CachedCooldowns.fetch({ key: "b" })).toMatchObject({ hits: 1 });
    });
});

describe("cursor pagination and explicit write APIs", () => {
    it.each([1, -1] as const)("pages through ties in direction %s without counting or skipping", async direction => {
        await Cooldowns.insertMany(Array.from({ length: 7 }, (_, i) => ({ key: String(i), hits: Math.floor(i / 3) })));
        const expected = await Cooldowns.fetchAll({}, undefined, { sort: { hits: direction, _id: direction } });
        const count = vi.spyOn(Cooldowns.model!, "countDocuments");
        const seen: string[] = [];
        let after: { value: unknown; id: (typeof expected)[0]["_id"] } | undefined;
        for (;;) {
            const result = await Cooldowns.paginateCursor({}, { path: "hits", direction, limit: 2, after });
            seen.push(...result.docs.map(d => d.key));
            if (!result.hasNext) break;
            after = result.nextCursor!;
        }
        expect(seen).toEqual(expected.map(d => d.key));
        expect(count).not.toHaveBeenCalled();
        count.mockRestore();
        const numbered = await Cooldowns.paginate({}, undefined, { page: 2, limit: 2 });
        expect(numbered).toMatchObject({ total: 7, pages: 4, hasNext: true });
    });

    it("uses stored sort values for hydrated cursors instead of transformed getters", async () => {
        const builder = attach(
            createMongoSchema("cursorGetters", {
                key: String,
                hits: { type: Number, get: (n: number) => n + 1000 }
            })
        );
        builder.schema.index({ hits: 1, _id: 1 });
        await builder.insertMany(Array.from({ length: 6 }, (_, i) => ({ key: String(i), hits: Math.floor(i / 2) })));
        const first = await builder.paginateCursor({}, { path: "hits", limit: 2, lean: false });
        expect(first.docs[0]?.hits).toBe(1000);
        expect(first.nextCursor?.value).toBe(0);
        const second = await builder.paginateCursor({}, { path: "hits", limit: 2, lean: false, after: first.nextCursor! });
        expect(second.docs.map(d => d.key)).toEqual(["2", "3"]);
        expect(second.nextCursor?.value).toBe(1);
        const last = await builder.paginateCursor({}, { path: "hits", limit: 2, lean: false, after: second.nextCursor! });
        expect(last.docs.map(d => d.key)).toEqual(["4", "5"]);
        expect(last.hasNext).toBe(false);
    });

    it("validates insertMany without save hooks and uses updateOne query middleware", async () => {
        const builder = attach(createMongoSchema("middleware", { key: { type: String, required: true } }));
        const saved = vi.fn();
        const inserted = vi.fn();
        const updated = vi.fn();
        builder.schema.pre("save", function () {
            saved();
        });
        builder.schema.pre("insertMany", function () {
            inserted();
        });
        builder.schema.pre("updateOne", function () {
            updated();
        });
        await builder.create({ key: "a" });
        await builder.insertMany([{ key: "b" }, { key: "c" }]);
        expect(saved).toHaveBeenCalledTimes(1);
        expect(inserted).toHaveBeenCalledTimes(1);
        await expect(builder.insertMany([{}])).rejects.toThrow();
        expect(await builder.count()).toBe(3);
        expect(await builder.updateOne({ key: "a" }, { key: "d" })).toMatchObject({ matchedCount: 1, modifiedCount: 1 });
        expect(updated).toHaveBeenCalledTimes(1);
    });

    it("runs save middleware on retries and does not retry a different unique index", async () => {
        const builder = attach(
            createMongoSchema("uniqueMiddleware", {
                key: { type: String, required: true, unique: true },
                other: { type: String, required: true, unique: true }
            })
        );
        const saves = vi.fn();
        builder.schema.pre("save", function () {
            saves();
        });
        await builder.create({ key: "taken", other: "taken" });
        await builder.model!.init();
        let attempt = 0;
        await builder.createUnique("key", { other: "new" }, () => (attempt++ ? "new" : "taken"));
        expect(saves).toHaveBeenCalledTimes(3);
        const generate = vi.fn(() => "free");
        await expect(builder.createUnique("key", { other: "taken" }, generate)).rejects.toMatchObject({
            code: 11000,
            keyPattern: { other: 1 }
        });
        expect(generate).toHaveBeenCalledOnce();
    });

    it("retries concurrent indexed collisions while preserving save middleware and other errors", async () => {
        const results = await Promise.all(
            Array.from({ length: 8 }, (_, i) => {
                let attempt = 0;
                return Cooldowns.createUnique("key", {}, () => (attempt++ ? `retry-${i}` : "collision"));
            })
        );
        expect(new Set(results.map(d => d.key)).size).toBe(8);
        expect(results.every(d => typeof d.save === "function")).toBe(true);
        await expect(Cooldowns.createUnique("key", {}, () => "collision", 0)).rejects.toMatchObject({ code: 11000 });
        await expect(Cooldowns.createUnique("key", {}, () => undefined as never)).rejects.toThrow();
    });

    it("does not retry a compound index containing the generated path", async () => {
        const builder = attach(createMongoSchema("compoundUnique", { key: String, guild: String }));
        builder.schema.index({ key: 1, guild: 1 }, { unique: true });
        await builder.create({ key: "taken", guild: "same" });
        await builder.model!.init();
        const generate = vi.fn(() => "taken");

        await expect(builder.createUnique("key", { guild: "same" }, generate)).rejects.toMatchObject({
            code: 11000,
            keyPattern: { key: 1, guild: 1 }
        });
        expect(generate).toHaveBeenCalledOnce();
    });
});
