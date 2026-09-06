# @vimcord/plugin-mongoose

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
