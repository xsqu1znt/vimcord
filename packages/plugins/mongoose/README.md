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
