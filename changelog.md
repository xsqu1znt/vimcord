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

## 2026-07-22

### Added

- Added named role IDs to `globals.staff.guild.roles`, alongside the existing named channel IDs.
- Added public cache-first `fetchRole` and `fetchMember` UX helpers with nullable failure results.

## 2026-07-17

### Fixed

- Standardized plugin-scoped logger labels as uppercase `PLUGIN` across normal, debug, success, error, and startup summary output.
- Made CLI tables wrap within the detected terminal width with a compact maximum instead of expanding to their longest values.
- Removed blank-line padding before and after CLI command results.
- Restored the full startup banner on hosts that report a narrow terminal width despite supporting the complete layout.

### Changed

- Changed CLI target labels to show the application name and Discord bot tag without the internal Vimcord client ID.
- Moved Vimcord package-version resolution into a shared internal utility used by startup and CLI output.

### Added

- Added bot-staff status to `/userinfo` text and JSON output.
- Added the installed Vimcord package version to `/version` text and JSON output.
