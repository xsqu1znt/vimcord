/* Check if Mongoose is installed */
try {
    import("mongoose");
} catch {
    throw new Error("MongoSchemaBuilder requires the mongoose package, install it with `npm install mongoose`");
}

import { Logger } from "@/tools/Logger";
import {
    AggregateOptions,
    AnyBulkWriteOperation,
    ClientSession,
    ClientSessionOptions,
    CreateOptions,
    Document,
    HydratedDocument,
    Model,
    mongo,
    MongooseBaseQueryOptions,
    MongooseBulkWriteOptions,
    MongooseUpdateQueryOptions,
    PipelineStage,
    ProjectionType,
    QueryOptions,
    Require_id,
    RootFilterQuery,
    Schema,
    SchemaDefinition,
    SchemaOptions,
    UpdateQuery
} from "mongoose";
import { retry } from "qznt";
import { MongoDatabase } from "./mongo.database";

export type MongoPlugin<Definition extends object> = (builder: MongoSchemaBuilder<Definition>) => void;
export type ExtractReturn<T> = T extends (this: any, ...args: any) => infer R ? Awaited<R> : never;
export type LeanOrHydratedDocument<T, O extends QueryOptions<T>> = O["lean"] extends false
    ? HydratedDocument<T>
    : Require_id<T>;

export interface MongoSchemaOptions<Definition extends object> extends SchemaOptions<Definition> {
    instanceId?: number;
}

export function createMongoSchema<Definition extends object>(
    collection: string,
    definition: SchemaDefinition<Definition>,
    options?: MongoSchemaOptions<Definition>
): MongoSchemaBuilder<Definition> {
    return MongoSchemaBuilder.create(collection, definition, options);
}

/**
 * Creates a plugin to be used with MongoSchemaBuilder.
 *
 * @example
 * ```ts
 * // Register your plugin globally
 * MongoSchemaBuilder.use(SoftDeletePlugin);
 * MongoSchemaBuilder.use(AuthorizablePlugin("role"));
 *
 * // Or just this schema
 * const UserSchema = createMongoSchema("Users", {
 *     username: String,
 *     password: String,
 *     role: String
 * })
 *
 * UserSchema.use(SoftDeletePlugin);
 * UserSchema.use(AuthorizablePlugin("role"));
 * ```
 *
 * @example
 * ```ts
 * // A soft-delete style plugin
 * export const SoftDeletePlugin = createMongoPlugin(builder => {
 *     // Add field to schema
 *     builder.schema.add({ deletedAt: { type: Date, default: null } });
 *
 *     // Add a custom method to the MongoSchemaBuilder
 *     builder.extend({
 *         async softDelete(filter: any) {
 *             return this.update(filter, { deletedAt: new Date() } as any);
 *         }
 *     });
 *
 *     // Add middleware to filter out deleted items
 *     builder.schema.pre(/^find/, function() {
 *         this.where({ deletedAt: null });
 *     });
 * })
 * ```
 *
 * @example
 * ```ts
 * // Or maybe you want a plugin that takes options?
 * export const AuthorizablePlugin = (roleField: string) => {
 *     return createMongoPlugin(builder => {
 *         builder.extend({
 *             async findByRole(role: string) {
 *                 return this.fetchAll({ [roleField]: role } as any);
 *             }
 *         });
 *     });
 * };
 * ```
 */
export function createMongoPlugin<Definition extends object = any>(
    plugin: MongoPlugin<Definition>
): MongoPlugin<Definition> {
    return plugin;
}

export class MongoSchemaBuilder<Definition extends object = any> {
    private static globalPlugins: MongoPlugin<any>[] = [];

    readonly collection: string;
    readonly instanceId: number;

    readonly schema: Schema<Definition>;
    model: Model<Definition> | null = null;
    db: MongoDatabase | null = null;

    private logger: Logger;
    private compilingModel: Promise<Model<Definition>> | null = null;

