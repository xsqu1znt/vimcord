import type { MongoSchemaBuilder } from "./MongoSchemaBuilder.js";

export type MongoPlugin<Definition = any> = (builder: MongoSchemaBuilder<Definition>) => void;

/**
 * Creates a plugin that can be used with MongoSchemaBuilder.
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
 * // Or maybe you want a plugin that takes options
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
export function createMongoPlugin<Definition>(plugin: MongoPlugin<Definition>): MongoPlugin<Definition> {
    return plugin;
}
