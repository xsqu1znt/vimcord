# Changelog

## 2026-07-16

### Fixed

- Prevented `BetterCollector` user locks from becoming permanent when an interaction has no matching listener or the user is not an allowed participant.
- Prevented user-lock-rejected interactions from affecting collector limits, collected results, or idle timing.
- Added a `deferUpdate()` fallback when the ephemeral user-lock response cannot be sent.
- Merged command access grants so user permissions, user whitelists, allowed roles, guild owners, bot owners, bot staff, and per-command bypassers extend access instead of restricting each other.
- Kept user and role blacklists authoritative over all command access grants, including per-command bypassers.
- Wired staff `bypassers` and `bypassesGuildAdmin` into command permission evaluation.
- Resolved role-based bot staff through the configured staff guild instead of the guild where a command was invoked.
- Correctly resolved Discord.js user, role, and guild objects to IDs in permission lists.
- Made guild-dependent permission rules fail closed in DMs and supported uncached application-command members.
- Made client permission checks fail closed when the bot's guild member is unavailable.
- Added distinct failure reasons for user and guild whitelist misses.
- Preserved intentional blank lines in `BetterEmbed` description arrays while filtering conditional falsey values.
- Expanded `BetterModal` field parsing to support component validation and Discord.js typed modal getters.
- Removed default paginator button emojis and separated modal page jumps from configurable skip navigation.
- Split prompt resolution into confirm, reject, and timeout actions.
- Prevented halted command hooks and failed command prechecks from producing command usage logs.
- Allowed `client.status.set()` to accept a shared profile or optional environment profiles without requiring both; an omitted current environment remains blank.
- Isolated logger configuration and loader state per Vimcord client instead of sharing one mutable singleton.
- Prevented failed logins from rendering the successful startup footer.
- Preserved plugin error stacks and routed specialized errors through stderr.
- Made the existing `enableCLI` and `disableBanner` client globals control startup output as documented.
- Prevented CLI guidance from appearing when `enableCLI` is true but the process CLI was never initialized.
- Coordinated loaders across separate client and CLI logger instances so normal logs preserve active animations.
- Prevented CLI command registration from reporting success when the selected Discord client is not ready.
- Locked destructive CLI confirmation instructions to the displayed client id.
- Handled PNPM's zero-exit registry 404 response when resolving a version for a package that has never been published.
- Added a root TypeScript project so editor tooling resolves Node types for release scripts instead of treating them as inferred files.

### Changed

- Moved `BetterCollector` user-lock admission into the underlying Discord.js collector filter while preserving per-collector lock scope.
- Made `testCommandPermissions` asynchronous so staff-role membership can be resolved from the configured staff guild.
- Evaluated command context restrictions, bot restrictions, blacklists, and client permissions as hard requirements before additive access grants.
- Renamed paginator jump navigation to skip navigation: `ShortSkip`, `LongSkip`, and `skipSize` replace the previous jump names.
- Made paginator page jumps open a configurable `BetterModal` using one-based page numbers.
- Added total command duration to non-verbose usage logs.
- Added `AfterQueryOptions` so Mongoose update helpers document `returnDocument` as defaulting to `"after"`.
- Renamed the global UX configuration API and related types from tool branding to `defineGlobalUxConfig` and `UxConfig`.
- Merged `@vimcord/internal` utilities and types into `@vimcord/core` and removed the extra workspace package.
- Inlined the logger's single spinner sequence and removed the `unicode-animations` dependency.
- Removed logging severity thresholds; `debug()` is now the single verbose-only diagnostic channel.
- Replaced callback-based loaders with explicit `update`, `stop`, `succeed`, and `fail` lifecycle methods.
- Simplified module and plugin logging so structured values are no longer flattened with `join()`.
- Changed completed-command logging to accept a named data object instead of five positional arguments.
- Removed unused deprecated logger table/section output and combined prefix text into one option.
- Changed `enableCLI` to default to `true` as a per-client participation switch; it has no effect until `setupCLI()` initializes the process runtime.
- Changed plugin installation hooks to receive a typed contribution context with the client, CLI command registry, and health registry.
- Made application-command push and pull methods return whether remote synchronization completed.
- Added root script type-checking and test discovery so release tooling is covered by the normal repository checks.

### Added

- Added regression tests for additive command access, authoritative blacklists, bypassers, staff-guild resolution, Administrator bypasses, DM behavior, resolvable IDs, and uncached interaction members.
- Added regression tests for conditional embed descriptions, typed modal field access, label-only paginator defaults, and halted module execution.
- Added status profile regression tests for shared profiles and blank omitted environments.
- Added logger regression tests for verbose diagnostics, loader completion, error stacks, per-client isolation, and CLI guidance.
- Added a process-wide, promptless CLI initialized through `setupCLI()` with automatic client discovery and selection.
- Added a dedicated `CLILogger` with target headers, groups, fields, aligned tables, shared styles, JSON output, and configurable loaders.
- Added `/help`, `/clients`, `/use`, `/version`, `/plugins`, `/modules`, `/clear`, `/exit`, `/ping`, `/stats`, `/guildinfo`, and `/userinfo` CLI commands.
- Added guarded `/register` and `/unregister` CLI commands for global and explicit guild application-command scopes.
- Added client-scoped plugin CLI command and health-probe contributions with automatic unload cleanup, timeout handling, and failure isolation.
- Added a Mongoose health probe that reports measured MongoDB ping latency when the plugin is installed.
- Added CLI parser, lifecycle, targeting, deployment, plugin contribution, and health-probe regression tests.
- Added an interactive `pnpm publish:workspace` release script with dynamic workspace package selection, registry-aware patch versions, dependency-ordered checks and builds, and a read-only dry run.
- Added clean-workspace enforcement and automatic release commits pushed to the tracked GitHub branch before PNPM publishes the selected packages.
