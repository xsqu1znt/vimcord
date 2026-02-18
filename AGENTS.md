# AGENTS.md

> This is a living document for agentic coding within the Vimcord repository. Keep it current.

---

## Project Overview

**Vimcord** (pronounced _vhem-cord_) is a lightweight, opinionated framework for **Discord.js**, designed to minimize the distance between an idea and a working command. It abstracts the library's complexity without sacrificing control.

### Core Modules

| Module            | Responsibility                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| `CommandManager`  | Slash, Prefix, and Context command orchestration with permission inference and automated error boundaries |
| `DatabaseManager` | MongoDB/Mongoose integration via `createMongoSchema` and `useMongoDatabase`                               |
| `DiscordTools`    | Stateful UI helpers: `Paginator`, `Prompt`, `BetterModal`                                                 |
| `DiscordUtils`    | Discord-specific utility functions                                                                        |
| `Logger`          | Retro-style terminal logger for structured, actionable output                                             |

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

---

## Error Handling

- Wrap all async operations in `try/catch`. Do not let unhandled promise rejections propagate.
- Log errors through Vimcord's `Logger` — do not use `console.error` directly.
- Return early on error conditions. Avoid deeply nested `if` chains.
- Use typed error classes where the error type is meaningful to the caller. Avoid throwing plain strings.

---

## Agent Command Rules

- **Always use `pnpm`** for any package operations. `npm` and `yarn` are not used in this project.

```bash
  pnpm add <package>
  pnpm remove <package>
  pnpm install
```

- Run `pnpm build` to verify compilation before finalizing any change.
- Do not commit changes that fail to compile or have unresolved TypeScript errors.

## Agent Execution Protocol

Agents must work incrementally. Do not attempt to refactor, scaffold, or fix multiple concerns in a single pass — this creates cascading type errors that are difficult to unwind.

### Step-by-Step Workflow

1. **Identify** the single unit of work (one file, one function, one type change).
2. **Make the change**, keeping the diff as small as reasonably possible.
3. **Run `pnpm build`** (or `pnpm tsc --noEmit` for a type-only check) and capture the output.
4. **Report any type errors** encountered — include the file path, line number, and the full error message. Do not silently swallow compiler output.
5. **Resolve errors before moving on.** Do not proceed to the next file or concern while the current step has unresolved TypeScript errors.
6. **Confirm the step is clean**, then repeat from step 1 for the next unit of work.

### Hard Limits

- **Do not modify more than 3 files in a single step** unless the changes are purely mechanical and non-type-affecting (e.g., renaming an import path across files after a module move).
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

## Commit & Testing Standards

- Test all changes locally before committing.
- Write descriptive commit messages in imperative mood: `Add paginator timeout option`, not `added timeout`.
- Do not bundle unrelated changes in a single commit.
