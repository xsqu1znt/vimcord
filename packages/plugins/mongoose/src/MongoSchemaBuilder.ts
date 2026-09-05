import type {
    AggregateOptions,
    ClientSessionOptions,
    CreateOptions,
    DefaultSchemaOptions,
    HydratedDocument,
    InferRawDocType,
    Model,
    mongo,
    MongooseBaseQueryOptions,
    MongooseBulkSaveOptions,
    MongooseBulkWriteOptions,
    MongooseUpdateQueryOptions,
    ObtainDocumentType,
    PipelineStage,
    ProjectionType,
    QueryFilter,
    QueryOptions,
    SchemaDefinition,
    SchemaOptions,
    UpdateQuery
} from "mongoose";

import mongoose, { Schema } from "mongoose";
import { Vimcord } from "@vimcord/core";
import { MongoosePlugin, PLUGIN_NAME } from "./index.js";
import { MongoosePluginError } from "./MongoosePluginError.js";
import { sessionContext } from "./sessionContext.js";

type DistinctValue<Value> = Value extends readonly (infer Item)[] ? NonNullable<Item> : NonNullable<Value>;
type BuilderDefaults = Omit<DefaultSchemaOptions, "versionKey"> & { versionKey: false };
// Never intersect options with the defaults: `timestamps: true & false` becomes `never` and corrupts every document field.
type SchemaOpts<Opts> = Omit<BuilderDefaults, keyof Opts> & Opts;

type LeanDoc<Def, Opts> = InferRawDocType<Def, SchemaOpts<Opts>>;
type HydDoc<Def, Opts, Doc = ObtainDocumentType<Def, any, SchemaOpts<Opts>>> = HydratedDocument<
    Doc,
    {},
    {},
    {},
    Doc,
    SchemaOpts<Opts>
>;

/** Per-call `lean` wins, then the builder's `leanByDefault`, then lean. */
type ResolvedDoc<Def, Opts, QOpts> = QOpts extends { lean: false }
    ? HydDoc<Def, Opts>
    : [QOpts] extends [{ lean: unknown }]
      ? LeanDoc<Def, Opts>
      : Opts extends { leanByDefault: false }
        ? HydDoc<Def, Opts>
        : LeanDoc<Def, Opts>;

type BuilderSchema<Def, Opts> = Schema<LeanDoc<Def, Opts>>;
type BuilderModel<Def, Opts> = Model<LeanDoc<Def, Opts>, {}, {}, {}, HydDoc<Def, Opts>, BuilderSchema<Def, Opts>>;
type CreateDocument<Def, Opts> = Parameters<BuilderModel<Def, Opts>["create"]>[0];
type BulkWriteOperations<Def, Opts> = Parameters<BuilderModel<Def, Opts>["bulkWrite"]>[0];
type WithSession<Options> = Omit<Options, "session"> & { session?: mongoose.ClientSession | null };

