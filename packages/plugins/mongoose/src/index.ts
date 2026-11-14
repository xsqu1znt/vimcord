import type { ConnectOptions } from "mongoose";
import type { HealthProbeResult, VimcordPluginContext } from "vimcord";

import mongoose from "mongoose";
import { getPackageVersion, Vimcord, VimcordPlugin } from "vimcord";
import { PLUGIN_NAME } from "./constants.js";
import { isDuplicateKeyError } from "./isDuplicateKeyError.js";
import { MongoosePluginError } from "./MongoosePluginError.js";

export * from "./MongoSchemaBuilder.js";
export { isDuplicateKeyError } from "./isDuplicateKeyError.js";
export * from "./transaction.js";

interface MigrationRecord {
    _id: string;
    ranAt?: Date;
}

/** Connection URI and options for the plugin-owned Mongoose instance. */
export interface MongooseOptions {
    /** MongoDB URI used by the plugin-owned connection. @default MONGO_URI_DEV in dev mode, otherwise MONGO_URI */
    uri?: string;
    /** Options passed directly to mongoose.connect(). */
    connectOptions?: ConnectOptions;
}

const PLUGIN_DESCRIPTION = "Provides an opinionated wrapper over Mongoose for interacting with MongoDB.";
const PLUGIN_VERSION = getPackageVersion("@vimcord/plugin-mongoose", "packages/plugins/mongoose") ?? "unknown";

/** Retries `fn` with exponential backoff and jitter until `attempts` retries are exhausted. */
async function retryWithBackoff<T>(fn: () => Promise<T>, attempts: number): Promise<T> {
    let delay = 500;
    for (let remaining = attempts; ; remaining--) {
        try {
            return await fn();
        } catch (err) {
            if (remaining <= 0) throw err;
            await new Promise(resolve => setTimeout(resolve, delay + Math.random() * 200));
            delay *= 2;
        }
    }
}

/** Owns a Mongoose connection and runs registered startup migrations. */
export class MongoosePlugin extends VimcordPlugin {
    /** Name displayed in logs or command discovery. */
    override name = PLUGIN_NAME;
    /** Short description displayed to users or in discovery. */
    override description = PLUGIN_DESCRIPTION;
    /** Version displayed in logs and plugin discovery. */
    override version = PLUGIN_VERSION;

    /** Client that owns or runs this operation. */
    readonly client: Vimcord | null = null;
    /** Isolated Mongoose instance owned by this plugin. */
    readonly mongoose: mongoose.Mongoose;

    private readonly uri: string | undefined;
    private readonly connectOptions: ConnectOptions | undefined;
    private readonly migrations = new Map<string, (ctx: MongoosePlugin) => Promise<void>>();
    private migrationsFinished = false;
    private readonly onDisconnected = (): void => {
        this.client?.logger.plugin.log(this.name, "MongoDB disconnected");
    };
    private readonly onReconnected = (): void => {
        this.client?.logger.plugin.success(this.name, "MongoDB reconnected");
    };

    constructor(config: MongooseOptions = {}) {
        super();

        const { uri, connectOptions } = config;
        this.uri = uri;
        this.connectOptions = connectOptions;
        this.mongoose = new mongoose.Mongoose();
    }

    /** Acquires plugin resources during client login. */
    override async install({ client, health }: VimcordPluginContext): Promise<void> {
        (this as { client: Vimcord | null }).client = client;
        this.mongoose.connection.on("disconnected", this.onDisconnected);
        this.mongoose.connection.on("reconnected", this.onReconnected);
        await this.connect();
        health.register({
            id: "mongodb",
            label: "MongoDB",
            check: ({ signal }) => this.checkMongoHealth(signal)
        });
    }

    /** Releases resources acquired by the plugin. */
    override async uninstall(): Promise<void> {
        this.mongoose.connection.off("disconnected", this.onDisconnected);
        this.mongoose.connection.off("reconnected", this.onReconnected);
        this.migrationsFinished = false;
        await this.disconnect();
    }

