import type { ClientSessionOptions } from "mongoose";
import type { HealthProbeResult, VimcordPluginContext } from "@vimcord/core";

import mongoose from "mongoose";
import { retryPromise } from "qznt";
import { Vimcord, VimcordPlugin } from "@vimcord/core";
import { MongoosePluginError } from "./MongoosePluginError.js";

export * from "./MongoSchemaBuilder.js";
// export * from "./ServiceFactories.js";

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
    /** Automatic MongoDB connection health checks and reconnect behavior. @default true */
    connectionRefresh?: boolean | Partial<MongooseConnectionRefreshOptions>;
}

export interface MongooseConnectionRefreshOptions {
    /** Whether automatic MongoDB connection refresh checks are enabled. */
    enabled: boolean;
    /** Milliseconds between MongoDB health checks. */
    interval: number;
    /** Consecutive failed health checks required before reconnecting. */
    maxFailures: number;
    /** Maximum reconnect attempts per refresh cycle. */
    maxRefreshAttempts: number;
}

export const PLUGIN_NAME = "mongoose";
export const PLUGIN_DESCRIPTION = "Provides an opinionated wrapper over Mongoose for interacting with MongoDB.";
export const PLUGIN_VERSION = "0.1.0";

const DEFAULT_CONNECTION_REFRESH_OPTIONS: MongooseConnectionRefreshOptions = {
    enabled: true,
    interval: 60_000,
    maxFailures: 2,
    maxRefreshAttempts: 3
};

function resolveConnectionRefreshOptions(options: MongooseOptions["connectionRefresh"]): MongooseConnectionRefreshOptions {
    if (options === false) return { ...DEFAULT_CONNECTION_REFRESH_OPTIONS, enabled: false };
    if (options === true || options === undefined) return { ...DEFAULT_CONNECTION_REFRESH_OPTIONS };

    return {
        ...DEFAULT_CONNECTION_REFRESH_OPTIONS,
        ...options,
        interval: Math.max(1_000, options.interval ?? DEFAULT_CONNECTION_REFRESH_OPTIONS.interval),
        maxFailures: Math.max(1, options.maxFailures ?? DEFAULT_CONNECTION_REFRESH_OPTIONS.maxFailures),
        maxRefreshAttempts: Math.max(1, options.maxRefreshAttempts ?? DEFAULT_CONNECTION_REFRESH_OPTIONS.maxRefreshAttempts)
    };
}

export class MongoosePlugin extends VimcordPlugin {
    override name = PLUGIN_NAME;
    override description = PLUGIN_DESCRIPTION;
    override version = PLUGIN_VERSION;

    readonly client: Vimcord | null = null;
    readonly mongoose: mongoose.Mongoose;

    private readonly uri: string | undefined;
    private readonly maxRetries: number;
    private readonly mongooseOptions: mongoose.MongooseOptions;
    private readonly connectionRefresh: MongooseConnectionRefreshOptions;
    private connectionRefreshFailures = 0;
    private connectionRefreshTimer: ReturnType<typeof setInterval> | null = null;
    private connectingPromise: Promise<boolean> | null = null;
    private refreshingConnectionPromise: Promise<void> | null = null;

    constructor(config: MongooseOptions = {}) {
        super();

        const { uri, maxRetries = 3, connectionRefresh: autoRefresh, ...mongooseOptions } = config;
        this.uri = uri;
        this.maxRetries = maxRetries;
        this.mongooseOptions = mongooseOptions;
        this.connectionRefresh = resolveConnectionRefreshOptions(autoRefresh);
        this.mongoose = new mongoose.Mongoose(mongooseOptions);
    }

    override async install({ client, health }: VimcordPluginContext): Promise<void> {
        (this as { client: Vimcord | null }).client = client;
        await this.connect();
        health.register({
            id: "mongodb",
            label: "MongoDB",
            check: ({ signal }) => this.checkMongoHealth(signal)
        });
        this.startConnectionRefreshMonitor();
    }

    override async uninstall(): Promise<void> {
        this.stopConnectionRefreshMonitor();
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
                await retryPromise(
                    () => this.mongoose.connect(connectionUri, { autoIndex: true, ...this.mongooseOptions }),
                    {
                        attempts: this.maxRetries
                    }
                );

                this.connectionRefreshFailures = 0;
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

    private startConnectionRefreshMonitor(): void {
        if (!this.connectionRefresh.enabled || this.connectionRefreshTimer || !this.client) return;

        this.connectionRefreshTimer = setInterval(
            () => void this.runConnectionRefreshCheck(),
            this.connectionRefresh.interval
        );
        this.connectionRefreshTimer.unref?.();
        this.client.logger.plugin.debug(this.name, "Started MongoDB connection health monitor");
    }

    private stopConnectionRefreshMonitor(): void {
        if (!this.connectionRefreshTimer) return;

        clearInterval(this.connectionRefreshTimer);
        this.connectionRefreshTimer = null;
        this.client?.logger.plugin.debug(this.name, "Stopped MongoDB connection health monitor");
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

    private async testMongoConnection(): Promise<boolean> {
        return (await this.checkMongoHealth()).status === "healthy";
    }

    private async runConnectionRefreshCheck(): Promise<void> {
        if (!this.client || this.refreshingConnectionPromise) return;

        const healthy = await this.testMongoConnection();
        if (healthy) {
            this.connectionRefreshFailures = 0;
            return;
        }

        this.connectionRefreshFailures++;
        this.client.logger.plugin.log(
            this.name,
            `MongoDB health check failed (${this.connectionRefreshFailures}/${this.connectionRefresh.maxFailures})`
        );

        if (this.connectionRefreshFailures >= this.connectionRefresh.maxFailures) {
            await this.refreshMongoConnection("health checks failed");
        }
    }

    private async refreshMongoConnection(reason: string): Promise<void> {
        if (this.refreshingConnectionPromise) return this.refreshingConnectionPromise;

        this.refreshingConnectionPromise = (async () => {
            if (!this.client) return;

            this.client.logger.plugin.log(this.name, `Refreshing MongoDB connection: ${reason}`);
            this.stopConnectionRefreshMonitor();

            for (const attempt of Array.from(
                { length: this.connectionRefresh.maxRefreshAttempts },
                (_, index) => index + 1
            )) {
                await this.disconnect().catch(Boolean);

                const connected = await this.connectInternal();
                if (connected) {
                    this.client.logger.plugin.success(this.name, `MongoDB connection refreshed on attempt ${attempt}`);
                    return;
                }
            }

            this.client.logger.plugin.error(
                this.name,
                `Failed to refresh MongoDB connection after ${this.connectionRefresh.maxRefreshAttempts} attempt${this.connectionRefresh.maxRefreshAttempts === 1 ? "" : "s"}`,
                new MongoosePluginError("MongoDB refresh failed")
            );
        })();

        try {
            await this.refreshingConnectionPromise;
        } finally {
            this.refreshingConnectionPromise = null;
            this.startConnectionRefreshMonitor();
        }
    }

    async connect(): Promise<void> {
        await this.connectInternal();
    }

    async disconnect(): Promise<void> {
        await this.mongoose.disconnect();
    }

    async startSession(options?: ClientSessionOptions): Promise<mongoose.ClientSession> {
        return this.mongoose.startSession(options);
    }

    async useSession(
        fn: (session: mongoose.ClientSession) => Promise<unknown>,
        options?: ClientSessionOptions
    ): Promise<void> {
        const session = await this.startSession(options);
        try {
            await fn(session);
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
            return await session.withTransaction(() => fn(session), options);
        } finally {
            await session.endSession();
        }
    }
}
