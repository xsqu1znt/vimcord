# Changelog

## 2026-09-03

### Added

- Added MongoDB disconnect and reconnect logging.
- Added `connectOptions` for MongoDB connect settings and a single-document `create` overload.
- Added an opt-in per-schema read cache with request coalescing.
- Added implicit session propagation inside `useSession` and `useTransaction`, and a `paginate` helper.

### Changed

- Reworked `MongoSchemaBuilder` inference to derive document types from the schema definition. The builder now includes `_id` and schema timestamps, supports `leanByDefault`, and has the new `MongoSchemaBuilder<Def, Opts>` type signature.
- Made `useSession` return its callback's value.
- Failed initial MongoDB connections now throw during install by default, controlled by `requireConnection`.

### Fixed

- Restored support for `autoIndex: false`, which a hardcoded connect option silently overrode.
- Fixed `fetchLatest` so it preserves a caller's `sort` and throws without an explicit sort when no `createdAt` path exists.

### Removed

- Removed `MongoSchemaBuilder.extend()`. Use plain functions, or `Object.assign` when you want method syntax on the schema object.
- Removed the plugin's `connectionRefresh` option and `MongooseConnectionRefreshOptions`. Mongoose and the MongoDB driver reconnect on their own.
- Removed automatic ObjectId normalization from query filters. Mongoose now casts filters directly from the schema.
