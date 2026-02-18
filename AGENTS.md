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

## Installation

```bash
pnpm add vimcord discord.js
```

---

## Quick Start

Vimcord exposes a `createClient` factory that returns a pre-configured client with optional feature flags:

```ts
import { GatewayIntentBits } from "discord.js";
import { createClient, MongoDatabase } from "vimcord";

const client = createClient(
    {
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
    },
    {
        useGlobalErrorHandlers: true,
        useDefaultSlashCommandHandler: true,
        useDefaultPrefixCommandHandler: true,
        useDefaultContextCommandHandler: true,
        useEnv: true,
        importModules: {
            events: "./events",
            slashCommands: "./commands/slash",
            prefixCommands: "./commands/prefix",
            contextCommands: "./commands/context"
        }
    }
);

client.start(async client => {
    await client.useDatabase(new MongoDatabase(client));
});
```

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

---

## Commit & Testing Standards

- Test all changes locally before committing.
- Write descriptive commit messages in imperative mood: `Add paginator timeout option`, not `added timeout`.
- Do not bundle unrelated changes in a single commit.
