<div align="center">

```
██╗   ██╗██╗███╗   ███╗ ██████╗ ██████╗ ██████╗ ██████╗
██║   ██║██║████╗ ████║██╔════╝██╔═══██╗██╔══██╗██╔══██╗
██║   ██║██║██╔████╔██║██║     ██║   ██║██████╔╝██║  ██║
╚██╗ ██╔╝██║██║╚██╔╝██║██║     ██║   ██║██╔══██╗██║  ██║
 ╚████╔╝ ██║██║ ╚═╝ ██║╚██████╗╚██████╔╝██║  ██║██████╔╝
  ╚═══╝  ╚═╝╚═╝     ╚═╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
```

**vhem-cord** — the Discord.js framework that actually respects your time

[![npm version](https://img.shields.io/npm/v/vimcord?color=%235865F2&label=vimcord&logo=npm&style=flat-square)](https://www.npmjs.com/package/vimcord)
[![npm downloads](https://img.shields.io/npm/dm/vimcord?color=%2357F287&label=downloads&style=flat-square)](https://www.npmjs.com/package/vimcord)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/npm/l/vimcord?color=%23FEE75C&label=license&style=flat-square)](LICENSE)
[![Discord.js](https://img.shields.io/badge/discord.js-14.x-%235865F2?style=flat-square&logo=discord)](https://discord.js.org/)

[Installation](#installation) · [Quick Start](#quick-start) · [Features](#features) · [API](#api-reference) · [Examples](#examples)

</div>

## Read cache

`cache: { key: "key", ttl: 60_000, maxEntries: 1000 }` opts into a bounded cache for full lean `fetch({ key })` reads. `maxEntries` defaults to 1000; the oldest insertion is evicted first. Expired entries are removed by an unreferenced timer. Cached plain objects and arrays freeze once on insertion. Class instances such as Date and ObjectId remain unfrozen.

Projections, sessions, populate, sorting, lean options objects, and other query options bypass the cache. Builder writes invalidate completed and pending reads; updates clear the cache because they can move a document to another key. Raw `model` writes and hydrated document `save()` calls bypass builder invalidation. Transactions should use the builder's `useTransaction()` wrapper when caching is enabled, so it clears the cache after commit or rollback. A read already in progress may return its earlier result to its caller, but cannot insert that result after invalidation.

## Cursor pagination

`paginate()` retains numbered pages and exact totals. `paginateCursor()` skips the count and offset scan, fetching `limit + 1` documents to report `hasNext`:

```ts
const first = await Records.paginateCursor({ active: true }, { path: "createdAt", direction: -1, limit: 20 });
const next = first.hasNext
    ? await Records.paginateCursor({ active: true }, {
          path: "createdAt",
          direction: -1,
          limit: 20,
          after: first.nextCursor!
      })
    : null;
```

Ordering defaults to `_id` ascending. For another scalar, non-null ordering path, create an index `{ [path]: direction, _id: direction }`. The `_id` tie-breaker keeps equal values stable. Cursors use the normal ObjectId `_id`; keep the filter, ordering and direction unchanged between pages. This is forward pagination without totals or a snapshot across concurrent writes. Lean and session options are supported; projections are intentionally omitted so the cursor fields remain available.

## Explicit write APIs

- `insertMany(docs, { ordered, session, limit })` batches inserts and retains Mongoose validation and `insertMany` middleware. It does **not** run `save` middleware. `create()` retains its existing individual save behavior. `limit` bounds Mongoose's concurrent validation work; it is not the MongoDB batch size.
- `updateOne(filter, update, options)` returns MongoDB write counts instead of a document. It uses `updateOne` query middleware; pass `runValidators: true` when needed. `update()` retains returned-document behavior and `findOneAndUpdate` middleware.
- `createUnique(path, doc, generate, maxRetries = 10)` generates and creates in one retry loop. It requires an installed single-field unique index at `path`, uses `create()` validation/save middleware, and retries only duplicate-key errors for that index. Other duplicate indexes, validation errors and exhausted retries propagate. Save middleware may run on every attempt, so account for repeated side effects. Standalone `unique()` retains its preflight contract and cannot reserve a value against concurrent callers.

## Duplicate-key errors

`isDuplicateKeyError(error: unknown, path?: string): boolean` recognizes MongoDB errors and plain objects with
`code: 11000` or `codeName: "DuplicateKey"`. It checks those properties on the supplied error, without traversing
nested causes or individual bulk-write failures.

```ts
import { isDuplicateKeyError } from "@vimcord/plugin-mongoose";

try {
    await Invites.create({ code });
} catch (error) {
    if (!isDuplicateKeyError(error, "code")) throw error;
    // A unique index containing "code" rejected this write.
}
```

Without a path, any duplicate-key error matches. With a path, `keyPattern` must contain that field as an own
property; compound indexes match too. An error without `keyPattern` cannot establish which field collided.
`createUnique()` still retries only driver errors with code 11000 for an exact single-field index at the chosen
path, preserving its existing retry behavior.

## Run-once migrations

Register migrations on the `MongoosePlugin` instance with
`defineMigration(id: string, run: (ctx: MongoosePlugin) => Promise<void>): void`. Then explicitly call
`runMigrations(): Promise<void>` after plugins load, before accepting bot commands. Callbacks receive the connected
plugin, including `mongoose` and its session/transaction helpers. Schema builders can be used once plugin loading
has completed.

```ts
import { MongoosePlugin } from "@vimcord/plugin-mongoose";

const database = new MongoosePlugin();
database.defineMigration("2026-10-backfill-active", async ({ mongoose }) => {
    await mongoose.connection.collection("cards").updateMany(
        { active: { $exists: false } },
        { $set: { active: true } }
    );
});
client.plugins.use(database);
await client.plugins.load();
await database.runMigrations();
await client.login();
```

Migrations run sequentially in registration order. Keep ids stable and unique: duplicate registrations throw.
The `_migrations` collection stores string `_id` values; an atomic insert claims the id before the callback runs.
Success sets `ranAt`, and completed ids never run again, including on another process or plugin instance.

If another runner owns an unfinished claim, `runMigrations()` logs and throws instead of running the same migration
or advancing to a later one. Retry startup after that runner completes. Callback or completion-write failures
release the unfinished claim, log, and reject; later migrations do not run. Completed records are not deleted on
an ambiguous write failure. A failed cleanup reports both errors and leaves the claim for manual recovery.

Callbacks should tolerate retry after partial writes: the migration body and completion record are not one
transaction. A killed process leaves an unfinished record (no `ranAt`); after confirming the owning process is
stopped, remove that record to allow a retry. Claims have no automatic expiry, which prevents a slow migration
from being run concurrently by another process. There is no automatic migration execution during install or
reconnect; import/register all migrations before calling `runMigrations()`.
