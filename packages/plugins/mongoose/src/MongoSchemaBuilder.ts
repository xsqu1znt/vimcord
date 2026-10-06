import type {
    AggregateOptions,
    ClientSessionOptions,
    CreateOptions,
    DefaultSchemaOptions,
    HydratedDocument,
    InferRawDocType,
    InsertManyOptions,
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
    UpdateQuery,
    UpdateWithAggregationPipeline
} from "mongoose";

import mongoose, { Schema } from "mongoose";
import { Vimcord } from "vimcord";
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

/** The lean document type a `MongoSchemaBuilder` infers, for naming it as a consumer-facing interface. */
export type InferDoc<B> = B extends MongoSchemaBuilder<infer Def, infer Opts> ? LeanDoc<Def, Opts> : never;
/** The hydrated document type a `MongoSchemaBuilder` infers, for typing values returned by `create()` or `{ lean: false }` reads. */
export type InferHydratedDoc<B> = B extends MongoSchemaBuilder<infer Def, infer Opts> ? HydDoc<Def, Opts> : never;
/** The document shape accepted by a `MongoSchemaBuilder`'s `create()`, for hand-building literals such as `bulkWrite` operations. */
export type CreateDocument<B> = B extends MongoSchemaBuilder<infer Def, infer Opts> ? CreateDocInput<Def, Opts> : never;

/** Per-call `lean` wins, then the builder's `leanByDefault`, then lean. */
type ResolvedDoc<Def, Opts, QOpts> = QOpts extends { lean: false }
    ? HydDoc<Def, Opts>
    : [QOpts] extends [{ lean: unknown }]
      ? LeanDoc<Def, Opts>
      : Opts extends { leanByDefault: false }
        ? HydDoc<Def, Opts>
        : LeanDoc<Def, Opts>;

/**
 * `update()` returns `null` when nothing matched. An upsert always yields a document, unless `returnDocument` can be
 * `"before"`: an inserted document had no previous state.
 */
type UpdateResult<Def, Opts, QOpts> =
    | ResolvedDoc<Def, Opts, QOpts>
    | (QOpts extends { upsert: true } ? ("before" extends QOpts[keyof QOpts & "returnDocument"] ? null : never) : null);

type BuilderSchema<Def, Opts> = Schema<LeanDoc<Def, Opts>>;
type BuilderModel<Def, Opts> = Model<LeanDoc<Def, Opts>, {}, {}, {}, HydDoc<Def, Opts>, BuilderSchema<Def, Opts>>;
type CreateDocInput<Def, Opts> = Parameters<BuilderModel<Def, Opts>["create"]>[0];
type BulkWriteOperations<Def, Opts> = Parameters<BuilderModel<Def, Opts>["bulkWrite"]>[0];
type WithSession<Options> = Omit<Options, "session"> & { session?: mongoose.ClientSession | null };

export interface MongoSchemaBuilderOptions extends SchemaOptions {
    /** Return plain objects instead of hydrated Mongoose documents. @default true */
    leanByDefault?: boolean;
    /** Opt-in read cache for full lean documents fetched by a single schema path. */
    cache?: {
        /** The schema path to key the cache on. */
        key: string;
        /** How long an entry stays valid, in milliseconds. */
        ttl: number;
        /** Maximum retained documents, evicting the oldest insertion first. @default 1000 */
        maxEntries?: number;
    };
}

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

