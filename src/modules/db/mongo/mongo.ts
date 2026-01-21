/* Check if Mongoose is installed */
try {
    import("mongoose");
} catch {
    throw new Error("MongoDatabase requires the mongoose package, install it with `npm install mongoose`");
}

import { type Vimcord } from "@/client";
import mongoose, { ClientSessionOptions, Connection, ConnectionStates } from "mongoose";
import EventEmitter from "node:events";
import { $ } from "qznt";

interface MongoConnectionOptions {
    /** The maximum number of attempts to connect to MongoDB @defaultValue `3` */
    maxRetries?: number;
}

const instances = new Map<number, MongoDatabase>();
const emitter = new EventEmitter<{ ready: [MongoDatabase] }>();

export class MongoDatabase {
    readonly moduleName = "MongoDatabase";
    readonly clientId: number;

    readonly client: Vimcord;
    readonly mongoose: mongoose.Mongoose;

    private isConnecting = false;

    static getInstance(instanceId?: number | Vimcord) {
        const id = (typeof instanceId === "number" ? instanceId : instanceId?.clientId) ?? 0;
        return instances.get(id);
    }

    static async getReadyInstance(instanceId?: number | Vimcord) {
        return await MongoDatabase.getInstance(instanceId)?.waitForReady();
    }

    static async startSession(options?: ClientSessionOptions, instanceId?: number | Vimcord) {
        return (await MongoDatabase.getReadyInstance(instanceId))?.startSession(options);
    }

    constructor(client: Vimcord, options?: mongoose.MongooseOptions) {
        this.client = client;
        this.mongoose = new mongoose.Mongoose(options);
        this.clientId = this.client.clientId;
        instances.set(this.clientId, this);
    }

    get connection(): Connection {
        return this.mongoose.connection;
    }

    get isReady(): boolean {
        return this.connection.readyState === ConnectionStates.connected;
    }

    async waitForReady(): Promise<this> {
        if (!this.isReady && this.isConnecting) {
            return new Promise(resolve => emitter.once("ready", db => resolve(db as this)));
        }
        return this;
    }

    async connect(
        uri?: string,
        connectionOptions?: mongoose.ConnectOptions,
        options: MongoConnectionOptions = {}
    ): Promise<boolean> {
        const { maxRetries = 3 } = options;

        // Already connected
        if (this.isReady) {
            return true;
        }

        // Still connecting
        if (!this.isReady && this.isConnecting) {
            return new Promise(resolve => emitter.once("ready", () => resolve(true)));
        }

        const connectionUri = uri ?? (this.client.config.app.devMode ? process.env.MONGO_URI_DEV : process.env.MONGO_URI);
        options = { ...options, maxRetries: options.maxRetries ?? 3 };

        if (!connectionUri) {
            throw new Error(
                `MONGO_URI Missing: ${this.client.config.app.devMode ? "DEV MODE is enabled, but MONGO_URI_DEV is not set" : "MONGO_URI not set"}`
            );
        }

        this.isConnecting = true;

        try {
            const stopLoader = this.client.logger.loader("Connecting to MongoDB...");

            await $.async.retry(
                () => this.mongoose.connect(connectionUri, { autoIndex: true, ...connectionOptions }),
                maxRetries
            );

            emitter.emit("ready", this);
            stopLoader("Connected to MongoDB    ");
        } catch (err) {
            this.client.logger.error(`Failed to connect to MongoDB after ${maxRetries} attempt(s)`, err as Error);
        } finally {
            this.isConnecting = false;
        }

        return true;
    }

    async disconnect(): Promise<void> {
        await this.mongoose.disconnect();
    }

    async startSession(options?: ClientSessionOptions) {
        return this.mongoose.startSession(options);
    }

    async useTransaction(fn: (session: mongoose.ClientSession) => Promise<void>) {
        const session = await this.startSession();
        session.startTransaction();

        try {
            await fn(session);
            await session.commitTransaction();
        } catch (err) {
            await session.abortTransaction();
            throw err;
        } finally {
            await session.endSession();
        }
    }
}
