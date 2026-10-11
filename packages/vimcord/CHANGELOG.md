# vimcord

## 4.5.0

### Minor Changes

- 91c6ef4: Page loaders receive a `setPageCount(count)` context so a paginator can follow data that changes while it's open. When the requested page no longer exists, the new last page loads instead of an empty one.

### Patch Changes

- 91c6ef4: `BetterModal` now enforces Discord's limit of 5 top-level components instead of 25.

## 4.4.0

### Minor Changes

- e3bf173: Add `BetterCollector.resetTimer()` to renew its configured idle or timeout window after modal submissions and result updates.

## 4.3.0

### Minor Changes

- ea84877: Add prefix subcommands with aliases, descriptions, remaining-argument contexts and parent command hooks.

    Add isDuplicateKeyError for driver and plain duplicate-key errors, plus instance-scoped run-once migrations with atomic claims, ordered execution and failure retries.

## 4.2.0

### Minor Changes

- 762ef4c: Add `Paginator`'s `chapterSelectPosition` option. Set it to `"beforeComponents"` to place the chapter select above caller-supplied action rows while preserving their grouping and leaving built-in navigation below them. The default `"afterComponents"` preserves existing ordering. Navigation, refresh, chapter replacement, and timeout cleanup retain the selected layout.

## 4.1.0

### Minor Changes

- a5852f3: Accept any MessageComponentInteraction in send helpers. Resolve prompts, collectors and paginators through the sending interaction webhook so ephemeral messages can be edited and deleted. BetterCollector accepts an interaction option for cleanup. Add Paginator.replaceChapters to re-render rebuilt chapters while preserving the selected chapter and page.

## 4.0.0

### Major Changes

- f836146: Unify prompt, collector, and paginator resolution under `onResolve`, using the existing `ResolveAction` enum or an awaited callback returning `{ action, ...messageEditOptions }`. Apply final content and component cleanup in one message edit, preserve selected prompt button highlighting, and return the updated prompt message after the edit completes. Resolution callbacks run once; failed edits never rerun application side effects.

    Breaking: replace prompt `onConfirm`, `onReject`, `onCustom`, and `onTimeout` with `onResolve` and branch on its `status` (`confirmed`, `rejected`, `custom`, or `timeout`). Rename paginator `onTimeout`, including its global default, to `onResolve`. Collector callbacks receive `message`, `reason`, and `collected`; paginator callbacks receive `message` and `reason` after pending navigation finishes. Fixed actions and existing defaults remain available. Prompt resolution errors now propagate; collector and paginator resolution errors are logged.

## 3.2.0

### Minor Changes

- 1aa7b90: Add `globals.app.commandLogging` to select delivery, pre-execute, execute, and total command timings in display order. Usage logs now default to execute-only timing and omit guild IDs. Execute timing excludes automatic deferral and includes awaited prompts. `false` or an empty array disables logging by default; explicit per-command `metadata.logUsage: true` opts back in with execute timing, while `false` always suppresses that command.

### Patch Changes

- b8142cb: Reduce component and modal listener fan-out with shared indexed routing, preserve collector lifecycle behavior, and avoid retaining paginator interaction history. Reduce prepared-page navigation calls, registration work, empty module pipeline work, timestamp formatting costs, and embed substitution work.

    Improve Mongoose cache eviction, expiry, query eligibility, and invalidation of pending reads. Add cursor pagination, bulk insertion, update-only writes, and index-backed unique creation while preserving existing APIs.

## 3.1.2

### Patch Changes

- a0e5ffa: Preserve allowed mentions when paginator timeout cleanup edits message components.

## 3.1.1

### Patch Changes

- 41b7428: Selected additional prompt buttons now use Primary when highlighting is enabled. Each additional button can override its selected style.

## 3.1.0

### Minor Changes

- 753c288: Add `resolveOnAdditionalButton` to `promptMessage`, letting an extra button end the prompt like confirm and reject do.

    Turn it on and a press of any button in `additionalButtons` resolves the prompt with `status: "custom"` and `customId` set to the button that was pressed. `onCustom` picks the resolve action, defaulting to `ResolveAction.DeleteMessage` like the other three. With `highlightSelectedButton` on, the pressed button keeps its style and both confirm and reject grey out.

    The flag is off by default, so callers driving extra buttons through `onCollector` keep their current behavior. An additional button using the reserved `prompt:confirm` or `prompt:reject` custom ID now throws at build time.

## 3.0.0

### Major Changes

- c4f56fc: ### Breaking

    - `@vimcord/core` is merged into `vimcord`. There is no separate core package anymore; `vimcord` holds the full implementation.
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
