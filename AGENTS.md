# AGENTS.md

> This is a living document for agentic coding within the Vimcord repository. Keep it current.

---

## Project Overview

**Vimcord** (pronounced _vhem-cord_) is a lightweight, opinionated framework for **Discord.js**, designed to minimize the distance between an idea and a working command. It abstracts the library's complexity without sacrificing control.

### Core Modules

| Module            | Responsibility                                                                                                                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CommandManager`  | Slash, Prefix, and Context command orchestration with permission inference and automated error boundaries                                                                                                                     |
| `DatabaseManager` | MongoDB/Mongoose integration via `createMongoSchema`. Use `client.useDatabase()` to initialize a database on the client, and `useMongoDatabase()` in code without direct client access to retrieve the active Mongo instance. |
| `DiscordTools`    | Stateful UI helpers: `Paginator`, `Prompt`, `BetterModal` — imported directly from `"vimcord"`, not from a `DiscordTools` namespace                                                                                           |
| `DiscordUtils`    | Discord-specific utility functions                                                                                                                                                                                            |
| `Logger`          | Retro-style terminal logger for structured, actionable output                                                                                                                                                                 |

---

## Code Style

### Imports

- Use absolute imports. Avoid relative paths outside of the immediate module boundary.
- Order imports in three groups, separated by blank lines:
    1. Node built-ins
    2. Third-party packages (`discord.js`, `vimcord`, etc.)
    3. Local modules

### Formatting

All formatting is enforced via Prettier. Do not manually adjust whitespace or spacing — let the formatter handle it.

`.prettierrc`:

```json
{
    "tabWidth": 4,
    "useTabs": false,
    "printWidth": 125,
    "trailingComma": "none",
    "arrowParens": "avoid",
    "bracketSpacing": true,
    "singleQuote": false,
    "semi": true,
    "endOfLine": "lf"
}
```

### Naming Conventions

| Construct                  | Convention         |
| -------------------------- | ------------------ |
| Variables, functions       | `camelCase`        |
| Classes, interfaces, types | `PascalCase`       |
| Constants, env keys        | `UPPER_SNAKE_CASE` |
| File names                 | `kebab-case`       |

---

## Type Safety

These are non-negotiable constraints. Agents must follow them when generating or modifying TypeScript.

- **Never use `any`.** Use `unknown` and narrow with type guards. If you believe `any` is necessary, leave an inline comment explaining why — it will be reviewed.
- **Avoid type assertions (`as T`) unless narrowing is provably safe.** Prefer discriminated unions and exhaustive checks.
- **Use `satisfies` over `as` where possible** to validate shape without widening the type.
- **All function signatures must have explicit return types.** Do not rely on inference for exported functions or class methods.
- **Prefer `readonly` on data structures** that should not be mutated after construction.
- **Use `strictNullChecks`.** Never assume a value is non-null without a guard. The `!` non-null assertion operator is banned unless unavoidable.
- **Prefer typed discriminated unions over boolean flags** for state modeling (e.g., `{ status: "loading" } | { status: "error"; error: Error }` rather than `{ isLoading: boolean; error?: Error }`).

---

## Modular Architecture

Agents must respect and reinforce the following structural conventions:

- **Each command is a self-contained module.** A slash command file exports exactly one command definition. Do not co-locate multiple commands in a single file.
- **Side effects belong in lifecycle hooks**, not at module top level. Use `client.start()` or event handlers.
- **Database schemas live in a dedicated `schemas/` directory**, one schema per file, exported as a named constant.
- **Shared logic must be extracted into utilities**, not duplicated. If a pattern appears in two command files, it belongs in `utils/` or a Vimcord tool.
- **Event handlers are single-responsibility.** One file handles one event. Do not combine `messageCreate` and `interactionCreate` logic.
- **Do not mutate module-level state.** Use closures, class instances, or the database layer for persistent state.
- **Static configuration belongs in `constants/` (outside `src/`).** JSON files placed there are picked up by the hot-reload dev server without a rebuild. Do not move configuration into `src/` — doing so silently breaks this pattern. Re-export values through `src/constants.ts` as needed.

---

## Error Handling

- Wrap all async operations in `try/catch`. Do not let unhandled promise rejections propagate.
- Log errors through Vimcord's `Logger` — do not use `console.error` directly, **except** at the process boundary (e.g., `main().catch(console.error)`) where the Logger may not yet be initialized.
- Return early on error conditions. Avoid deeply nested `if` chains.
- Use typed error classes where the error type is meaningful to the caller. Avoid throwing plain strings. Example:

```typescript
class PermissionError extends Error {
    constructor(
        public readonly missing: string[],
        message = `Missing permissions: ${missing.join(", ")}`
    ) {
        super(message);
        this.name = "PermissionError";
    }
}

