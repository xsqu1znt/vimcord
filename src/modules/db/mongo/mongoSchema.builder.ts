/* Check if Mongoose is installed */
try {
    import("mongoose");
} catch {
    throw new Error("MongoSchemaBuilder requires the mongoose package, install it with `npm install mongoose`");
}

import mongoose, {
    AggregateOptions,
    CreateOptions,
    HydratedDocument,
    Model,
    mongo,
    MongooseBaseQueryOptions,
    MongooseUpdateQueryOptions,
    PipelineStage,
    ProjectionType,
    QueryOptions,
    Require_id,
    RootFilterQuery,
    Schema,
    SchemaDefinition,
    UpdateQuery
} from "mongoose";
import { type MongoDatabase, useMongoDatabase } from "@/modules/db/mongo/mongo";
import { retryExponentialBackoff } from "@/utils/async";
import { randomBytes } from "node:crypto";
import { Logger } from "@/tools/Logger";
import EventEmitter from "node:events";

export type ExtractReturn<T> = T extends (this: any, ...args: any) => infer R ? Awaited<R> : never;
export type LeanOrHydratedDocument<T, O extends QueryOptions<T>> = O["lean"] extends false
    ? HydratedDocument<T>
    : Require_id<T>;

export interface MongoSchemaEvents {
    initialized: [];
    ready: [boolean];
    error: [Error];
}

export interface MongoSchemaOptions {
    connectionIndex?: number;
}

export function createMongoSchema<Definition extends object>(
    collection: string,
    definition: SchemaDefinition<Definition>,
    options?: MongoSchemaOptions
): MongoSchemaBuilder<Definition> {
    return new MongoSchemaBuilder(collection, definition, options);
}

export class MongoSchemaBuilder<Definition extends object> {
    schema!: Schema<Definition>;
    model!: Model<Definition>;

    database: MongoDatabase | null = null;
    connectionIndex: number = 0;

    isReady: boolean = false;
    isInitializing: boolean = false;
    eventEmitter = new EventEmitter<MongoSchemaEvents>();

    logger: Logger;

    constructor(collection: string, definition: SchemaDefinition<Definition>, options?: MongoSchemaOptions) {
        this.connectionIndex = options?.connectionIndex ?? this.connectionIndex;

        // Initialize a custom logger instance
        this.logger = new Logger({
            prefixEmoji: "🥭",
            prefix: `MongoSchema (c${this.connectionIndex}) [${collection}]`,
            colors: { primary: "#F29B58" }
        });

        /* Set up event handlers */
        this.eventEmitter.once("initialized", () => {
            if (this.database) {
                /* Create the schema and model */
                this.schema = new Schema(definition, { versionKey: false });
                this.model = this.database.mongoose.model(collection, this.schema) as Model<Definition>;
                this.eventEmitter.emit("ready", true);
            } else {
                this.eventEmitter.emit("error", new Error(`MongoDatabase (c${this.connectionIndex}) not found`));
            }
        });

        this.eventEmitter.on("ready", ready => {
            this.isReady = ready;

            // Verbose logging
            if (this.database?.client.config.app.verbose) {
                this.logger.debug(`Loaded! | ${this.database?.client.config.app.name}`);
            }
        });

        this.eventEmitter.on("error", error => this.logger.error("Error:", error));

        // Finish initialization
        this.init().catch(error => {
            this.eventEmitter.emit("error", error);
        });
    }

    private async init() {
        if (this.isInitializing) return;
        this.isInitializing = true;

        try {
            const database = await useMongoDatabase(this.connectionIndex);
            if (!database) {
                throw new Error("Could not use MongoDatabase");
            }

            // Set our database reference
            this.database = database;

            this.eventEmitter.emit("initialized");
        } catch (err) {
            this.eventEmitter.emit("error", err as Error);
        } finally {
            this.isInitializing = false;
        }
    }

    extend<Extra extends Record<string, (...args: any) => any>>(
        extras: Extra & ThisType<MongoSchemaBuilder<Definition>>
    ): MongoSchemaBuilder<Definition> & Extra {
        for (const [key, fn] of Object.entries(extras as any)) {
            if (typeof fn === "function") {
                (this as any)[key] = function (...args: any[]) {
                    return fn.call(this, ...args);
                };
            }
        }

        return this as any as MongoSchemaBuilder<Definition> & Extra;
    }

    on<K extends keyof MongoSchemaEvents>(event: K, listener: (...args: MongoSchemaEvents[K]) => void) {
        this.eventEmitter.on(event, listener as any);
        return this;
    }

    once<K extends keyof MongoSchemaEvents>(event: K, listener: (...args: MongoSchemaEvents[K]) => void) {
        this.eventEmitter.once(event, listener as any);
        return this;
    }

    off<K extends keyof MongoSchemaEvents>(event: K, listener: (...args: MongoSchemaEvents[K]) => void) {
        this.eventEmitter.off(event, listener as any);
        return this;
    }

