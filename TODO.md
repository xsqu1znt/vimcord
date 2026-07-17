Rules:
1. Ensure comments for readability and scanability are added, don't be scared to add relevant comments to the code you write
2. The code you write must be clean and performant, no slop, no files full of utility function slop (inline code where possible, but remember D.R.Y)
3. All public facing interface props and types and functions and class functions should have proper jsdoc that reads naturally and concise
4. Update this TODO list with what was completed and any notes of important choices made

- [x] BetterEmbed: the description field should allow and filter out all falsey values except for intentional falsey values that are strings
  - Added a description-line type for conditional falsey values. Empty strings remain intentional blank lines.

- [x] BetterModal: expand the dynamic `getField` helper util to be similar in params it accepts like the original `interaction.fields.getField` while keeping the objective simplification of how it's currently implemented to be used. currently in another project submit parsing had to be changed to use the original getField to read from modalResult.interaction.fields, because that's where discord.js exposes typed getters like getSelectedUsers, getRadioGroup, getStringSelectValues, and getCheckbox for modal components
  - `getField` now supports component-type validation and every Discord.js typed modal getter while retaining simplified automatic values.

- [x] Paginator: fix global config from defaulting to both emoji and label, basically just remove the emojis from the default config
  - Default controls are label-only; labels and emojis remain independently configurable.
- [x] Paginator: the current jump button implementation assumes you want to move back/ahead in a certain amount of pages, but instead it's supposed to open a BetterModal and ask the user what page they want to jump to (the modal title/description should be configurable in the current global config setup), the current jump implementation should be renamed to something more relevant and allow in the options setting how far forward/back these special buttons (they are like skip forward/back buttons that can be enabled along with the other back/next buttons) jump pages
  - `ShortJump`/`LongJump` became `ShortSkip`/`LongSkip`, `jumpSize` became `skipSize`, and separate skip-back/skip-forward controls were added.
  - Jump opens a configurable BetterModal and uses one-based page numbers within the current chapter.

- [x] messagePrompt: separate resolve actions into onConfirm, onReject, and onTimeout instead of having a single onResolve array
  - Each outcome accepts one resolve action or an ordered action array. Existing delete-on-completion behavior remains the default for all three outcomes.

- [x] MongoSchemaBuilder: jsdoc for relevant functions that include the use of `returnDocument` should show it defaults to "after" and not "before" by making a custom interface or type to override the default jsdoc, instead of explaining it in the function's own jsdoc
  - Added `AfterQueryOptions`, used by `upsert` and `update`, with `returnDocument` documented and restricted to `"after"`.

- [x] Vimcord: when the preExecute hook's `next()` isn't used, it shouldn't still send a command log that the command was used
  - Module runs now report whether the main execute function was reached, so halted and failed prechecks are not logged as usage.
- [x] Vimcord: the command log should include how long it took the command to finish its execution, this is already shown in the verbose logs within the command modules them self, but for non-verbose it should show the total execution at the end of the line in a dim color
  - Command logs now include total test, hook, and execution time with dim formatting.

- [x] Vimcord: allow `client.status.set()` without requiring both production and development profiles
  - A shared profile can be passed directly. Environment profiles are exact, and an omitted current mode remains blank.
- [x] UX: rename `defineGlobalToolConfig` and related tool branding to `defineGlobalUxConfig`
  - The config file, exported types, state, getter, and color resolver now consistently use UX branding.
- [x] Packages: merge `@vimcord/internal` into `@vimcord/core`
  - Internal types and utilities are exported by core, with the required `human-id` runtime dependency moved to core.
- [x] Logger: remove `unicode-animations`
  - The only used 17-frame spinner sequence and its 100ms interval are now defined locally.
- [x] Logger: simplify the public API and remove logging severity thresholds
  - `debug()` is verbose-only, obsolete verbose variants and deprecated structured output were removed, and errors preserve stacks.
  - Loaders now return lifecycle controls instead of an ambiguous callback with a boolean argument.
  - Command usage uses structured named data instead of positional parameters.
- [x] VimcordLogger: prevent clients from sharing mutable logger state
  - Every client owns a configurable logger instance, and runtime verbose changes stay synchronized.
- [x] VimcordLogger: honor CLI and banner settings
  - CLI guidance only renders for clients attached to an initialized CLI, `enableCLI` defaults on as a per-client participation switch, and failed startup clears without a success footer.
- [x] CLI: add a process-wide, promptless stdin command interface
  - `setupCLI()` owns the single runtime while each client can opt out through `enableCLI`.
  - Added target-aware output, configurable loaders, help and target management, ping/stats/guild/user information, and guarded global/guild command registration.
  - Plugins can contribute client-scoped CLI commands and health probes; Mongoose contributes measured MongoDB latency.

- [x] Publishing: add an interactive root workspace release script
  - Publishable packages are discovered from PNPM and can be selected by number, range, or `all`.
  - Stable patch versions are resolved against both the local manifests and npm, with workspace dependencies published first.
  - Selected packages are checked and built before version manifests are committed and pushed to the tracked GitHub branch.
  - PNPM's clean, current-branch checks remain enabled during publishing; `--dry-run` only resolves and displays the plan.
  - A pushed release commit remains authoritative after a registry failure so published and repository versions cannot diverge through rollback.
  - Root scripts belong to the root `tsconfig.json`, keeping Node types available in VS Code and command-line checks.
