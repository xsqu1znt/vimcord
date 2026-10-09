import type { Vimcord } from "vimcord";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoosePlugin } from "./index.js";

let firstPlugin: MongoosePlugin;
let secondPlugin: MongoosePlugin;
const LOG_ERROR = vi.fn();
let server: MongoMemoryServer;

function records() {
    return firstPlugin.mongoose.connection.db!.collection<{ _id: string; ranAt?: Date }>("_migrations");
}

beforeAll(async () => {
    server = await MongoMemoryServer.create();
}, 120_000);

beforeEach(async () => {
    firstPlugin = new MongoosePlugin();
    secondPlugin = new MongoosePlugin();
    await firstPlugin.mongoose.connect(server.getUri(), { dbName: "migrations" });
    await secondPlugin.mongoose.connect(server.getUri(), { dbName: "migrations" });
    Object.assign(firstPlugin, { client: { logger: { plugin: { error: LOG_ERROR } } } as unknown as Vimcord });
    Object.assign(secondPlugin, { client: firstPlugin.client });
    await records().deleteMany({});
    LOG_ERROR.mockClear();
});

afterEach(async () => {
    vi.restoreAllMocks();
    await firstPlugin.disconnect();
    await secondPlugin.disconnect();
});

afterAll(async () => {
    await server.stop();
});

describe("run-once migrations", () => {
    it("records completion in order, supplies the plugin, and skips ids across runners", async () => {
        const order: string[] = [];
        firstPlugin.defineMigration("first", async ctx => {
            expect(ctx).toBe(firstPlugin);
            expect(ctx.mongoose.connection.readyState).toBe(1);
            order.push("first");
        });
        firstPlugin.defineMigration("second", async () => {
            expect(await records().findOne({ _id: "first" })).toHaveProperty("ranAt");
            order.push("second");
        });
        await firstPlugin.runMigrations();
        await firstPlugin.runMigrations();
        const other = vi.fn(async () => {});
        secondPlugin.defineMigration("first", other);
        secondPlugin.defineMigration("second", other);
        await secondPlugin.runMigrations();
        expect(other).not.toHaveBeenCalled();
        expect(order).toEqual(["first", "second"]);
        expect(await records().findOne({ _id: "second" })).toMatchObject({ ranAt: expect.any(Date) });
    });

    it("claims atomically across connections and stops before later migrations when a claim is active", async () => {
        let started!: () => void;
        let finish!: () => void;
        const entered = new Promise<void>(r => {
            started = r;
        });
        const blocked = new Promise<void>(r => {
            finish = r;
        });
        const first = vi.fn(async () => {
            started();
            await blocked;
        });
        const second = vi.fn(async () => {});
        const later = vi.fn(async () => {});
        firstPlugin.defineMigration("contended", first);
        secondPlugin.defineMigration("contended", second);
        secondPlugin.defineMigration("later", later);
        const owner = firstPlugin.runMigrations();
        await entered;
        try {
            await expect(secondPlugin.runMigrations()).rejects.toThrow(/contended.*already running/);
            expect(second).not.toHaveBeenCalled();
            expect(later).not.toHaveBeenCalled();
            expect(await records().findOne({ _id: "contended" })).toEqual({ _id: "contended" });
        } finally {
            finish();
            await owner;
        }
        await secondPlugin.runMigrations();
        expect(first).toHaveBeenCalledOnce();
        expect(second).not.toHaveBeenCalled();
        expect(later).toHaveBeenCalledOnce();
    });

    it("releases a failed claim, logs and rejects, and retries without running later work early", async () => {
        const error = new Error("backfill failed");
        let shouldFail = true;
        const run = vi.fn(async () => {
            if (shouldFail) throw error;
        });
        const later = vi.fn(async () => {});
        firstPlugin.defineMigration("retry", run);
        firstPlugin.defineMigration("after-retry", later);
        await expect(firstPlugin.runMigrations()).rejects.toBe(error);
        expect(await records().findOne({ _id: "retry" })).toBeNull();
        expect(later).not.toHaveBeenCalled();
        expect(LOG_ERROR).toHaveBeenCalledWith("mongoose", "Migration 'retry' failed", error);

        shouldFail = false;
        await firstPlugin.runMigrations();
        expect(run).toHaveBeenCalledTimes(2);
        expect(later).toHaveBeenCalledOnce();
        expect(await records().findOne({ _id: "retry" })).toHaveProperty("ranAt");
    });

    it("rejects duplicate registrations and disconnected runners", async () => {
        const plugin = new MongoosePlugin();
        plugin.defineMigration("stable-id", async () => {});
        expect(() => plugin.defineMigration("stable-id", async () => {})).toThrow(/already registered/);
        await expect(plugin.runMigrations()).rejects.toThrow(/not connected/);
    });

    it("releases the claim when recording completion fails so a future runner can retry", async () => {
        const error = new Error("completion write failed");
        const run = vi.fn(async () => {});
        firstPlugin.defineMigration("completion", run);
        vi.spyOn(mongoose.mongo.Collection.prototype, "updateOne").mockRejectedValueOnce(error);

        await expect(firstPlugin.runMigrations()).rejects.toBe(error);
        expect(await records().findOne({ _id: "completion" })).toBeNull();
        await firstPlugin.runMigrations();
        expect(run).toHaveBeenCalledTimes(2);
        expect(await records().findOne({ _id: "completion" })).toHaveProperty("ranAt");
    });

    it("reports both errors if a failed migration's claim cannot be released", async () => {
        const error = new Error("migration failed");
        const cleanupError = new Error("cleanup failed");
        firstPlugin.defineMigration("cleanup", async () => {
            throw error;
        });
        vi.spyOn(mongoose.mongo.Collection.prototype, "deleteOne").mockRejectedValueOnce(cleanupError);

        await expect(firstPlugin.runMigrations()).rejects.toMatchObject({ errors: [error, cleanupError] });
        expect(await records().findOne({ _id: "cleanup" })).toEqual({ _id: "cleanup" });
    });
});
