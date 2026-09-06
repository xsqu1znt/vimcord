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

## Hit every surface

The recurring defect here is a change landing in one place while its siblings keep the old shape.

`modules/commands` has four command module classes that all build a `HookContext` in `createHookCTX`. Three of them (`SlashCommandModule`, `MessageContextCommandModule`, `UserContextCommandModule`) cast the module reference with `this as unknown as ModuleHookContext<...>["module"]`. `PrefixCommandModule` had drifted to a bare `this as any`, quietly breaking the "`any` is the enemy" rule while its siblings stayed disciplined. That's the shape to watch for: a fix or a pattern applied to three of four command modules (or three of four UX helpers, or three of four CLI command groups) and never checked against the fourth.

When you change how something is worded, how data is extracted, or how a function is shaped, find the other paths doing the same thing and bring them along. If one of them should stay different, say that it is deliberate and why.

Half-applied changes are what send the next agent down the wrong road, so treat the sweep as part of the task rather than a follow-up.

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

Write plainly. No jargon in replies, and none in user-facing strings either. A user reading "size is a width x height grid" learns nothing about what `3x2` means, so write the sentence that tells them.

Leave out what was not asked for: extra abstractions, options, compatibility shims, defensive checks, adjacent fixes. Mention what you left out only when its absence leaves a real limit. If a bold idea would make the work better, say it loudly, then wait.

If a rule here fights the task, say so and ask before breaking it. If you find a rule already broken, name it, say what you would do, and wait for the go-ahead. Cleaning up as we go is how this stays maintainable.

If finishing the task needs a pile of workarounds nobody asked for, stop and say what you hit.

## Planning a large change

For a feature that spans modules, work in three phases and stop at the end of each.

1. **Alignment.** Read-only, no code. How it should behave, what it touches, the edge cases worth handling, sane defaults, open questions, and anything inconsistent you noticed. No technical detail. If it has a user-facing side, draft the actual messages, embeds, and formatting so we can iterate on the copy first.
2. **Technical.** Still read-only. Persistence, schemas, blockers, commands, services. Short.
3. **Implementation.** Write the code once both are agreed and the plan is approved.

## Hard rules

- Read `.env.example` to learn the environment shape. Never read `.env` files.
- Never read or touch a live production database.
- Secrets, tokens, and IDs live in config or environment variables, never in source.
