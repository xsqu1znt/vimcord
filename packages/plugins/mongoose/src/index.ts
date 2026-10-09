import type { ClientSessionOptions, ConnectOptions } from "mongoose";
import type { HealthProbeResult, VimcordPluginContext } from "vimcord";

import mongoose from "mongoose";
import { getPackageVersion, Vimcord, VimcordPlugin } from "vimcord";
import { isDuplicateKeyError } from "./isDuplicateKeyError.js";
import { MongoosePluginError } from "./MongoosePluginError.js";
import { sessionContext } from "./sessionContext.js";

export * from "./MongoSchemaBuilder.js";
export { isDuplicateKeyError } from "./isDuplicateKeyError.js";

interface MigrationRecord {
    _id: string;
    ranAt?: Date;
}

export interface MongooseOptions extends mongoose.MongooseOptions {
    /**
     * The MongoDB connection URI.
     * @default process.env.MONGO_URI | process.env.MONGO_URI_DEV
     */
    uri?: string;
    /**
     * The maximum number of attempts to connect to MongoDB.
     * @default `3`
     */
    maxRetries?: number;
    /**
     * Options passed to `mongoose.connect()`, such as `dbName` and `maxPoolSize`.
     * For keys present in both option groups, the connect option wins over the global option.
     */
    connectOptions?: ConnectOptions;
    /** Throw during install when the initial connection fails, instead of starting without a database. @default true */
    requireConnection?: boolean;
}

export const PLUGIN_NAME = "mongoose";
export const PLUGIN_DESCRIPTION = "Provides an opinionated wrapper over Mongoose for interacting with MongoDB.";
export const PLUGIN_VERSION = getPackageVersion("@vimcord/plugin-mongoose", "packages/plugins/mongoose") ?? "unknown";

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

export class MongoosePlugin extends VimcordPlugin {
    override name = PLUGIN_NAME;
    override description = PLUGIN_DESCRIPTION;
    override version = PLUGIN_VERSION;

    readonly client: Vimcord | null = null;
    readonly mongoose: mongoose.Mongoose;

    private readonly uri: string | undefined;
    private readonly maxRetries: number;
    private readonly connectOptions: ConnectOptions | undefined;
    private readonly requireConnection: boolean;
    private connectingPromise: Promise<boolean> | null = null;
    private readonly migrations = new Map<string, (ctx: MongoosePlugin) => Promise<void>>();
    private readonly onDisconnected = (): void => {
        this.client?.logger.plugin.log(this.name, "MongoDB disconnected");
    };
    private readonly onReconnected = (): void => {
        this.client?.logger.plugin.success(this.name, "MongoDB reconnected");
    };

    constructor(config: MongooseOptions = {}) {
        super();

        const { uri, maxRetries = 3, connectOptions, requireConnection = true, ...mongooseOptions } = config;
        this.uri = uri;
        this.maxRetries = maxRetries;
        this.connectOptions = connectOptions;
        this.requireConnection = requireConnection;
        this.mongoose = new mongoose.Mongoose(mongooseOptions);
    }

    override async install({ client, health }: VimcordPluginContext): Promise<void> {
        (this as { client: Vimcord | null }).client = client;
        this.mongoose.connection.on("disconnected", this.onDisconnected);
        this.mongoose.connection.on("reconnected", this.onReconnected);
        const connected = await this.connectInternal();
        if (!connected && this.requireConnection) {
            throw new MongoosePluginError("MongoDB connection is required but the initial connection failed");
        }
        health.register({
            id: "mongodb",
            label: "MongoDB",
            check: ({ signal }) => this.checkMongoHealth(signal)
        });
    }

    override async uninstall(): Promise<void> {
        this.mongoose.connection.off("disconnected", this.onDisconnected);
        this.mongoose.connection.off("reconnected", this.onReconnected);
        await this.disconnect();
    }

    private async connectInternal(): Promise<boolean> {
        if (this.connectingPromise) {
            return this.connectingPromise;
        }

        this.connectingPromise = (async () => {
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

            try {
                await retryWithBackoff(() => this.mongoose.connect(connectionUri, this.connectOptions), this.maxRetries);

                this.client.logger.plugin.success(this.name, "Connected to MongoDB");
                return true;
            } catch (err) {
                this.client.logger.plugin.error(
                    this.name,
                    `Failed to connect: max attempt${this.maxRetries === 1 ? "" : "s"} (${this.maxRetries}) reached`,
                    err as Error
                );
                return false;
            } finally {
                this.connectingPromise = null;
            }
        })();

        return await this.connectingPromise;
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

    async connect(): Promise<void> {
        await this.connectInternal();
    }

    async disconnect(): Promise<void> {
        await this.mongoose.disconnect();
    }

    /**
     * Registers a migration on this plugin instance, preserving registration order.
     * @param id Stable unique migration identifier
     * @param run Migration callback receiving this connected plugin
     */
    defineMigration(id: string, run: (ctx: MongoosePlugin) => Promise<void>): void {
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

    /** Runs registered migrations sequentially after plugin loading; completed ids are skipped. */
    async runMigrations(): Promise<void> {
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
    }

    async startSession(options?: ClientSessionOptions): Promise<mongoose.ClientSession> {
        return this.mongoose.startSession(options);
    }

    async useSession<T>(fn: (session: mongoose.ClientSession) => Promise<T>, options?: ClientSessionOptions): Promise<T> {
        const session = await this.startSession(options);
        try {
            return await sessionContext.run(session, () => fn(session));
        } finally {
            await session.endSession();
        }
    }

    async startTransaction(options?: mongoose.mongo.TransactionOptions): Promise<mongoose.ClientSession> {
        const session = await this.startSession();
        session.startTransaction(options);
        return session;
    }

    async useTransaction<T>(
        fn: (session: mongoose.ClientSession) => Promise<T>,
        options?: mongoose.mongo.TransactionOptions
    ): Promise<T> {
        const session = await this.startSession();
        try {
            return await session.withTransaction(() => sessionContext.run(session, () => fn(session)), options);
        } finally {
            await session.endSession();
        }
    }
}