// Caller can now discriminate:
try {
    await requirePermissions(member, ["BanMembers"]);
} catch (err) {
    if (err instanceof PermissionError) {
        await interaction.reply({ content: err.message, flags: "Ephemeral" });
        return;
    }
    throw err;
}
```

---

## Agent Command Rules

- **Always use `pnpm`** for any package operations. `npm` and `yarn` are not used in this project.

```bash
pnpm add <package>
pnpm remove <package>
pnpm install
```

- Run `pnpm check` after each incremental step to catch type errors early.
- Run `pnpm build` before finalizing any change to verify the full compile pipeline (TypeScript emit + path alias resolution). A clean `pnpm check` does not guarantee a clean build.
- Do not commit changes that fail `pnpm build` or have unresolved TypeScript errors.

---

## Agent Execution Protocol

Agents must work incrementally. Do not attempt to refactor, scaffold, or fix multiple concerns in a single pass — this creates cascading type errors that are difficult to unwind.

### Step-by-Step Workflow

1. **Identify** the single unit of work (one file, one function, one type change).
2. **Make the change**, keeping the diff as small as reasonably possible.
3. **Run `pnpm check`** and capture the output.
4. **Report any type errors** encountered — include the file path, line number, and the full error message. Do not silently swallow compiler output.
5. **Resolve errors before moving on.** Do not proceed to the next file or concern while the current step has unresolved TypeScript errors.
6. **Confirm the step is clean**, then repeat from step 1 for the next unit of work.
7. **Run `pnpm build`** once all steps for a task are complete. Resolve any build-only failures (e.g., path alias resolution errors) before committing.

> **Note:** A clean `pnpm check` confirms type correctness but does not validate runtime behavior. If a change produces correct types but incorrect Discord API behavior (e.g., missing event registrations, commands not appearing, module auto-imports failing), stop and report the behavioral issue with reproduction steps before continuing.

### Hard Limits

- **Do not modify more than 3 files in a single step** for semantic changes. Purely mechanical changes (e.g., renaming an import path across files after a module move) may exceed this limit — if so, explicitly state that the changes are mechanical and non-type-affecting before proceeding.
- **Do not speculatively refactor.** Only change what is directly required by the current task. If you notice something unrelated that should be fixed, note it as a follow-up rather than fixing it inline.
- **Do not suppress type errors** with `// @ts-ignore` or `// @ts-expect-error` as a workaround. These are only acceptable as a last resort and must include a comment explaining why and a linked follow-up task.
- **If a step produces more than 5 type errors, stop.** Report all of them, explain what went wrong, and wait for guidance before continuing.

### Error Reporting Format

When reporting type errors, use this structure so they are actionable:

```
[TypeScript Error Report]
File: src/commands/slash/ping.ts
Line: 42
Error: TS2345 — Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
Context: Passing result of `interaction.options.getString()` directly without null check.
Suggested fix: Guard with `?? ""` or assert non-null after validating presence.
```

Never summarize errors vaguely (e.g., "there were some type issues"). Always report the exact compiler message.

---

## Commit & Branch Standards

- **Always work on a feature branch.** Do not commit directly to `main`. Branch names should be short and descriptive: `fix/paginator-timeout`, `feat/rate-limit-scope`, `refactor/schema-plugin-types`.
- **Each commit should represent one clean, passing unit of work.** Do not bundle unrelated changes in a single commit.
- **Write descriptive commit messages in imperative mood:** `Add paginator timeout option`, not `added timeout`.
- **Signal readiness for review** by opening a pull request and leaving a short description of what changed and why. Do not silently push a branch without a PR.
- Test all changes locally before committing.