function isDocumentArray<Document>(value: Document | Document[]): value is Document[] {
    return Array.isArray(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== "object") return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function isCacheKeyValue(value: unknown): value is string | number | boolean | mongoose.Types.ObjectId {
    return (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        value instanceof mongoose.Types.ObjectId
    );
}

/**
 * Freezes plain objects and arrays in place, leaving class instances such as ObjectId, Date, Decimal128, and Buffer
 * untouched. Freezing those reaches their internal typed arrays and throws.
 */
function deepFreeze<T>(value: T): T {
    if (Array.isArray(value)) {
        value.forEach(deepFreeze);
        Object.freeze(value);
    } else if (isPlainObject(value)) {
        Object.values(value).forEach(deepFreeze);
        Object.freeze(value);
    }
    return value;
}

export interface MongoSchemaBuilderOptions extends SchemaOptions {
    /** Return plain objects instead of hydrated Mongoose documents. @default true */
    leanByDefault?: boolean;
    /** Opt-in read cache keyed on a single schema path. Entries expire when their key is read again and have no size limit. */
    cache?: {
        /** The schema path to key the cache on. */
        key: string;
        /** How long an entry stays valid, in milliseconds. */
        ttl: number;
    };
}

// Both `const` modifiers keep literal options like `{ leanByDefault: false }` from widening to `boolean`.
export function createMongoSchema<
    const Def extends SchemaDefinition<any>,
    const Opts extends MongoSchemaBuilderOptions = {}
>(collection: string, definition: Def, options?: Opts): MongoSchemaBuilder<Def, Opts> {
    return new MongoSchemaBuilder(collection, definition, options);
}

export class MongoSchemaBuilder<
    Def extends SchemaDefinition<any> = SchemaDefinition<any>,
    Opts extends MongoSchemaBuilderOptions = {}
> {
    readonly client: Vimcord | null = null;
    readonly plugin: MongoosePlugin | null = null;

    readonly collection: string;
    readonly schema: BuilderSchema<Def, Opts>;
    model: BuilderModel<Def, Opts> | null = null;
    private readonly leanByDefault: boolean;
    private readonly cacheEntries = new Map<string, { value: unknown; expiresAt: number }>();
    private readonly inFlight = new Map<string, Promise<unknown>>();

    constructor(
        collectionName: string,
        definition: Def,
        private options: Opts = {} as Opts
    ) {
        this.collection = collectionName;
        this.leanByDefault = options.leanByDefault ?? true;
        this.schema = MongoSchemaBuilder.createSchema(definition, options);

        const cache = options.cache;
        if (cache && !this.schema.path(cache.key)) {
            throw new MongoosePluginError(`Cache key "${cache.key}" does not exist on the ${collectionName} schema`);
        }
    }

    private static createSchema<Def extends SchemaDefinition<any>, Opts extends MongoSchemaBuilderOptions>(
        definition: Def,
        options: Opts
    ): BuilderSchema<Def, Opts> {
        const { leanByDefault, cache, ...schemaOptions } = options;
        const schema = new Schema(definition, { versionKey: false, ...schemaOptions });
        return schema as BuilderSchema<Def, Opts>;
    }

    private getClient(): Vimcord {
        const client = this.client ?? Vimcord.getInstance();
        if (!client) {
            throw new MongoosePluginError("Vimcord client does not exist");
        }

        if (!this.client) {
            // NOTE: We're casting `this` because `client` is readonly
            (this as { client: Vimcord | null }).client = client;
        }

        return client;
    }

    private getPlugin(): MongoosePlugin {
        const client = this.getClient();
        const plugin = this.plugin ?? client.plugins.get<MongoosePlugin>(PLUGIN_NAME, true);
        if (!plugin) {
            throw new MongoosePluginError(`Plugin "${PLUGIN_NAME}" is required, but not installed on the client`);
        }

        if (!this.plugin) {
            // Get the MongoosePlugin from the client
            // NOTE: We're casting `this` because `plugin` is readonly
            (this as { plugin: MongoosePlugin | null }).plugin = plugin;
        }

        return plugin;
    }

    private compileModel(): BuilderModel<Def, Opts> {
        const plugin = this.getPlugin();

        if (this.model) return this.model;

        // Compile model on the plugin's mongoose instance
        this.model = plugin.mongoose.model<LeanDoc<Def, Opts>, BuilderModel<Def, Opts>>(
            this.collection,
            this.schema,
            this.collection
        );
        this.getClient().logger.plugin.debug(PLUGIN_NAME, `[${this.collection}] Compiled!`);

        return this.model;
    }

    private resolveOptions<Options extends object>(options?: Options): Options {
        if (options && Object.hasOwn(options, "session")) return options;

        const session = sessionContext.getStore();
        return (session ? { ...options, session } : (options ?? {})) as Options;
    }

    private getCacheKey(filter: QueryFilter<LeanDoc<Def, Opts>> | undefined): string | undefined {
        const cache = this.options.cache;
        if (!cache || !isPlainObject(filter)) return undefined;

        const keys = Reflect.ownKeys(filter);
        if (keys.length !== 1 || keys[0] !== cache.key) return undefined;

        const value = filter[cache.key];
        return isCacheKeyValue(value) ? String(value) : undefined;
    }

    private invalidateCache(filter?: QueryFilter<LeanDoc<Def, Opts>>): void {
        const cacheKey = this.getCacheKey(filter);
        if (cacheKey === undefined) {
            this.cacheEntries.clear();
            return;
        }

        this.cacheEntries.delete(cacheKey);
    }

    private async readCached<T>(cacheKey: string, ttl: number, read: () => Promise<T>): Promise<T> {
        const entry = this.cacheEntries.get(cacheKey);
        if (entry) {
            if (entry.expiresAt > Date.now()) return deepFreeze(entry.value) as T;
            this.cacheEntries.delete(cacheKey);
        }

        const existing = this.inFlight.get(cacheKey);
        if (existing) return (await existing) as T;

        const request = (async () => {
            const doc = await read();
            if (doc) {
                this.cacheEntries.set(cacheKey, {
                    value: deepFreeze(doc),
                    expiresAt: Date.now() + ttl
                });
            }
            return doc;
        })();

        this.inFlight.set(cacheKey, request);
        try {
            return await request;
        } finally {
            this.inFlight.delete(cacheKey);
        }
    }

    /**
     * Starts a new session.
     * @param options The options for the session
     */
    async startSession(options?: ClientSessionOptions): Promise<mongoose.ClientSession> {
        return await this.getPlugin().startSession(options);
    }

    /**
     * Starts and uses a new session.
     * @param fn The function to use inside of the session
     * @param options The options for the session
     */
    async useSession<T>(fn: (session: mongoose.ClientSession) => Promise<T>, options?: ClientSessionOptions): Promise<T> {
        return await this.getPlugin().useSession(fn, options);
    }

    /**
     * Starts a new transaction.
     * @param options The options for the transaction
     */
    async startTransaction(options?: mongoose.mongo.TransactionOptions): Promise<mongoose.ClientSession> {
        return await this.getPlugin().startTransaction(options);
    }

    /**
     * Starts and uses a new transaction.
     *
     * Builder calls inside the callback use this session automatically. Pass `{ session: null }` to run one call
     * outside it. Await all work started in the callback, because unawaited work keeps the session after the
     * transaction ends and fails.
     * @param fn The function to use inside of the transaction
     * @param options The options for the transaction
     */
    async useTransaction<T>(
        fn: (session: mongoose.ClientSession) => Promise<T>,
        options?: mongoose.mongo.TransactionOptions
    ): Promise<T> {
        return await this.getPlugin().useTransaction(fn, options);
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
     *
     * This checks before the caller writes, so concurrent callers can still choose the same value. Keep a unique index on
     * `path`; retries reduce collisions but do not prevent them.
     */
    async unique<Path extends keyof LeanDoc<Def, Opts> & string>(
        path: Path,
        fn: () => LeanDoc<Def, Opts>[Path] | Promise<LeanDoc<Def, Opts>[Path]>,
        maxRetries: number = 10
    ): Promise<LeanDoc<Def, Opts>[Path]> {
        if (maxRetries < 0) {
            throw new MongoosePluginError(`maxRetries must be greater than or equal to 0`);
        }

        const model = this.compileModel();

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            const value = await fn();
            const collision = await model
                .exists({ [path]: value } as QueryFilter<LeanDoc<Def, Opts>>)
                .setOptions(this.resolveOptions());

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
        filter?: QueryFilter<LeanDoc<Def, Opts>>,
        options?: WithSession<mongo.CountOptions & MongooseBaseQueryOptions<LeanDoc<Def, Opts>> & mongo.Abortable>
    ): Promise<number> {
        const model = this.compileModel();
        return await model.countDocuments(filter).setOptions(this.resolveOptions(options));
    }

    /**
     * Checks whether at least one document exists for a filter.
     *
     * @param filter The filter used to match documents
     */
    async exists(filter: QueryFilter<LeanDoc<Def, Opts>>, options?: QueryOptions<LeanDoc<Def, Opts>>): Promise<boolean> {
        const model = this.compileModel();
        return !!(await model.exists(filter).setOptions(this.resolveOptions(options)));
    }

    /**
     * Creates one or more documents.
     *
     * This always returns hydrated Mongoose documents because `Model.create` has no lean option.
     *
     * @param docs The documents to create
     * @param options The options to pass to Mongoose
     */
    async create(doc: CreateDocument<Def, Opts>, options?: CreateOptions): Promise<HydDoc<Def, Opts>>;
    async create(docs: CreateDocument<Def, Opts>[], options?: CreateOptions): Promise<HydDoc<Def, Opts>[]>;
    async create(
        docOrDocs: CreateDocument<Def, Opts> | CreateDocument<Def, Opts>[],
        options?: CreateOptions
    ): Promise<HydDoc<Def, Opts> | HydDoc<Def, Opts>[]> {
        const model = this.compileModel();
        const docs = isDocumentArray(docOrDocs) ? docOrDocs : [docOrDocs];
        const created = await model.create(docs, this.resolveOptions(options));

        return isDocumentArray(docOrDocs) ? created : created[0]!;
    }

    /**
     * Updates the first matching document, or creates it when no document matches.
     *
     * @param filter The filter used to match the document
     * @param update The update to apply when a document exists, or create from when it does not
     * @param options The query options to pass to Mongoose
     */
    async upsert<Options extends Omit<QueryOptions<LeanDoc<Def, Opts>>, "new" | "returnDocument" | "upsert">>(
        filter: QueryFilter<LeanDoc<Def, Opts>>,
        update: UpdateQuery<LeanDoc<Def, Opts>>,
        options?: Options
    ): Promise<ResolvedDoc<Def, Opts, Options>> {
        const model = this.compileModel();
        const queryOptions = this.resolveOptions(options);
        const result = await model.findOneAndUpdate(filter, update, {
            returnDocument: "after",
            ...queryOptions,
            upsert: true,
            lean: queryOptions.lean ?? this.leanByDefault
        });

        this.invalidateCache(filter);
        return result as unknown as ResolvedDoc<Def, Opts, Options>;
    }

    /**
     * Deletes the first document that matches a filter.
     *
     * @param filter The filter used to match the document
     * @param options The options to pass to MongoDB and Mongoose
     */
    async delete(
        filter: QueryFilter<LeanDoc<Def, Opts>>,
        options?: WithSession<mongo.DeleteOptions & MongooseBaseQueryOptions<LeanDoc<Def, Opts>>>
    ): Promise<mongo.DeleteResult> {
        const model = this.compileModel();
        const result = await model.deleteOne(filter).setOptions(this.resolveOptions(options));
        this.invalidateCache(filter);
        return result;
    }

    /**
     * Deletes every document that matches a filter.
     *
     * @param filter The filter used to match documents
     * @param options The options to pass to MongoDB and Mongoose
     */
    async deleteAll(
        filter: QueryFilter<LeanDoc<Def, Opts>>,
        options?: WithSession<mongo.DeleteOptions & MongooseBaseQueryOptions<LeanDoc<Def, Opts>>>
    ): Promise<mongo.DeleteResult> {
        const model = this.compileModel();
        const result = await model.deleteMany(filter).setOptions(this.resolveOptions(options));
        this.cacheEntries.clear();
        return result;
    }

    /**
     * Gets the unique values for a schema path across matching documents.
     *
     * @param path The schema path to read distinct values from
     * @param filter The filter used to limit documents
     * @param options The query options to pass to Mongoose
     */
    async distinct<Path extends keyof LeanDoc<Def, Opts> & string>(
        path: Path,
        filter?: QueryFilter<LeanDoc<Def, Opts>>,
        options?: QueryOptions<LeanDoc<Def, Opts>>
    ): Promise<DistinctValue<LeanDoc<Def, Opts>[Path]>[]> {
        const model = this.compileModel();
        const values = await model.distinct(path, filter, this.resolveOptions(options));

        return values as DistinctValue<LeanDoc<Def, Opts>[Path]>[];
    }

    /**
     * Fetches the first document that matches a filter.
     *
     * Queries use `leanByDefault`, which is `true` unless the builder overrides it. Pass `{ lean: false }` for a
     * hydrated Mongoose document.
     * Lean reads skip virtuals, getters, defaults, and `toJSON` and `toObject` transforms.
     * Passing `{ required: true }` throws when no document is found and removes `null` from the return type.
     *
     * @param filter The filter used to match the document
     * @param projection The fields to include or exclude
     * @param options The query options to pass to Mongoose
     */
    async fetch<Options extends QueryOptions<LeanDoc<Def, Opts>>>(
        filter?: QueryFilter<LeanDoc<Def, Opts>>,
        projection?: ProjectionType<LeanDoc<Def, Opts>>,
        options?: Options & { required?: false }
    ): Promise<ResolvedDoc<Def, Opts, Options> | null>;
    async fetch<Options extends QueryOptions<LeanDoc<Def, Opts>>>(
        filter?: QueryFilter<LeanDoc<Def, Opts>>,
        projection?: ProjectionType<LeanDoc<Def, Opts>>,
        options?: Options & { required: true }
    ): Promise<ResolvedDoc<Def, Opts, Options>>;
    async fetch<Options extends QueryOptions<LeanDoc<Def, Opts>>>(
        filter?: QueryFilter<LeanDoc<Def, Opts>>,
        projection?: ProjectionType<LeanDoc<Def, Opts>>,
        options?: Options & {
            /**
             * Throws when no document is found and removes `null` from the return type
             * @default false
             */
            required?: boolean;
        }
    ): Promise<ResolvedDoc<Def, Opts, Options> | null> {
        const model = this.compileModel();
        const { required = false, ...queryOptions } = (options ?? {}) as QueryOptions<LeanDoc<Def, Opts>> & {
            required?: boolean;
        };
        const resolvedOptions = this.resolveOptions(queryOptions);
        const lean = resolvedOptions.lean ?? this.leanByDefault;
        const cache = this.options.cache;
        const cacheKey =
            cache &&
            projection === undefined &&
            (resolvedOptions.session === undefined || resolvedOptions.session === null) &&
            resolvedOptions.sort === undefined &&
            resolvedOptions.skip === undefined &&
            resolvedOptions.limit === undefined &&
            lean
                ? this.getCacheKey(filter)
                : undefined;

        const result =
            cacheKey === undefined || !cache
                ? await model.findOne(filter, projection, { ...resolvedOptions, lean })
                : await this.readCached(cacheKey, cache.ttl, () =>
                      model.findOne(filter, null, { ...resolvedOptions, lean }).exec()
                  );
        if (required && !result) throw new MongoosePluginError(`Document not found`);

        return result as ResolvedDoc<Def, Opts, Options> | null;
    }

    /**
     * Fetches every document that matches a filter.
     *
     * Queries use `leanByDefault`, which is `true` unless the builder overrides it. Pass `{ lean: false }` for
     * hydrated Mongoose documents.
     * Lean reads skip virtuals, getters, defaults, and `toJSON` and `toObject` transforms.
     *
     * @param filter The filter used to match documents
     * @param projection The fields to include or exclude
     * @param options The query options to pass to Mongoose
     */
    async fetchAll<Options extends QueryOptions<LeanDoc<Def, Opts>>>(
        filter?: QueryFilter<LeanDoc<Def, Opts>>,
        projection?: ProjectionType<LeanDoc<Def, Opts>>,
        options?: Options
    ): Promise<ResolvedDoc<Def, Opts, Options>[]> {
        const model = this.compileModel();
        const queryOptions = this.resolveOptions(options);
        const results = await model.find(filter, projection, {
            ...queryOptions,
            lean: queryOptions.lean ?? this.leanByDefault
        });

        return results as ResolvedDoc<Def, Opts, Options>[];
    }

    /**
     * Fetches one page of matching documents and the pagination details.
     *
     * Page numbers start at `1`. Deep pages are slower because MongoDB scans skipped documents for offset pagination.
     *
     * @param filter The filter used to match documents
     * @param projection The fields to include or exclude
     * @param options The query options, page number, and page size
     */
    async paginate<Options extends QueryOptions<LeanDoc<Def, Opts>>>(
        filter?: QueryFilter<LeanDoc<Def, Opts>>,
        projection?: ProjectionType<LeanDoc<Def, Opts>>,
        options?: Options & { page?: number; limit?: number }
    ): Promise<{
        docs: ResolvedDoc<Def, Opts, Options>[];
        total: number;
        page: number;
        pages: number;
        hasPrev: boolean;
        hasNext: boolean;
    }> {
        const model = this.compileModel();
        const {
            page: requestedPage = 1,
            limit = 10,
            skip: _skip,
            ...queryOptions
        } = (options ?? {}) as Options & {
            page?: number;
            limit?: number;
        };
        const page = Math.max(1, requestedPage);
        const resolvedOptions = this.resolveOptions(queryOptions);
        const count = model.countDocuments(filter);

        if (Object.hasOwn(resolvedOptions, "session")) {
            count.session(resolvedOptions.session ?? null);
        }

        const [total, docs] = await Promise.all([
            count,
            model.find(filter, projection, {
                ...resolvedOptions,
                lean: resolvedOptions.lean ?? this.leanByDefault,
                skip: (page - 1) * limit,
                limit
            })
        ]);
        const pages = Math.ceil(total / limit);

        return {
            docs: docs as ResolvedDoc<Def, Opts, Options>[],
            total,
            page,
            pages,
            hasPrev: page > 1,
            hasNext: page < pages
        };
    }

    /**
     * Fetches the latest document that matches a filter.
     *
     * Queries use `leanByDefault`, which is `true` unless the builder overrides it. Pass `{ lean: false }` for a
     * hydrated Mongoose document.
     *
     * @param filter The filter used to match the document
     * @param projection The fields to include or exclude
     * @param options The query options to pass to Mongoose
     */
    async fetchLatest<Options extends QueryOptions<LeanDoc<Def, Opts>>>(
        filter: QueryFilter<LeanDoc<Def, Opts>>,
        projection?: ProjectionType<LeanDoc<Def, Opts>>,
        options?: Options
    ): Promise<ResolvedDoc<Def, Opts, Options> | null> {
        if (!options?.sort && !this.schema.path("createdAt")) {
            throw new MongoosePluginError(
                "fetchLatest needs either a createdAt path, via timestamps or an explicit field, or an explicit sort"
            );
        }

        const model = this.compileModel();
        const queryOptions = this.resolveOptions(options);
        const result = await model.findOne(filter, projection, {
            ...queryOptions,
            lean: queryOptions.lean ?? this.leanByDefault,
            sort: queryOptions.sort ?? { createdAt: -1 }
        });

        return result as ResolvedDoc<Def, Opts, Options> | null;
    }

    /**
     * Updates the first document that matches a filter and returns the updated document.
     *
     * Queries use `leanByDefault`, which is `true` unless the builder overrides it. Pass `{ lean: false }` for a
     * hydrated Mongoose document.
     *
     * @param filter The filter used to match the document
     * @param update The update to apply
     * @param options The query options to pass to Mongoose
     */
    async update<Options extends Omit<QueryOptions<LeanDoc<Def, Opts>>, "returnDocument">>(
        filter: QueryFilter<LeanDoc<Def, Opts>>,
        update: UpdateQuery<LeanDoc<Def, Opts>>,
        options?: Options
    ): Promise<ResolvedDoc<Def, Opts, Options> | null> {
        const model = this.compileModel();
        const queryOptions = this.resolveOptions(options);
        const result = await model.findOneAndUpdate(filter, update, {
            ...queryOptions,
            lean: queryOptions.lean ?? this.leanByDefault,
            returnDocument: "after"
        });

        this.invalidateCache(filter);
        return result as ResolvedDoc<Def, Opts, Options> | null;
    }

    /**
     * Updates every document that matches a filter.
     *
     * @param filter The filter used to match documents
     * @param update The update to apply
     * @param options The options to pass to MongoDB and Mongoose
     */
    async updateAll(
        filter: QueryFilter<LeanDoc<Def, Opts>>,
        update: UpdateQuery<LeanDoc<Def, Opts>>,
        options?: WithSession<mongo.UpdateOptions & MongooseUpdateQueryOptions<LeanDoc<Def, Opts>>>
    ): Promise<mongo.UpdateResult> {
        const model = this.compileModel();
        const result = await model.updateMany(
            filter,
            update,
            this.resolveOptions(options) as mongo.UpdateOptions & MongooseUpdateQueryOptions<LeanDoc<Def, Opts>>
        );
        this.cacheEntries.clear();
        return result;
    }

    /**
     * Runs an aggregation pipeline against the collection.
     *
     * @param pipeline The aggregation pipeline stages to run
     * @param options The aggregation options to pass to Mongoose
     */
    async aggregate<Result = unknown>(pipeline: PipelineStage[], options?: AggregateOptions): Promise<Result[]> {
        const model = this.compileModel();
        return await model.aggregate<Result>(pipeline, this.resolveOptions(options));
    }

    /**
     * Runs multiple write operations in a single MongoDB command.
     *
     * @param ops The write operations to run
     * @param options The bulk write options to pass to Mongoose
     */
    async bulkWrite(
        ops: BulkWriteOperations<Def, Opts>,
        options?: WithSession<MongooseBulkWriteOptions>
    ): Promise<mongo.BulkWriteResult> {
        const model = this.compileModel();
        const result = await model.bulkWrite(ops, this.resolveOptions(options) as MongooseBulkWriteOptions);
        this.cacheEntries.clear();
        return result;
    }

    /**
     * Saves multiple hydrated documents in a single bulk write.
     *
     * @param docs The hydrated documents to save
     * @param options The bulk write options to pass to Mongoose
     */
    async bulkSave(
        docs: HydDoc<Def, Opts>[],
        options?: WithSession<MongooseBulkSaveOptions>
    ): Promise<mongo.BulkWriteResult> {
        const model = this.compileModel();
        const result = await model.bulkSave(docs, this.resolveOptions(options) as MongooseBulkSaveOptions);
        this.cacheEntries.clear();
        return result;
    }
}