// Cursor boundaries use stored values even when hydrated documents expose transforming getters.
function getCursorValue(document: object, path: string): unknown {
    return document instanceof mongoose.Document
        ? document.get(path, undefined, { getters: false })
        : Reflect.get(document, path);
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
    private cacheTimer: ReturnType<typeof setTimeout> | undefined;

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
            this.inFlight.clear();
            if (this.cacheTimer) clearTimeout(this.cacheTimer);
            this.cacheTimer = undefined;
            return;
        }

        this.cacheEntries.delete(cacheKey);
        this.inFlight.delete(cacheKey);
    }

    // One unreferenced timer per builder removes expired one-time keys even when reads stop.
    private scheduleCacheExpiry(): void {
        if (this.cacheTimer || !this.cacheEntries.size) return;
        const first = this.cacheEntries.values().next().value!;
        this.cacheTimer = setTimeout(
            () => {
                this.cacheTimer = undefined;
                const now = Date.now();
                for (const [key, entry] of this.cacheEntries) {
                    if (entry.expiresAt > now) break;
                    this.cacheEntries.delete(key);
                }
                this.scheduleCacheExpiry();
            },
            Math.max(1, first.expiresAt - Date.now())
        );
        this.cacheTimer.unref();
    }

    private async readCached<T>(cacheKey: string, ttl: number, read: () => Promise<T>): Promise<T> {
        const entry = this.cacheEntries.get(cacheKey);
        if (entry?.expiresAt && entry.expiresAt > Date.now()) return entry.value as T;
        this.cacheEntries.delete(cacheKey);

        const existing = this.inFlight.get(cacheKey);
        if (existing) return (await existing) as T;

        const request = Promise.resolve()
            .then(read)
            .then(doc => {
                // Invalidated reads may finish for their caller, but must not populate or replace the cache.
                if (doc && this.inFlight.get(cacheKey) === request) {
                    const maxEntries = this.options.cache?.maxEntries ?? 1000;
                    if (maxEntries > 0 && ttl > 0) {
                        while (this.cacheEntries.size >= maxEntries) {
                            this.cacheEntries.delete(this.cacheEntries.keys().next().value!);
                        }
                        this.cacheEntries.set(cacheKey, { value: deepFreeze(doc), expiresAt: Date.now() + ttl });
                        this.scheduleCacheExpiry();
                    }
                }
                return doc;
            });

        this.inFlight.set(cacheKey, request);
        try {
            return await request;
        } finally {
            if (this.inFlight.get(cacheKey) === request) this.inFlight.delete(cacheKey);
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
        try {
            return await this.getPlugin().useTransaction(fn, options);
        } finally {
            this.invalidateCache();
        }
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
    async create(doc: CreateDocInput<Def, Opts>, options?: CreateOptions): Promise<HydDoc<Def, Opts>>;
    async create(docs: CreateDocInput<Def, Opts>[], options?: CreateOptions): Promise<HydDoc<Def, Opts>[]>;
    async create(
        docOrDocs: CreateDocInput<Def, Opts> | CreateDocInput<Def, Opts>[],
        options?: CreateOptions
    ): Promise<HydDoc<Def, Opts> | HydDoc<Def, Opts>[]> {
        const model = this.compileModel();
        const docs = isDocumentArray(docOrDocs) ? docOrDocs : [docOrDocs];
        let created: HydDoc<Def, Opts>[];
        try {
            created = await model.create(docs, this.resolveOptions(options));
        } finally {
            this.invalidateCache();
        }

        return isDocumentArray(docOrDocs) ? created : created[0]!;
    }

    /**
     * Inserts a batch with Mongoose validation and insertMany middleware, without save middleware.
     * @param docs Documents to insert
     * @param options Ordered insertion and session options
     */
    async insertMany(
        docs: CreateDocInput<Def, Opts>[],
        options?: Pick<InsertManyOptions, "ordered" | "session" | "limit">
    ): Promise<HydDoc<Def, Opts>[]> {
        try {
            return (await this.compileModel().insertMany(docs, this.resolveOptions(options))) as unknown as HydDoc<
                Def,
                Opts
            >[];
        } finally {
            this.invalidateCache();
        }
    }

    /**
     * Generates and creates a document, retrying collisions on a single-field unique index at `path`.
     * Uses create(), preserving validation and save middleware. Other duplicate indexes and errors propagate.
     * @param path Indexed schema path
     * @param doc Document to create
     * @param fn Candidate generator
     * @param maxRetries Collision retries after the initial attempt
     */
    async createUnique<Path extends keyof LeanDoc<Def, Opts> & string>(
        path: Path,
        doc: CreateDocInput<Def, Opts>,
        fn: () => LeanDoc<Def, Opts>[Path] | Promise<LeanDoc<Def, Opts>[Path]>,
        maxRetries: number = 10
    ): Promise<HydDoc<Def, Opts>> {
        if (maxRetries < 0) throw new MongoosePluginError("maxRetries must be greater than or equal to 0");
        for (let attempt = 0; ; attempt++) {
            const value = await fn();
            try {
                return await this.create(Object.assign({}, doc, { [path]: value }));
            } catch (err) {
                if (
                    !(err instanceof mongoose.mongo.MongoServerError) ||
                    err.code !== 11000 ||
                    Object.keys(err.keyPattern ?? {}).length !== 1 ||
                    !Object.hasOwn(err.keyPattern ?? {}, path) ||
                    attempt >= maxRetries
                )
                    throw err;
            }
        }
    }

    /**
     * Updates one document and returns write counts, using updateOne query middleware.
     * @param filter Document filter
     * @param update Update to apply
     * @param options Update options, including opt-in runValidators
     */
    async updateOne(
        filter: QueryFilter<LeanDoc<Def, Opts>>,
        update: UpdateQuery<LeanDoc<Def, Opts>>,
        options?: WithSession<mongo.UpdateOptions & MongooseUpdateQueryOptions<LeanDoc<Def, Opts>>>
    ): Promise<mongo.UpdateResult> {
        try {
            const result = await this.compileModel().updateOne(
                filter,
                update,
                this.resolveOptions(options) as mongo.UpdateOptions & MongooseUpdateQueryOptions<LeanDoc<Def, Opts>>
            );
            return result;
        } finally {
            this.invalidateCache();
        }
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
        try {
            const result = await model.findOneAndUpdate(filter, update, {
                returnDocument: "after",
                ...queryOptions,
                upsert: true,
                lean: queryOptions.lean ?? this.leanByDefault
            });

            return result as unknown as ResolvedDoc<Def, Opts, Options>;
        } finally {
            this.invalidateCache();
        }
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
        try {
            const result = await model.deleteOne(filter).setOptions(this.resolveOptions(options));
            return result;
        } finally {
            this.invalidateCache(filter);
        }
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
        try {
            const result = await model.deleteMany(filter).setOptions(this.resolveOptions(options));
            return result;
        } finally {
            this.invalidateCache();
        }
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
            lean === true &&
            Object.entries(resolvedOptions).every(
                ([key, value]) =>
                    value === undefined || (key === "lean" && value === true) || (key === "session" && value === null)
            )
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
     * Fetches limit + 1 documents without counting or skipping. Index `{ [path]: direction, _id: direction }`
     * when using a path other than `_id`; the `_id` tie-breaker makes equal values stable.
     * @param filter Document filter
     * @param options Page size, ordering and the previous nextCursor; lean/session options
     */
    async paginateCursor<Options extends Pick<QueryOptions<LeanDoc<Def, Opts>>, "lean" | "session">>(
        filter: QueryFilter<LeanDoc<Def, Opts>> = {},
        options?: Options & {
            limit?: number;
            path?: keyof LeanDoc<Def, Opts> & string;
            direction?: 1 | -1;
            after?: { value: unknown; id: mongoose.Types.ObjectId };
        }
    ): Promise<{
        docs: ResolvedDoc<Def, Opts, Options>[];
        hasNext: boolean;
        nextCursor: { value: unknown; id: mongoose.Types.ObjectId } | null;
    }> {
        const { limit = 10, path = "_id", direction = 1, after, ...queryOptions } = options ?? {};
        if (!Number.isInteger(limit) || limit < 1) throw new MongoosePluginError("limit must be a positive integer");
        const op = direction === 1 ? "$gt" : "$lt";
        const boundary = after
            ? path === "_id"
                ? { _id: { [op]: after.id } }
                : {
                      $or: [{ [path]: { [op]: after.value } }, { [path]: after.value, _id: { [op]: after.id } }]
                  }
            : undefined;
        const resolvedOptions = this.resolveOptions(queryOptions) as QueryOptions<LeanDoc<Def, Opts>>;
        const rows = await this.compileModel().find(boundary ? { $and: [filter, boundary] } : filter, null, {
            ...resolvedOptions,
            lean: resolvedOptions.lean ?? this.leanByDefault,
            sort: path === "_id" ? { _id: direction } : { [path]: direction, _id: direction },
            limit: limit + 1
        });
        const hasNext = rows.length > limit;
        const docs = rows.slice(0, limit);
        const last = docs.at(-1);
        return {
            docs: docs as unknown as ResolvedDoc<Def, Opts, Options>[],
            hasNext,
            nextCursor:
                hasNext && last
                    ? { value: getCursorValue(last, path), id: getCursorValue(last, "_id") as mongoose.Types.ObjectId }
                    : null
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
     * Pass an aggregation pipeline as `update` to compute the new values from the stored document in one atomic
     * operation. Pipeline stages are not cast to the schema.
     * Pass `{ returnDocument: "before" }` to get the document as it was before the update. With `upsert`, that is `null`
     * when the document was inserted.
     * Queries use `leanByDefault`, which is `true` unless the builder overrides it. Pass `{ lean: false }` for a
     * hydrated Mongoose document.
     *
     * @param filter The filter used to match the document
     * @param update The update object or aggregation pipeline to apply
     * @param options The query options to pass to Mongoose
     */
    async update<Options extends QueryOptions<LeanDoc<Def, Opts>>>(
        filter: QueryFilter<LeanDoc<Def, Opts>>,
        update: UpdateQuery<LeanDoc<Def, Opts>> | UpdateWithAggregationPipeline,
        options?: Options
    ): Promise<UpdateResult<Def, Opts, Options>> {
        const model = this.compileModel();
        const queryOptions = this.resolveOptions(options);
        try {
            const result = await model.findOneAndUpdate(filter, update, {
                ...queryOptions,
                lean: queryOptions.lean ?? this.leanByDefault,
                returnDocument: queryOptions.returnDocument ?? "after",
                updatePipeline: Array.isArray(update) || queryOptions.updatePipeline
            });

            return result as UpdateResult<Def, Opts, Options>;
        } finally {
            this.invalidateCache();
        }
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
        try {
            const result = await model.updateMany(
                filter,
                update,
                this.resolveOptions(options) as mongo.UpdateOptions & MongooseUpdateQueryOptions<LeanDoc<Def, Opts>>
            );
            return result;
        } finally {
            this.invalidateCache();
        }
    }

    /**
     * Runs an aggregation pipeline against the collection.
     *
     * @param pipeline The aggregation pipeline stages to run
     * @param options The aggregation options to pass to Mongoose
     */
    async aggregate<Result = unknown>(pipeline: PipelineStage[], options?: AggregateOptions): Promise<Result[]> {
        const model = this.compileModel();
        const writes = pipeline.some(stage => "$out" in stage || "$merge" in stage);
        try {
            return await model.aggregate<Result>(pipeline, this.resolveOptions(options));
        } finally {
            if (writes) this.invalidateCache();
        }
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
        try {
            return await model.bulkWrite(ops, this.resolveOptions(options) as MongooseBulkWriteOptions);
        } finally {
            this.invalidateCache();
        }
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
        try {
            return await model.bulkSave(docs, this.resolveOptions(options) as MongooseBulkSaveOptions);
        } finally {
            this.invalidateCache();
        }
    }
}
