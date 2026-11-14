# Mongoose

The plugin owns an isolated `mongoose.Mongoose` instance. Pass it in the client's plugins before login. Its initial connection has three retries with exponential backoff; failure aborts login. Disconnections and reconnections are logged, health is available through `/ping`, and client destruction disconnects it.

```ts
import { MongoosePlugin } from "@vimcord/plugin-mongoose";

const database = new MongoosePlugin({ connectOptions: { maxPoolSize: 10 } });
```

| Plugin option | Meaning | Default |
| --- | --- | --- |
| `uri` | MongoDB connection URI | `MONGO_URI_DEV` in dev mode, otherwise `MONGO_URI` |
| `connectOptions` | Options passed to `mongoose.connect()` | Mongoose defaults |

Use the dotenv plugin first when environment loading is needed. Plugin `mongoose` exposes its owning `client` and isolated `mongoose` instance. Connection setup and teardown belong to the client lifecycle.

## Schemas and indexes

```ts
import type { InferDoc } from "@vimcord/plugin-mongoose";
import { createMongoSchema } from "@vimcord/plugin-mongoose";

const Users = createMongoSchema("users", {
    userId: { type: String, required: true },
    points: { type: Number, default: 0 },
    profile: { imageUrl: String }
}, { timestamps: true });
Users.index({ userId: 1 }, { unique: true });
type UserRecord = InferDoc<typeof Users>;
```

`createMongoSchema(collection, definition, options?)` preserves literal field inference and returns `MongoSchemaBuilder`. Schema options are Mongoose's `SchemaOptions` plus optional `cache`; `versionKey` defaults to false. `schema` exposes the schema for middleware, virtuals, and plugins. `index(fields, options?)` delegates to `schema.index()` and returns the builder.

`model` compiles lazily on the first access or builder operation, after the Mongoose plugin installs. Configure indexes and middleware before that access. It is a non-null typed getter and throws when the client/plugin is unavailable. `collection` is the collection name. Raw Mongoose reads, writes, queries, sessions, and index initialization are available through `model` and the isolated instance.

## Reads and writes

```ts
const user = await Users.fetch({ userId: USER_ID });
const requiredUser = await Users.fetch({ userId: USER_ID }, undefined, { required: true });
const document = await Users.fetch({ userId: USER_ID }, undefined, { lean: false });
const points = await Users.fetch({ userId: USER_ID }, { points: 1 });
const samePoints = await Users.fetch({ userId: USER_ID }, undefined, { projection: { points: 1 } });
const images = await Users.distinct("profile.imageUrl");
await Users.updateOne({ userId: USER_ID }, { $inc: { points: 5 } }, { runValidators: true });
```

| Method | Result or behavior |
| --- | --- |
| `fetch(filter?, projection?, options?)` | First match or null; required true throws instead of null |
| `fetchAll(filter?, projection?, options?)` | All matches |
| `count(filter?, options?)` | Matching document count |
| `exists(filter, options?)` | Boolean |
| `distinct(path, filter?, options?)` | Inferred distinct values, including dotted paths and array elements |
| `create(docOrDocs, options?)` | Hydrated document or array; save validation and middleware |
| `insertMany(docs, { ordered?, session?, limit? })` | Hydrated array; validation and insertMany middleware, no save middleware |
| `createUnique(path, doc, generate, maxRetries = 10)` | Generates and creates, retrying collisions on that single-field index |
| `update(filter, update, options?)` | Updated document or null; findOneAndUpdate middleware |
| `upsert(filter, update, options?)` | Updated or inserted document |
| `updateOne(filter, update, options?)` | MongoDB write counts; updateOne middleware |
| `updateAll(filter, update, options?)` | MongoDB updateMany write counts |
| `delete(filter, options?)` | MongoDB deleteOne result |
| `deleteAll(filter, options?)` | MongoDB deleteMany result |
| `aggregate<Result>(pipeline, options?)` | Aggregated results |
| `bulkWrite(operations, options?)` | MongoDB bulk-write result |
| `bulkSave(documents, options?)` | Bulk result for hydrated documents |

`fetch`, `fetchAll`, `update`, and `upsert` return lean objects unless options specify `lean: false`. Lean reads skip virtuals, getters, defaults on reading, and toJSON/toObject transforms. `create` and `insertMany` always return hydrated documents.

`update` returns the after document by default; use `returnDocument: "before"` when needed. It may take an aggregation update pipeline, as may updateOne and updateAll. Pipeline stages are not cast to the schema. Updates require opt-in `runValidators` where supported. `upsert` forces upsert true and returnDocument after. Literal object projections with `_id: 0` or false remove `_id` from inferred write results; inference does not precisely model every other projection.

`fetch` and `fetchAll` take the projection positionally or as `options.projection`, which is Mongoose's own query option; when both are set, `options.projection` wins. Either way the read skips the cache and the inferred type stays the full document.

For bounded query results use `fetchAll` options such as `{ sort: { _id: 1 }, skip: 20, limit: 20 }`, and call `count` separately when a total is needed. Use the raw model for cursor queries. `insertMany.limit` bounds validation concurrency, not MongoDB batch size.

## Duplicate keys

```ts
import { isDuplicateKeyError } from "@vimcord/plugin-mongoose";

try {
    await Users.create({ userId: USER_ID });
} catch (error) {
    if (!isDuplicateKeyError(error, "userId")) throw error;
    console.log("That user already exists.");
}
```