    /** Execute a function while ensuring the connection is ready. On error it will retry using an exponential backoff. */
    async execute<T extends (...args: any) => any>(fn: T) {
        try {
            // Check ready
            if (!this.isReady) {
                await new Promise<void>((resolve, reject) => {
                    // 45 second timeout
                    const timeout = setTimeout(() => reject("execution wait for ready timed out"), 45_000);

                    this.eventEmitter.once("ready", () => {
                        clearTimeout(timeout);
                        resolve();
                    });

                    this.eventEmitter.once("error", error => {
                        clearTimeout(timeout);
                        reject(error);
                    });
                });
            }

            // Check our database reference
            if (!this.database) {
                throw new Error("MongoDB connection not found");
            }

            return await retryExponentialBackoff(async () => (await fn()) as ExtractReturn<T>);
        } catch (err) {
            this.eventEmitter.emit("error", err as Error);
        }
    }

    async createHexId(bytes: number, path: keyof Require_id<Definition>, maxRetries: number = 10) {
        return await this.execute(async () => {
            const createHex = () => Buffer.from(randomBytes(bytes)).toString("hex");

            let id = createHex();
            let tries = 0;

            while (await this.model.exists({ [path]: id } as Partial<Require_id<Definition>>)) {
                if (tries >= maxRetries) throw Error(`Failed to generate a unique hex ID after ${tries} attempt(s)`);
                id = createHex();
                tries++;
            }

            return id;
        });
    }

    async count(
        filter?: RootFilterQuery<Definition>,
        options?: mongo.CountOptions & MongooseBaseQueryOptions<Definition> & mongo.Abortable
    ) {
        return await this.execute(async () => {
            return this.model.countDocuments(filter, options);
        });
    }

    async exists(filter: RootFilterQuery<Definition>) {
        return await this.execute(async () => {
            return (await this.model.exists(filter)) ? true : false;
        });
    }

    async create(query: Partial<Require_id<Definition>>[], options?: CreateOptions) {
        return (
            (await this.execute(async () => {
                return this.model.create(query, options);
            })) ?? []
        );
    }

    async upsert(
        filter: RootFilterQuery<Definition>,
        query: Partial<Require_id<Definition>>,
        options?: QueryOptions<Definition>
    ) {
        return await this.execute(async () => {
            return this.model.findOneAndUpdate(filter, query, { ...options, upsert: true, new: true });
        });
    }

    async delete(filter: RootFilterQuery<Definition>, options?: mongo.DeleteOptions & MongooseBaseQueryOptions<Definition>) {
        return await this.execute(async () => {
            return this.model.deleteOne(filter, options);
        });
    }

    async deleteAll(
        filter: RootFilterQuery<Definition>,
        options?: mongo.DeleteOptions & MongooseBaseQueryOptions<Definition>
    ) {
        return await this.execute(async () => {
            return this.model.deleteMany(filter, options);
        });
    }

    async distinct<K extends keyof Require_id<Definition> & string>(
        key: K,
        filter?: RootFilterQuery<Definition>,
        options?: QueryOptions<Definition>
    ) {
        return await this.execute(async () => {
            return this.model.distinct(key, filter, options);
        });
    }

    async fetch<Options extends QueryOptions<Definition>>(
        filter?: RootFilterQuery<Definition>,
        projection?: ProjectionType<Definition>,
        options?: Options
    ): Promise<LeanOrHydratedDocument<Definition, Options> | null | undefined> {
        return await this.execute(async () => {
            return this.model.findOne(filter, projection, { ...options, lean: options?.lean ?? true });
        });
    }

    async fetchAll<Options extends QueryOptions<Definition>>(
        filter: RootFilterQuery<Definition> = {},
        projection?: ProjectionType<Definition>,
        options?: Options
    ): Promise<LeanOrHydratedDocument<Definition, Options>[]> {
        return (
            (await this.execute(async () => {
                return this.model.find(filter, projection, { ...options, lean: options?.lean ?? true });
            })) || []
        );
    }

    async update<Options extends QueryOptions<Definition>>(
        filter: RootFilterQuery<Definition>,
        update: UpdateQuery<Definition>,
        options?: Options
    ): Promise<LeanOrHydratedDocument<Definition, Options> | null | undefined> {
        return await this.execute(async () => {
            return this.model.findOneAndUpdate(filter, update, { ...options, lean: options?.lean ?? true });
        });
    }

    async updateAll(
        filter: RootFilterQuery<Definition>,
        update: UpdateQuery<Definition>,
        options?: mongo.UpdateOptions & MongooseUpdateQueryOptions<Definition>
    ) {
        return await this.execute(async () => {
            return this.model.updateMany(filter, update, options);
        });
    }

    async aggregate<T extends any>(pipeline: PipelineStage[], options?: AggregateOptions): Promise<T[]> {
        return (await this.execute(async () => {
            const result = await this.model.aggregate(pipeline, options);
            return result?.length ? result : [];
        })) as T[];
    }
}
