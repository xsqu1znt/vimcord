import type {
    AggregateOptions,
    ClientSessionOptions,
    CreateOptions,
    HydratedDocument,
    Model,
    mongo,
    MongooseBaseQueryOptions,
    MongooseBulkWriteOptions,
    MongooseUpdateQueryOptions,
    PipelineStage,
    ProjectionType,
    QueryFilter,
    QueryOptions,
    Require_id,
    SchemaDefinition,
    SchemaOptions,
    UpdateQuery
} from "mongoose";
import type { MongoPlugin } from "./plugins.js";

import mongoose, { Schema } from "mongoose";
import { Vimcord } from "@vimcord/core";
import { MongoosePlugin, PLUGIN_NAME } from "./index.js";
import { MongoosePluginError } from "./MongoosePluginError.js";

export type LeanOrHydratedDocument<Definition, Options extends QueryOptions<Definition>> = Options["lean"] extends false
    ? HydratedDocument<Definition>
    : Definition;

type DistinctValue<Value> = Value extends readonly (infer Item)[] ? NonNullable<Item> : NonNullable<Value>;
type CreateDocument<Definition> = Parameters<Model<Definition>["create"]>[0];
type BulkWriteOperations<Definition> = Parameters<Model<Definition>["bulkWrite"]>[0];

export interface MongoSchemaBuilderOptions<Definition = any> extends SchemaOptions<Definition> {
    /** The Vimcord client ID to attach to. Leave blank to use the default. */
    clientId?: string;
}

export function createMongoSchema<Definition extends object>(
    collection: string,
    definition: SchemaDefinition<Definition>,
    options: MongoSchemaBuilderOptions<Definition> = {}
): MongoSchemaBuilder<Definition> {
    return new MongoSchemaBuilder(collection, definition, options);
}

export class MongoSchemaBuilder<Definition> {
    static globalPlugins: MongoPlugin[] = [];

    readonly client: Vimcord | null = null;
    readonly plugin: MongoosePlugin | null = null;

    readonly collection: string;
    readonly schema: Schema<Definition>;
    model: Model<Definition> | null = null;

    constructor(
        collectionName: string,
        definition: SchemaDefinition<Definition>,
        private options: MongoSchemaBuilderOptions<Definition> = {}
    ) {
        const { clientId, ...schemaOptions } = options;

        this.collection = collectionName;
        this.schema = new Schema(definition, { versionKey: false, ...schemaOptions });

        // Apply global plugins
        for (const plugin of MongoSchemaBuilder.globalPlugins) {
            plugin(this);
        }
    }

    private compileModel(): { client: Vimcord; plugin: MongoosePlugin; model: Model<Definition> } {
        // --- Get the vimcord client ---
        if (!this.client) {
            const client = Vimcord.getInstance(this.options.clientId);
            if (!client) {
                throw new MongoosePluginError(`Client instance (${this.options.clientId ?? "DEFAULT"}) does not exist`);
            }

            // NOTE: We're casting `this` because `client` is readonly
            (this as { client: Vimcord | null }).client = client;
        }

        if (!this.client) {
            throw new MongoosePluginError(`Client instance not found`);
        }

        if (!this.plugin) {
            // Get the MongoosePlugin from the client
            // NOTE: We're casting `this` because `plugin` is readonly
            (this as { plugin: MongoosePlugin | null }).plugin = this.client!.plugins.get<MongoosePlugin>(PLUGIN_NAME, true);
        }

        if (!this.plugin) {
            throw new MongoosePluginError(`Plugin "${PLUGIN_NAME}" is required, but not installed on the client`);
        }

        if (this.model) return { client: this.client, plugin: this.plugin, model: this.model };

        // Compile model on the plugin's mongoose instance
        this.model = this.plugin.mongoose.model<Definition>(this.collection, this.schema, this.collection);
        this.client.logger.plugin.successVerbose(PLUGIN_NAME, `[${this.collection}] Compiled!`);

        return { client: this.client, plugin: this.plugin, model: this.model };
    }

    // --- Utilities ---
    /**
     * Extends the current builder with extra functions.
     * @param extras The functions to add on to the builder
     */
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

