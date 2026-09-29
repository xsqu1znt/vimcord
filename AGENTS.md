# Vimcord

An opinionated Discord.js framework. It adds a module layer, typed command contexts, hooks, and UX helpers for embeds, prompts, modals, components, and pagination.

It does not hide Discord.js. Builders, intents, events, permissions, and interactions stay the Discord.js ones, used directly wherever that is the right tool.

Vimcord runs large, high-traffic bots, so every API it exposes should read clean, stay cheap at scale, and carry only the cases users actually hit. Less code wins. A guard for an edge case nobody reaches is code we maintain forever for nothing.

## Repo map

A PNPM workspace. `packages/*`, `packages/plugins/*`, and `templates/*`.

- `vimcord` in `packages/vimcord` holds everything and is the public name users install.
- `@vimcord/plugin-dotenv` in `packages/plugins/dotenv` loads env files through the plugin lifecycle.
- `@vimcord/plugin-mongoose` in `packages/plugins/mongoose` holds the Mongoose connection and `MongoSchemaBuilder`.
- `templates/*` is a placeholder for starter bot templates. Today it's a single README that says templates are coming; there's no template code to update yet.

Inside `packages/vimcord/src`:

- `client/`: the `Vimcord` client, its logger, status manager, and the managers under `client/managers` that own commands, events, and module loading.
- `abstracts/`: `AbstractModule`, `AbstractModuleImporter`, and the command module base classes plus their type kit.
- `modules/`: the concrete module types users extend: `EventModule`, and the four command modules under `modules/commands`.
- `commands/`: command hooks and the permission system.
- `cli/`: the `VimcordCLI`, its parser, logger, and the built-in command groups under `cli/commands`.
- `ux/`: the user-facing helpers: `betterEmbed`, `BetterContainer`, `betterModal`, `betterCollector`, `paginator`, `prompt`, `dynaSend`, and the shared `uxConfig`.
- `plugins/`, `errors/`, `types/`, `utils/`: the plugin manager, error classes, type helpers, and internal utilities.

## Commands

Run from the repo root. PNPM, not NPM, unless PNPM cannot do the job.

- `pnpm format` after any change, including a one-line mechanical edit. Keep whatever it rewrites, even in files outside the task, and say which unrelated files it touched.
- `pnpm format && pnpm check` to verify real work. Fix what `check` flags inside the task. For anything it flags outside the task, say what it is in a sentence and ask before touching it.
- A mechanical edit needs `pnpm format` alone. No type check, no build.

Type checks and a focused smoke test cover this repo. Write a test when the changed logic has a realistic way to break, and say why the file needs to exist before adding it. If a test would only confirm the implementation ran as written, verify it with a throwaway script instead of a committed test file.

## Conventions

- File names are `PascalCase` when the file's main export is a class, `camelCase` otherwise.
- `PascalCase` for classes and types, `camelCase` for variables and functions, `SCREAMING_SNAKE_CASE` for top-level constants.
- Add a file to its nearest `index.ts` barrel when the files around it are already re-exported there.
- Order inside a file: imports, types and interfaces, constants, helpers, main export. A helper sits above what uses it.
- `type` for unions, `interface` for object shapes. Annotate return types on exports; let internal helpers infer. `unknown` for input you have not checked yet, then narrow it.
- Return early. Past three levels of nesting, rewrite with guard clauses.
- Comment the function, not the line: what it is for and how it is used. Break a long function into stages with a `// --- Name the stage ---` header, and move a comment in the same edit that changes the code under it.
- Only `packages/vimcord/src` resolves the `@/` alias (`@/*` maps to that package's own `src`). Nothing else in the workspace gets it: plugin packages import `vimcord` the same way an app would.
- A test file sits next to what it tests, named `Foo.test.ts` for `Foo.ts`, and runs on Vitest. `Vimcord` is a one-per-process singleton (a second `new Vimcord()` throws), so any test that constructs one must `destroy()` it in `afterEach` before the next test can construct another; see `Vimcord.test.ts`.

## Module registration

`ModuleManager.load()` imports each module directory through `AbstractModuleImporter.importFrom(dir, suffix)`. The `suffix` option is a filename filter, not a required tag:

- No `suffix` configured: every `.ts`/`.js` file in `dir` is imported as that import's module type. Dropping an `.event.ts` file into a `slashCommands.dir` folder with no suffix set will try to import it as a slash command.
- A `suffix` (or list) configured: only filenames ending in one of those suffixes before `.ts`/`.js` are imported; everything else in the directory is silently skipped, no warning.

Suffixes are conventional, not enforced by the framework: `.slash.ts`, `.prefix.ts`, `.mctx.ts`, `.uctx.ts`, `.event.ts`. Pick whichever a project's `imports` config actually sets.

## Working with us

Complexity belongs in the internal layers. Orchestration stays flat and readable.

If finishing the task needs a pile of workarounds nobody asked for, stop and say what you hit.

## Publishing

When told to publish the packages that were updated to NPM, open a PR with the correct changesets changelog and merge it, then wait for the changesets action to open a new PR, merging that one too if there's no issues, wait until the updated packages are verified to be live on NPM before calling the task complete. Delete the unused branches when done.

## Hard rules

- Read `.env.example` to learn the environment shape. Never read `.env` files.
- Secrets, tokens, and IDs live in config or environment variables, never in source.
- Never read or touch a live production database.