`isDuplicateKeyError(error, path?)` accepts driver errors and plain objects with code 11000 or codeName DuplicateKey. A supplied path must appear in the error's own keyPattern; compound indexes match. It does not search nested causes or bulk-write error arrays.

`createUnique` requires an installed single-field unique index. It uses create and retries only driver errors with code 11000 on exactly that index. Other duplicate indexes, validation failures, and exhausted retries propagate. Save middleware can run on every attempt. Ensure indexes exist with `await Users.model.init()` before depending on uniqueness during startup work.

## Read cache

| Cache option | Meaning | Default |
| --- | --- | --- |
| `key` | Single schema path used as the lookup key | Required |
| `ttl` | Entry lifetime in milliseconds | Required |
| `maxEntries` | Retained documents; oldest insertion evicted first | `1000` |

Set schema options to `{ cache: { key: "userId", ttl: 60_000 } }` to opt in. Only full lean `fetch({ userId })` reads without other meaningful options are cached. Projections, active sessions, populate, sort, lean option objects, and other query options bypass caching. Explicit session null can use the cache. Missing documents are not cached.

Plain objects and arrays freeze once on insertion. Date, ObjectId, Decimal128, and Buffer instances remain unfrozen. An unreferenced timer removes expired entries. Matching concurrent reads share work. Builder writes invalidate completed and pending reads, including failed or ambiguous writes; in-progress callers may receive an earlier result but cannot repopulate invalidated entries.

Updates invalidate just the pinned key when a direct value or `$eq` identifies it, no collation applies, and the update preserves the key and its parent/child paths. Extra filter predicates are allowed. Key-changing updates, unpinned filters, collations, and unsupported pipeline stages clear the whole cache. `$set`, `$addFields`, and `$unset` pipelines can preserve unrelated keys. Creates, bulk operations, and broad deletes clear affected caches conservatively.

Raw model writes and hydrated document save bypass builder invalidation. Use `transaction` (or `useTransaction`) with builder writes so caches clear again when commit or rollback finishes.

## Transactions

```ts
import { abort, transaction } from "@vimcord/plugin-mongoose";

const result = await transaction(async () => {
    const source = await Users.fetch({ userId: SOURCE_ID }, undefined, { required: true });
    if (source.points < 1) abort("Not enough points.");
    await Users.updateOne({ userId: SOURCE_ID }, { $inc: { points: -1 } });
    const destination = await Users.updateOne({ userId: DESTINATION_ID }, { $inc: { points: 1 } });
    if (!destination.matchedCount) abort("The destination no longer exists.");
    return { transferred: 1 };
});
if (result.success) console.log(result.value.transferred);
else console.log(result.error);
```

Use `transaction(callback)` by default. It returns `TransactionResult<T>`: `{ success: true, value }` on commit, or `{ success: false, error }` after `abort(message)` rolls the writes back. Unexpected errors still reject. It is exactly `tryTransaction(() => useTransaction(callback))`; reach for those two primitives when you need transaction options or a fallback message.

`useTransaction(callback, transactionOptions?)` starts a session on the plugin's isolated connection, runs the driver's transaction wrapper, clears caches written by builders on commit or rollback, and ends the session. The callback receives the session, but builder calls inherit it automatically. Explicit `{ session: null }` opts one operation out. Await all callback work and run transaction operations sequentially. The driver may retry the callback, so perform external side effects after successful completion. MongoDB transactions require a replica set or sharded deployment.

`abort(message)` throws `TransactionAbort`. Keep `tryTransaction` outside the entire useTransaction call so aborts escape and roll back. It returns `TransactionResult<T>`: `{ success: true, value }` or `{ success: false, error }`. Unexpected errors rethrow; an optional fallback string logs the original error and returns that message. Expected aborts are not logged. The helper itself starts no transaction or retries.

For a manual session use `database.mongoose.startSession()` and end it in finally; raw calls require that session explicitly. Use the top-level wrapper when builder cache invalidation is needed.

## Startup migrations

```ts
import { GatewayIntentBits } from "discord.js";
import { Vimcord } from "vimcord";
import { MongoosePlugin } from "@vimcord/plugin-mongoose";

const database = new MongoosePlugin();
database.defineMigration("2026-10-backfill-active", async ({ mongoose }) => {
    await mongoose.connection.collection("cards").updateMany(
        { active: { $exists: false } }, { $set: { active: true } }
    );
});
const client = new Vimcord({ intents: [GatewayIntentBits.Guilds], plugins: [database] });
await client.login();
```

Register migrations before login. They run in registration order after all plugins install and token validation succeeds, before modules load or the gateway connects. Callbacks receive the connected MongoosePlugin. IDs must be nonempty and unique; registration after migrations finish throws.

The `_migrations` collection uses each ID as a string `_id`. An atomic insert claims work; success sets ranAt, and completed IDs are skipped across restarts and processes. An unfinished claim owned by another runner aborts login instead of running concurrently or advancing to later migrations. Retry startup after it completes.

Callback or completion-write failure releases an unfinished claim, logs, and aborts login. Ambiguous completion does not delete a record already marked complete. Cleanup failure reports both errors. Callbacks must tolerate partial work because body and completion record are not one transaction. A killed runner leaves a claim without ranAt; after confirming the owning process stopped, remove that unfinished record to retry. Claims do not expire. Migrations do not run on reconnect.