    static create<Definition extends object = any>(
        collection: string,
        definition: SchemaDefinition<Definition>,
        options?: MongoSchemaOptions<Definition>
    ) {
        return new MongoSchemaBuilder(collection, definition, options);
    }

    /**
     * Registers a plugin globally to be used by all future schemas.
     */
    static use(plugin: MongoPlugin<any>) {
        this.globalPlugins.push(plugin);
    }

    constructor(collection: string, definition: SchemaDefinition<Definition>, options: MongoSchemaOptions<Definition> = {}) {
        const { instanceId = 0, ...schemaOptions } = options;

        this.instanceId = instanceId;
        this.collection = collection;
        this.schema = new Schema(definition, { versionKey: false, ...schemaOptions });

        this.logger = new Logger({
            prefixEmoji: "🥭",
            prefix: `MongoSchema (i${instanceId}) [${collection}]`,
            colors: { primary: "#F29B58" }
        });

        // Apply global plugins immediately
        for (const plugin of MongoSchemaBuilder.globalPlugins) {
            plugin(this);
        }
    }

    private async getModel() {
        if (this.model) return this.model;
        if (this.compilingModel) return this.compilingModel;

        const fn = async () => {
            // Find the MongoDatabase instance
            this.db = (await MongoDatabase.getReadyInstance(this.instanceId)) || null;
            if (!this.db) {
                throw new Error(`MongoDatabase instance (${this.instanceId}) not found for schema ${this.collection}`);
            }

            // Compile model on the instance's mongoose instance
            this.model = this.db.mongoose.model<Definition>(this.collection, this.schema);

            // Verbose logging
            if (this.db?.client.config.app.verbose) {
                this.logger.debug(`Compiled! | ${this.db?.client.config.app.name}`);
            }

            this.compilingModel = null;
            return this.model;
        };

        this.compilingModel = fn();
        const res = await this.compilingModel;
        return res;
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

    /**
     * Registers a plugin to just this instance.
     */
    use(plugin: MongoPlugin<Definition>): this {
        plugin(this);
        return this;
    }

    /**
     * Handles model resolution, connection ready, and retries.
     * @param fn The function to execute
     * @param maxRetries [default: 3]
     */
    async execute<T extends (model: Model<Definition>) => any>(fn: T, maxRetries: number = 3): Promise<ExtractReturn<T>> {
        return retry(
            async () => {
                const model = await this.getModel();
                return await fn(model);
            },
            { retries: maxRetries }
        );
    }

    async startSession(options?: ClientSessionOptions) {
        return this.execute(async () => {
            if (!this.db) throw new Error("No database instance found");
            return await this.db.startSession(options);
        });
    }

    async useTransaction(fn: (session: ClientSession, model: Model<Definition>) => any) {
        return this.execute(async model => {
            if (!this.db) throw new Error("No database instance found");
            return await this.db.useTransaction(session => fn(session, model));
        });
    }

    async createUniqueId(collisionPath: keyof Require_id<Definition>, fn: () => string, maxRetries: number = 10) {
        return this.execute(async model => {
            let id: string;
            let tries = 0;

            do {
                if (tries >= maxRetries) throw new Error(`Failed to generate a unique ID after ${tries} attempt(s)`);
                id = fn();
                tries++;
            } while (await model.exists({ [collisionPath]: id } as Partial<Require_id<Definition>>));

            return id;
        });
    }

    async count(
        filter?: RootFilterQuery<Definition>,
        options?: mongo.CountOptions & MongooseBaseQueryOptions<Definition> & mongo.Abortable
    ) {
        return this.execute(async model => model.countDocuments(filter, options));
    }

    async exists(filter: RootFilterQuery<Definition>) {
        return this.execute(async model => !!(await model.exists(filter)));
    }

    async create(query: Partial<Require_id<Definition>>[], options?: CreateOptions) {
        return this.execute(async model => model.create(query, options));
    }

    async upsert(
        filter: RootFilterQuery<Definition>,
        query: Partial<Require_id<Definition>>,
        options?: Exclude<QueryOptions<Definition>, "upsert">
    ) {
        return this.execute(async model =>
            model.findOneAndUpdate(filter, query, { returnDocument: "after", ...options, upsert: true })
        );
    }

    async delete(filter: RootFilterQuery<Definition>, options?: mongo.DeleteOptions & MongooseBaseQueryOptions<Definition>) {
        return this.execute(async model => model.deleteOne(filter, options));
    }

    async deleteAll(
        filter: RootFilterQuery<Definition>,
        options?: mongo.DeleteOptions & MongooseBaseQueryOptions<Definition>
    ) {
        return this.execute(async model => model.deleteMany(filter, options));
    }

    async distinct<K extends keyof Require_id<Definition> & string>(
        key: K,
        filter?: RootFilterQuery<Definition>,
        options?: QueryOptions<Definition>
    ) {
        return this.execute(async model => model.distinct(key, filter, options));
    }

    async fetch<Options extends QueryOptions<Definition>>(
        filter?: RootFilterQuery<Definition>,
        projection?: ProjectionType<Definition>,
        options?: Options & { required?: boolean }
    ): Promise<LeanOrHydratedDocument<Definition, Options> | null | undefined>;
    async fetch<Options extends QueryOptions<Definition>>(
        filter?: RootFilterQuery<Definition>,
        projection?: ProjectionType<Definition>,
        options?: Options & { required: true }
    ): Promise<LeanOrHydratedDocument<Definition, Options>>;
    async fetch<Options extends QueryOptions<Definition>>(
        filter?: RootFilterQuery<Definition>,
        projection?: ProjectionType<Definition>,
        options?: Options & {
            /**
             * Makes the return type forced truthy. Use this when you know the will document always exists.
             * @defaultValue false
             */
            required?: boolean;
        }
    ): Promise<LeanOrHydratedDocument<Definition, Options> | null | undefined> {
        const result = await this.execute(async model =>
            model.findOne(filter, projection, { ...options, lean: options?.lean ?? true })
        );
        if (options?.required && !result) throw new Error("Document not found");
        return result;
    }

    async fetchAll<Options extends QueryOptions<Definition>>(
        filter: RootFilterQuery<Definition> = {},
        projection?: ProjectionType<Definition>,
        options?: Options
    ): Promise<LeanOrHydratedDocument<Definition, Options>[]> {
        return this.execute(async model => model.find(filter, projection, { ...options, lean: options?.lean ?? true }));
    }

    async update<Options extends QueryOptions<Definition>>(
        filter: RootFilterQuery<Definition>,
        update: UpdateQuery<Definition>,
        options?: Options
    ): Promise<LeanOrHydratedDocument<Definition, Options> | null | undefined> {
        return this.execute(async model =>
            model.findOneAndUpdate(filter, update, { ...options, lean: options?.lean ?? true })
        );
    }

    async updateAll(
        filter: RootFilterQuery<Definition>,
        update: UpdateQuery<Definition>,
        options?: mongo.UpdateOptions & MongooseUpdateQueryOptions<Definition>
    ) {
        return this.execute(async model => model.updateMany(filter, update, options));
    }

    async aggregate<T extends any>(pipeline: PipelineStage[], options?: AggregateOptions): Promise<T[]> {
        return this.execute(async model => {
            const result = await model.aggregate<T>(pipeline, options);
            return result?.length ? result : [];
        });
    }

    async bulkWrite(ops: AnyBulkWriteOperation[], options?: MongooseBulkWriteOptions) {
        return this.execute(async model => model.bulkWrite(ops, options));
    }

    async bulkSave(docs: Document[], options?: MongooseBulkWriteOptions) {
        return this.execute(async model => model.bulkSave(docs, options));
    }
}