        return this as unknown as MongoSchemaBuilder<Definition> & Extra;
    }

    /**
     * Registers a mongo plugin to just this instance.
     * @param plugin The plugin to register
     */
    use(plugin: MongoPlugin<Definition>): this {
        plugin(this);
        return this;
    }

    /**
     * Starts a new session.
     * @param options The options for the session
     */
    async startSession(options?: ClientSessionOptions): Promise<mongoose.ClientSession> {
        const { plugin } = this.compileModel();
        return await plugin.startSession(options);
    }

    /**
     * Starts and uses a new session.
     * @param fn The function to use inside of the session
     * @param options The options for the session
     */
    async useSession(fn: (session: mongoose.ClientSession) => Promise<void>, options?: ClientSessionOptions): Promise<void> {
        const { plugin } = this.compileModel();
        return await plugin.useSession(fn, options);
    }

    /**
     * Starts a new transaction.
     * @param options The options for the transaction
     */
    async startTransaction(options?: mongoose.mongo.TransactionOptions): Promise<mongoose.ClientSession> {
        const { plugin } = this.compileModel();
        return await plugin.startTransaction(options);
    }

    /**
     * Starts and uses a new transaction.
     * @param fn The function to use inside of the transaction
     * @param options The options for the transaction
     */
    async useTransaction(
        fn: (session: mongoose.ClientSession) => Promise<unknown>,
        options?: mongoose.mongo.TransactionOptions
    ): Promise<void> {
        const { plugin } = this.compileModel();
        return await plugin.useTransaction(fn, options);
    }

    // --- CRUD Methods ---
    /**
     * Generates a value that is unique for the provided schema path.
     *
     * The provided function is called once per attempt. If the generated value already exists on another document at
     * `path`, the function is called again until a unique value is found or `maxRetries` is reached.
     *
     * @example
     * ```ts
     * const inviteCode = await Invites.unique("code", () => randomUUID());
     * ```
     *
     * @param path The schema path to check for existing documents with the same value
     * @param fn The function that generates a candidate value. This should randomize or otherwise change its output
     * @param maxRetries The number of collision retries allowed after the first attempt
     */
    async unique<Path extends keyof Require_id<Definition> & string>(
        path: Path,
        fn: () => Require_id<Definition>[Path] | Promise<Require_id<Definition>[Path]>,
        maxRetries: number = 10
    ): Promise<Require_id<Definition>[Path] | undefined> {
        if (maxRetries < 0) {
            throw new MongoosePluginError(`maxRetries must be greater than or equal to 0`);
        }

        const { model } = this.compileModel();

        for (const attempt of Array.from({ length: maxRetries + 1 }, (_, index) => index)) {
            const value = await fn();
            const collision = await model.exists({ [path]: value } as QueryFilter<Definition>);

            if (!collision) return value;

            if (attempt === maxRetries) {
                throw new MongoosePluginError(
                    `Failed to generate a unique value for "${path}" after ${maxRetries} attempt${maxRetries === 1 ? "" : "s"}`
                );
            }
        }

        throw new MongoosePluginError(`Failed to generate a unique value for "${path}"`);
    }

    /**
     * Counts the number of documents that match a filter.
     *
     * @param filter The filter used to match documents
     * @param options The options to pass to MongoDB and Mongoose
     */
    async count(
        filter?: QueryFilter<Definition>,
        options?: mongo.CountOptions & MongooseBaseQueryOptions<Definition> & mongo.Abortable
    ): Promise<number> {
        const { model } = this.compileModel();
        return await model.countDocuments(filter, options);
    }

    /**
     * Checks whether at least one document exists for a filter.
     *
     * @param filter The filter used to match documents
     */
    async exists(filter: QueryFilter<Definition>): Promise<boolean> {
        const { model } = this.compileModel();
        return !!(await model.exists(filter));
    }

    /**
     * Creates multiple documents.
     *
     * @param docs The documents to create
     * @param options The options to pass to Mongoose
     */
    async create(docs: CreateDocument<Definition>[], options?: CreateOptions): Promise<HydratedDocument<Definition>[]> {
        const { model } = this.compileModel();
        return await model.create(docs, options);
    }

    /**
     * Updates the first matching document, or creates it when no document matches.
     *
     * @param filter The filter used to match the document
     * @param update The update to apply when a document exists, or create from when it does not
     * @param options The query options to pass to Mongoose
     */
    async upsert<Options extends Omit<QueryOptions<Definition>, "new" | "returnDocument" | "upsert">>(
        filter: QueryFilter<Definition>,
        update: UpdateQuery<Definition>,
        options?: Options
    ): Promise<LeanOrHydratedDocument<Definition, Options>> {
        const { model } = this.compileModel();
        const result = await model.findOneAndUpdate(filter, update, { returnDocument: "after", ...options, upsert: true });

        return result as LeanOrHydratedDocument<Definition, Options>;
    }

    /**
     * Deletes the first document that matches a filter.
     *
     * @param filter The filter used to match the document
     * @param options The options to pass to MongoDB and Mongoose
     */
    async delete(
        filter: QueryFilter<Definition>,
        options?: mongo.DeleteOptions & MongooseBaseQueryOptions<Definition>
    ): Promise<mongo.DeleteResult> {
        const { model } = this.compileModel();
        return await model.deleteOne(filter, options);
    }

    /**
     * Deletes every document that matches a filter.
     *
     * @param filter The filter used to match documents
     * @param options The options to pass to MongoDB and Mongoose
     */
    async deleteAll(
        filter: QueryFilter<Definition>,
        options?: mongo.DeleteOptions & MongooseBaseQueryOptions<Definition>
    ): Promise<mongo.DeleteResult> {
        const { model } = this.compileModel();
        return await model.deleteMany(filter, options);
    }

    /**
     * Gets the unique values for a schema path across matching documents.
     *
     * @param path The schema path to read distinct values from
     * @param filter The filter used to limit documents
     * @param options The query options to pass to Mongoose
     */
    async distinct<Path extends keyof Require_id<Definition> & string>(
        path: Path,
        filter?: QueryFilter<Definition>,
        options?: QueryOptions<Definition>
    ): Promise<DistinctValue<Require_id<Definition>[Path]>[]> {
        const { model } = this.compileModel();
        const values = await model.distinct(path, filter, options);

        return values as DistinctValue<Require_id<Definition>[Path]>[];
    }

    /**
     * Fetches the first document that matches a filter.
     *
     * Queries are lean by default. Pass `{ lean: false }` when a hydrated Mongoose document is needed.
     *
     * @param filter The filter used to match the document
     * @param projection The fields to include or exclude
     * @param options The query options to pass to Mongoose
     */
    async fetch<Options extends QueryOptions<Definition>>(
        filter?: QueryFilter<Definition>,
        projection?: ProjectionType<Definition>,
        options?: Options & { required?: false }
    ): Promise<LeanOrHydratedDocument<Definition, Options> | null>;
    async fetch<Options extends QueryOptions<Definition>>(
        filter?: QueryFilter<Definition>,
        projection?: ProjectionType<Definition>,
        options?: Options & { required: true }
    ): Promise<LeanOrHydratedDocument<Definition, Options>>;
    async fetch<Options extends QueryOptions<Definition>>(
        filter?: QueryFilter<Definition>,
        projection?: ProjectionType<Definition>,
        options?: Options & {
            /**
             * Throws when no document is found and removes `null` from the return type
             * @defaultValue false
             */
            required?: boolean;
        }
    ): Promise<LeanOrHydratedDocument<Definition, Options> | null> {
        const { model } = this.compileModel();
        const { required = false, ...queryOptions } = (options ?? {}) as QueryOptions<Definition> & {
            required?: boolean;
        };

        const result = await model.findOne(filter, projection, { ...queryOptions, lean: queryOptions.lean ?? true });
        if (required && !result) throw new MongoosePluginError(`Document not found`);

        return result as LeanOrHydratedDocument<Definition, Options> | null;
    }

    /**
     * Fetches every document that matches a filter.
     *
     * Queries are lean by default. Pass `{ lean: false }` when hydrated Mongoose documents are needed.
     *
     * @param filter The filter used to match documents
     * @param projection The fields to include or exclude
     * @param options The query options to pass to Mongoose
     */
    async fetchAll<Options extends QueryOptions<Definition>>(
        filter?: QueryFilter<Definition>,
        projection?: ProjectionType<Definition>,
        options?: Options
    ): Promise<LeanOrHydratedDocument<Definition, Options>[]> {
        const { model } = this.compileModel();
        const results = await model.find(filter, projection, { ...options, lean: options?.lean ?? true });

        return results as LeanOrHydratedDocument<Definition, Options>[];
    }

    /**
     * Fetches the latest document that matches a filter.
     *
     * Queries are lean by default. Pass `{ lean: false }` when a hydrated Mongoose document is needed.
     *
     * @param filter The filter used to match the document
     * @param projection The fields to include or exclude
     * @param options The query options to pass to Mongoose
     */
    async fetchLatest<Options extends QueryOptions<Definition>>(
        filter: QueryFilter<Definition>,
        projection?: ProjectionType<Definition>,
        options?: Options
    ): Promise<LeanOrHydratedDocument<Definition, Options> | null> {
        const { model } = this.compileModel();
        const result = await model.findOne(filter, projection, {
            ...options,
            lean: options?.lean ?? true,
            sort: { createdAt: -1 }
        });

        return result as LeanOrHydratedDocument<Definition, Options> | null;
    }

    /**
     * Updates the first document that matches a filter and returns the updated document.
     *
     * Queries are lean by default. Pass `{ lean: false }` when a hydrated Mongoose document is needed.
     *
     * @param filter The filter used to match the document
     * @param update The update to apply
     * @param options The query options to pass to Mongoose
     */
    async update<Options extends QueryOptions<Definition>>(
        filter: QueryFilter<Definition>,
        update: UpdateQuery<Definition>,
        options?: Options
    ): Promise<LeanOrHydratedDocument<Definition, Options> | null> {
        const { model } = this.compileModel();
        const result = await model.findOneAndUpdate(filter, update, {
            ...options,
            lean: options?.lean ?? true,
            returnDocument: "after"
        });

        return result as LeanOrHydratedDocument<Definition, Options> | null;
    }

    /**
     * Updates every document that matches a filter.
     *
     * @param filter The filter used to match documents
     * @param update The update to apply
     * @param options The options to pass to MongoDB and Mongoose
     */
    async updateAll(
        filter: QueryFilter<Definition>,
        update: UpdateQuery<Definition>,
        options?: mongo.UpdateOptions & MongooseUpdateQueryOptions<Definition>
    ): Promise<mongo.UpdateResult> {
        const { model } = this.compileModel();
        return await model.updateMany(filter, update, options);
    }

    /**
     * Runs an aggregation pipeline against the collection.
     *
     * @param pipeline The aggregation pipeline stages to run
     * @param options The aggregation options to pass to Mongoose
     */
    async aggregate<Result = unknown>(pipeline: PipelineStage[], options?: AggregateOptions): Promise<Result[]> {
        const { model } = this.compileModel();
        return await model.aggregate<Result>(pipeline, options);
    }

    /**
     * Runs multiple write operations in a single MongoDB command.
     *
     * @param ops The write operations to run
     * @param options The bulk write options to pass to Mongoose
     */
    async bulkWrite(
        ops: BulkWriteOperations<Definition>,
        options?: MongooseBulkWriteOptions
    ): Promise<mongo.BulkWriteResult> {
        const { model } = this.compileModel();
        return await model.bulkWrite(ops, options);
    }

    /**
     * Saves multiple hydrated documents in a single bulk write.
     *
     * @param docs The hydrated documents to save
     * @param options The bulk write options to pass to Mongoose
     */
    async bulkSave(
        docs: HydratedDocument<Definition>[],
        options?: MongooseBulkWriteOptions
    ): Promise<mongo.BulkWriteResult> {
        const { model } = this.compileModel();
        return await model.bulkSave(docs, options);
    }
}