    private async connect(): Promise<void> {
        if (!this.client) {
            throw new MongoosePluginError("Cannot connect to MongoDB: Plugin has not been installed yet");
        }

        const devMode = this.client.$devMode;
        const connectionUri = this.uri ?? (devMode ? process.env.MONGO_URI_DEV : process.env.MONGO_URI);
        if (!connectionUri) {
            throw new MongoosePluginError(
                `MONGO_URI Missing: ${devMode ? "DEV MODE is enabled, but MONGO_URI_DEV is not set" : "MONGO_URI not set"}`
            );
        }

        this.client.logger.plugin.log(this.name, "Connecting to MongoDB...");

        const MAX_RETRIES = 3;
        try {
            await retryWithBackoff(() => this.mongoose.connect(connectionUri, this.connectOptions), MAX_RETRIES);
            this.client.logger.plugin.success(this.name, "Connected to MongoDB");
        } catch (err) {
            this.client.logger.plugin.error(this.name, `Failed to connect after ${MAX_RETRIES} retries`, err as Error);
            throw new MongoosePluginError("MongoDB initial connection failed");
        }
    }

    private async checkMongoHealth(signal?: AbortSignal): Promise<HealthProbeResult> {
        if (signal?.aborted) return { status: "unavailable", detail: "Check cancelled" };
        if (this.mongoose.connection.readyState !== 1) {
            return { status: "unavailable", detail: "Not connected" };
        }

        const db = this.mongoose.connection.db;
        if (!db) return { status: "healthy" };

        const startedAt = performance.now();
        try {
            await db.admin().ping();
            return { status: "healthy", latencyMs: performance.now() - startedAt };
        } catch (error) {
            return {
                status: "unavailable",
                detail: error instanceof Error ? error.message : "Ping failed"
            };
        }
    }

    private async disconnect(): Promise<void> {
        await this.mongoose.disconnect();
    }

    /**
     * Registers a migration on this plugin instance, preserving registration order. Migrations run during `login()` before the gateway connects, so register them before calling it.
     * @param id Stable unique migration identifier
     * @param run Migration callback receiving this connected plugin
     */
    defineMigration(id: string, run: (ctx: MongoosePlugin) => Promise<void>): void {
        if (this.migrationsFinished) {
            throw new MongoosePluginError(`Migration '${id}' was registered after migrations ran; register it before login`);
        }
        if (!id.trim()) throw new MongoosePluginError("Migration id cannot be empty");
        if (this.migrations.has(id)) throw new MongoosePluginError(`Migration '${id}' is already registered`);
        this.migrations.set(id, run);
    }

    /** A duplicate _id is either completed work or an active claim; never advance past active work. */
    private async claimMigration(records: mongoose.mongo.Collection<MigrationRecord>, id: string): Promise<boolean> {
        for (;;) {
            try {
                await records.insertOne({ _id: id });
                return true;
            } catch (error) {
                if (!isDuplicateKeyError(error)) throw error;
                const record = await records.findOne({ _id: id });
                if (!record) continue; // The owning runner released a failed claim before this read.
                if (record.ranAt) return false;
                throw new MongoosePluginError(
                    `Migration '${id}' is already running; retry after the owning runner completes`
                );
            }
        }
    }

    private async runMigration(
        records: mongoose.mongo.Collection<MigrationRecord>,
        id: string,
        run: (ctx: MongoosePlugin) => Promise<void>
    ): Promise<void> {
        if (!(await this.claimMigration(records, id))) return;
        try {
            await run(this);
            await records.updateOne({ _id: id }, { $set: { ranAt: new Date() } });
        } catch (error) {
            try {
                await records.deleteOne({ _id: id, ranAt: { $exists: false } });
            } catch (cleanupError) {
                throw new AggregateError(
                    [error, cleanupError],
                    `Migration '${id}' failed and its claim could not be released`
                );
            }
            throw error;
        }
    }

    /** Runs registered migrations sequentially inside `login()`; completed ids are skipped. A failure aborts login. */
    override async onPluginsInstalled(): Promise<void> {
        if (!this.migrations.size) {
            this.migrationsFinished = true;
            return;
        }

        const db = this.mongoose.connection.db;
        if (this.mongoose.connection.readyState !== 1 || !db) {
            throw new MongoosePluginError("Cannot run migrations: MongoDB is not connected");
        }
        const records = db.collection<MigrationRecord>("_migrations");

        for (const [id, run] of this.migrations) {
            try {
                await this.runMigration(records, id, run);
            } catch (error) {
                this.client?.logger.plugin.error(this.name, `Migration '${id}' failed`, error);
                throw error;
            }
        }
        this.migrationsFinished = true;
    }
}
