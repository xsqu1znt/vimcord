import type { ClientSessionOptions } from "mongoose";

import mongoose from "mongoose";
import { retry } from "qznt";
import { PluginError, Vimcord, VimcordPlugin } from "@vimcord/core";
import { Logger } from "@vimcord/internal";

export * from "./mongoSchema.builder.js";

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
}

export const PLUGIN_NAME = "@vimcord/plugin-mongoose";
export const PLUGIN_DESCRIPTION = "Provides an opinionated wrapper over Mongoose for interacting with MongoDB.";
export const PLUGIN_VERSION = "0.1.0";

export class MongoosePlugin extends VimcordPlugin {
    override name = PLUGIN_NAME;
    override description = PLUGIN_DESCRIPTION;
    override version = PLUGIN_VERSION;

    readonly client: Vimcord | null = null;
    readonly mongoose: mongoose.Mongoose;

    readonly logger: Logger;
    private connectingPromise: Promise<void> | null = null;

    constructor(private config?: MongooseOptions) {
        super();
        this.mongoose = new mongoose.Mongoose(config);
        this.logger = new Logger({ prefixEmoji: "🥭", prefix: `Mongoose`, colors: { primary: "#F29B58" } });
    }

    override async install(client: Vimcord): Promise<void> {
        (this as any).client = client;
        await this.connect();
        this.installed = true;
    }

    override uninstall(): void {
        // noop
        this.installed = false;
    }

    async connect(): Promise<void> {
        if (this.connectingPromise) {
            return this.connectingPromise;
        }

        this.connectingPromise = (async () => {
            if (!this.client) {
                throw new PluginError("Cannot connect to MongoDB: MongoosePlugin has not been installed yet");
            }

            const devMode = this.client.$devMode;
            const connectionUri = this.config?.uri ?? (devMode ? process.env.MONGO_URI_DEV : process.env.MONGO_URI);
            if (!connectionUri) {
                throw new PluginError(
                    `MONGO_URI Missing: ${devMode ? "DEV MODE is enabled, but MONGO_URI_DEV is not set" : "MONGO_URI not set"}`
                );
            }

            const maxRetries = this.config?.maxRetries ?? 3;
            this.client.logger.module("mongoose", { emoji: "🔌" }).log("Connecting to MongoDB...");

            try {
                await retry(() => this.mongoose.connect(connectionUri, { autoIndex: true, ...this.config }), {
                    retries: maxRetries
                });
            } catch (err) {
                this.client.logger
                    .module("mongoose", { emoji: "🔌" })
                    .error("Failed to connect to MongoDB", err as Error, `${maxRetries} attempt(s) reached`);
            } finally {
                this.connectingPromise = null;
            }
        })();

        await this.connectingPromise;
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

    async useTransaction(
        fn: (session: mongoose.ClientSession) => Promise<unknown>,
        options?: mongoose.mongo.TransactionOptions
    ): Promise<void> {
        await this.useSession(async session => {
            session.startTransaction(options);
            try {
                await fn(session);
                await session.commitTransaction();
            } catch (err) {
                await session.abortTransaction();
                throw err;
            }
        });
    }
}
