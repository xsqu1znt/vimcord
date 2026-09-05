# Changelog

## vimcord

### Breaking

- Only one Vimcord client can exist per process. A second constructor call throws, `Vimcord.getInstance()` no longer takes a client ID, and `Vimcord.$instances`, `client.id`, the `customId` option, and `clone()` are gone. The `destroy` lifecycle event now returns the client instead of its ID.
- Removed the client's `features` and `logger` options, along with `VimcordFeatures`, `maxLoginAttempts`, and `toOptions()`.
- Removed the client's `connectionRefresh` option and `VimcordConnectionRefreshOptions`. Discord.js handles reconnects.
- The CLI targets the attached client only. The `clients` and `use` commands, `CLICommandContext.clients`, `CLICommand.supportsAllClients`, `CORE_CLI_COMMAND_NAMES`, and `RegisteredCLICommand` are gone, as is the `@vimcord/plugin-multi-instance` package.
- Plugins can no longer register CLI commands. `VimcordPluginContext.cli` is gone, `health.register` no longer returns a disposer, and `uninstall` is now optional.
- Command permission options renamed: `userWhitelist` to `users`, `guildOwnerOnly` to `guildOwner`, `botOwnerOnly` to `botOwner`, `botStaffOnly` to `botStaff`. `MissingPermissionReason.UserNotWhitelisted` is now `UserNotAllowed`.
- Permission checks run in two stages. `guildOnly`, `guildWhitelist`, `guildBlacklist`, `userBlacklist`, `roleBlacklist`, `client`, and `allowBots` are hard restrictions that all must pass. `user`, `users`, `roles`, `guildOwner`, `botOwner`, and `botStaff` are additive grants where any one allows the command. A command with no grants is open to anyone who passes the restrictions.
- `globals.staff.bypassers` is now `globals.staff.bypassesStaff`, and it grants access only to commands that set `botStaff: true` instead of skipping every permission check.
- Removed the `onUsedWhenDisabled` command hook and the `categoryEmoji` command metadata field.
- Event modules no longer accept `priority`.
- Paginator rewrite:
    - Navigation layout and Jump are explicit. `dynamic`, `uxConfig.paginator.longThreshold`, and `uxConfig.paginator.jumpableThreshold` are gone; pass `jump: true` to show the Jump control.
    - `PaginationTimeout` is replaced by the shared `ResolveAction` enum.
    - `beforePageChange`, `pageChange`, and the per-direction events collapse into one `paginate` event carrying `previous`, `destination`, `action`, and `page`.
    - Custom component handlers move from `on()` to `onComponent()`, so a custom ID is never read as an event name.
    - `addChapter` takes an array of pages only. An inner array is one page with several embeds, and files move into the page payload they belong to.
    - `chapters[i].pages` and `chapters[i].files` are replaced by `chapters[i].source`.
    - `beforeChapterChange` and `hydrateChapter` are replaced by `addLazyChapter`, `addPageLoader`, and `reloadChapter`.
    - A paginator cannot mix ordinary pages and Components V2 containers. Static mixtures fail before send, invalid lazy results fail before edit.
- Prompt results report `status` (`"confirmed"`, `"rejected"`, `"timeout"`, plus `"invalid"` for modals) instead of the `confirmed`, `rejected`, `answered`, and `submitted` booleans.
- Modal submit results take a component type: `getField("subject", ComponentType.TextInput, true)` instead of a type argument and getter name. Deferral methods moved to `result.interaction`.
- Collector listeners always run in order. `CollectorMode`, parallel execution, `uxConfig.collector.mode`, and the per-listener `finally` option are gone.

### Added

- Slash command autocomplete, per command and per route, with `SlashCommandAutocompleteHandler` and `SlashCommandAutocompleteContext`. Handlers run outside the module pipeline, so no permissions or hooks apply.
- Route-level `conditions`, `permissions`, and `deferReply` on slash routes. They run after the command's own checks pass, and a route's `deferReply` overrides the command setting.
- `singleInvocation` on modules, which skips a new invocation while a matching one is still running, plus the `onAlreadyRunning` hook. Commands accept `true` to key on module and user. The guard is in-memory and covers one process.
- Prefix dispatch through a bot mention with `DispatchMessageOptions.allowMention`.
- `metadata.logUsage` to turn off usage logging for a command.
- Paginator lazy loading: `addLazyChapter` caches a chapter once, `addPageLoader` fetches one page per navigation, and `onLoading` supplies a placeholder. A failed reload keeps the previous chapter.
- `uxConfig.paginator.messages` for the `loadFailed`, `expired`, and `chapterChanged` responses. All default to `null`, which acknowledges silently.

### Changed

- Permission checks use the member's permissions in the invoking channel rather than guild-wide permissions.
- Concurrent staff role lookups for the same user share one in-flight request.
- Guild command sync runs under a concurrency limit, and per-guild payloads only include commands that target that guild.
- Application command diffing moved to `applicationCommandData.ts` and normalizes payloads per scope, so global and guild commands compare against Discord's own defaults.
- Embeds resolve a random color pool and `timestamp: true` once at serialization instead of once per setter call.
- `BetterContainer.clone()` deep copies components, so mutating the clone no longer touches the original.

### Fixed

- `awaitReady` gives each caller its own timeout and removes its listener after settling.
- `destroy()` runs every cleanup step, collects failures, and throws an `AggregateError` instead of stopping at the first one.
- Status updates apply in order. A stale in-flight profile or activity update can no longer overwrite a newer `set()` or `clear()`.
- `once` event handlers unregister before running, so a reentrant emit can't fire them twice. Registering or unregistering a handler no longer remounts the underlying listener.
- Command dispatch no longer swallows thrown errors, and failed executions are logged on `ModuleRunResult`.
- `ModuleManager.load`/`unload` mount and clear events instead of re-registering everything.
- Plugins are unloaded when login fails after they installed.

## @vimcord/plugin-mongoose

### Breaking

- `MongoSchemaBuilder` inference now derives document types from the schema definition. The builder includes `_id` and schema timestamps, supports `leanByDefault`, and has the new `MongoSchemaBuilder<Def, Opts>` type signature.
- A failed initial MongoDB connection throws during install by default. Set `requireConnection` to `false` to keep the old behavior.
- Removed `MongoSchemaBuilder.extend()`. Use plain functions, or `Object.assign` when you want method syntax on the schema object.
- Removed the plugin's `connectionRefresh` option and `MongooseConnectionRefreshOptions`. Mongoose and the MongoDB driver reconnect on their own.
- Removed automatic ObjectId normalization from query filters. Mongoose now casts filters directly from the schema.

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

## @vimcord/plugin-dotenv

### Fixed

- The plugin reports its real package version instead of a hardcoded `0.1.0`.
