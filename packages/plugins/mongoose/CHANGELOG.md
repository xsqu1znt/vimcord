# @vimcord/plugin-mongoose

## 1.4.0

### Minor Changes

- 79df347: Add typed dotted schema paths to `MongoSchemaBuilder.distinct()`. Nested object and array paths now infer their distinct value types, so `distinct("asset.imageUrl")` returns `string[]` for a string field while invalid paths remain type errors.

## 1.3.0

### Minor Changes

- ea84877: Add prefix subcommands with aliases, descriptions, remaining-argument contexts and parent command hooks.

    Add isDuplicateKeyError for driver and plain duplicate-key errors, plus instance-scoped run-once migrations with atomic claims, ordered execution and failure retries.

## 1.2.1

### Patch Changes

- f836146: Allow vimcord v4 as a peer dependency while preserving v3 compatibility.

## 1.2.0

### Minor Changes

- b8142cb: Reduce component and modal listener fan-out with shared indexed routing, preserve collector lifecycle behavior, and avoid retaining paginator interaction history. Reduce prepared-page navigation calls, registration work, empty module pipeline work, timestamp formatting costs, and embed substitution work.

    Improve Mongoose cache eviction, expiry, query eligibility, and invalidation of pending reads. Add cursor pagination, bulk insertion, update-only writes, and index-backed unique creation while preserving existing APIs.

## 1.1.0

### Minor Changes

- e96cdfe: `MongoSchemaBuilder.update()` now accepts aggregation update pipelines and a `returnDocument` option (`"before"` or `"after"`, default `"after"`). Pipelines enable Mongoose's `updatePipeline` option automatically. The result type is nullable unless the call is an upsert that returns `"after"`, so `{ upsert: true, returnDocument: "before" }` returns `null` when it inserted.

## 1.0.3

### Patch Changes

- 11426a7: Publish the plugins with vimcord as a peer dependency so consumers use one vimcord version.

## 1.0.2

### Patch Changes

- Updated dependencies [753c288]
    - vimcord@3.1.0

## 1.0.1

### Patch Changes

- 25cdf2a: Fix `InferDoc`, `InferHydratedDoc`, and `CreateDocument` failing to compile: a type name collision with the internal document type used by `create()`, and a missing `CreateDocInput` reference.

## 1.0.0

### Major Changes

- c4f56fc: ### Breaking

    - `MongoSchemaBuilder` inference now derives document types from the schema definition. The builder includes `_id` and schema timestamps, supports `leanByDefault`, and has the new `MongoSchemaBuilder<Def, Opts>` type signature.
    - A failed initial MongoDB connection throws during install by default. Set `requireConnection` to `false` to keep the old behavior.
    - Removed `MongoSchemaBuilder.extend()`. Use plain functions, or `Object.assign` when you want method syntax on the schema object.
    - Removed the plugin's `connectionRefresh` option and `MongooseConnectionRefreshOptions`. Mongoose and the MongoDB driver reconnect on their own.
    - Removed automatic ObjectId normalization from query filters. Mongoose now casts filters directly from the schema.
    - Now depends on `vimcord` instead of `@vimcord/core`, which is merged into it.

    ### Added
    - MongoDB disconnect and reconnect logging.
    - `connectOptions` for MongoDB connect settings, and a single-document `create` overload.
    - An opt-in per-schema read cache with request coalescing.
    - Implicit session propagation inside `useSession` and `useTransaction`, plus a `paginate` helper.

    ### Changed
    - `useSession` returns its callback's value.

    ### Fixed
    - Restored support for `autoIndex: false`, which a hardcoded connect option silently overrode.
    - `fetchLatest` preserves a caller's `sort`, and throws without an explicit sort when no `createdAt` path exists.

### Patch Changes

- Updated dependencies [c4f56fc]
    - vimcord@3.0.0
