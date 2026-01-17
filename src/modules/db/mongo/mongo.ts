/* Check if Mongoose is installed */
try {
    import("mongoose");
} catch {
    throw new Error("MongoDatabase requires the mongoose package, install it with `npm install mongoose`");
}

import { retryExponentialBackoff } from "@/utils/async";
import { randomUUID } from "node:crypto";
import { type Vimcord } from "@/client";
import EventEmitter from "node:events";
import mongoose, { ClientSessionOptions } from "mongoose";

interface MongoConnectionOptions {
    /** The maximum number of attempts to connect to MongoDB @defaultValue `3` */
    maxRetries?: number;
}

const globalInstanceEmitter = new EventEmitter<{ created: [MongoDatabase]; connected: [MongoDatabase] }>();
const instances: MongoDatabase[] = [];

export async function useMongoDatabase(instanceIndex?: number) {
    const instance = instances.at(instanceIndex ?? 0);

    if (!instance) {
        return new Promise<MongoDatabase>((resolve, reject) => {
            // 45 second timeout
            const timeout = setTimeout(() => reject("useMongoDatabase timed out"), 45_000);

            globalInstanceEmitter.once("connected", mdb => {
                clearTimeout(timeout);
                resolve(mdb);
            });
        });
    }

    return instance;
}

export async function useReadyMongoDatabase(instanceIndex?: number) {
    const instance = await useMongoDatabase(instanceIndex);
    await instance.waitForReady();
    return instance;
}

export async function createMongoSession(instanceIndex?: number, options?: ClientSessionOptions) {
    const instance = await useReadyMongoDatabase(instanceIndex);
    return instance.mongoose.startSession(options);
}

export class MongoDatabase {
    readonly name: string = "MongoDatabase";
    readonly uuid: string = randomUUID();
    readonly index: number;
    private uri: string | undefined;

    mongoose: mongoose.Mongoose;
    private eventEmitter = new EventEmitter<{ ready: [] }>();

    private isReady = false;
    private isConnecting = false;

    constructor(
        public client: Vimcord,
        options?: mongoose.MongooseOptions
    ) {
        this.mongoose = new mongoose.Mongoose(options);
        this.index = instances.length - 1;
        instances.push(this);

        globalInstanceEmitter.emit("created", this);
    }

    async waitForReady(): Promise<boolean> {
        if (!this.isReady && this.isConnecting) {
            return new Promise(resolve => this.eventEmitter.once("ready", () => resolve(this.isReady)));
        }
        return this.isReady;
    }

    async connect(
        uri?: string,
        connectionOptions?: mongoose.ConnectOptions,
        options?: MongoConnectionOptions
    ): Promise<boolean> {
        if (!this.isReady && this.isConnecting) {
            return new Promise(resolve => this.eventEmitter.once("ready", () => resolve(true)));
        }

        // If already connected, return the existing connection
        if (this.mongoose.connection?.readyState === 1) {
            return true;
        }

        uri ??= this.uri || this.client.config.app.devMode ? process.env.MONGO_URI_DEV : process.env.MONGO_URI;
        options = { ...options, maxRetries: options?.maxRetries ?? 3 };

        if (!uri) {
            throw new Error(
                `MONGO_URI Missing: ${this.client.config.app.devMode ? "DEV MODE is enabled, but MONGO_URI_DEV is not set" : "MONGO_URI not set"}`
            );
        }

        this.uri = uri;
        this.isReady = false;
        this.isConnecting = true;

        try {
            const stopLoader = this.client.logger.loader("Connecting to MongoDB...");
            await retryExponentialBackoff(
                attempt => {
                    return this.mongoose.connect(uri, {
                        serverSelectionTimeoutMS: 30000,
                        socketTimeoutMS: 45000,
                        connectTimeoutMS: 30000,
                        maxPoolSize: 10,
                        minPoolSize: 5,
                        bufferCommands: false,
                        ...connectionOptions
                    });
                },
                options.maxRetries,
                1_000
            );

            this.isReady = true;
            this.eventEmitter.emit("ready");
            globalInstanceEmitter.emit("connected", this);
            stopLoader("Connected to MongoDB    ");
        } catch (err) {
            this.client.logger.error(`Failed to connect to MongoDB after ${options.maxRetries} attempt(s)`, err as Error);
        }

        this.isConnecting = false;
        return true;
    }
}
