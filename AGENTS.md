# AGENTS.md - Project Guidelines

> Opinionated guidelines for working in Vimcord's repo. Follow these strictly.

---

**Vimcord** (pronounced _vhem-cord_) is a lightweight, opinionated framework for **Discord.js**, designed to minimize the distance between an idea and a working command. It abstracts the library's complexity without sacrificing control.

## Build & Dev Commands

| Command                  | Description                                                                 |
| ------------------------ | --------------------------------------------------------------------------- |
| `pnpm run dev`           | Dev server with hot reload (nodemon + tsx)                                  |
| `pnpm run dev:verbose`   | Dev server with hot reload (nodemon + tsx) with verbose output from Vimcord |
| `pnpm run build`         | Compile TypeScript (tsc + tsc-alias)                                        |
| `pnpm run check`         | Type-check without emitting — **run after every file**                      |
| `pnpm run start`         | Run compiled output from `dist/`                                            |
| `pnpm run start:verbose` | Run compiled output from `dist/` with verbose output from Vimcord           |
| `pnpm run format`        | Format all `.ts` and `.json` with Prettier                                  |

**Always run `pnpm run check` before declaring a task complete. Zero type errors is the bar.**

## Your Workflow

> **VERY IMPORTANT:** When relevant, check for skills. If you are confused at any point about how to properly build something, do not be afraid to look up online references, documentation, or ask the user.

**Before Writing Code**

1. Read this AGENTS.md fully
2. Check for relevant skills
3. Run: find src -type f | sort
4. Read any existing files relevant to your task
5. Identify what exists vs. what needs to be built
6. Plan every file you'll create or modify before starting

**While Writing Code**

- Write all files for a feature together, not one at a time
- If a schema is needed, write it first - commands depend on schemas, not the reverse
- If a utility is shared across files, write it first
- Run `pnpm run check` after each file to catch type errors early
- Barrel-export any new files immediately for new utilities/features/schemas/etc

**After Writing Code**

- Run `pnpm run check` - fix ALL type errors before finishing
- Run `pnpm run format` - formatting is not optional

## Coding Style

**Prettier rules:** 4-space tabs · 125 char line width · double quotes · semicolons · no trailing commas · LF endings · arrow parens avoided (x => x not (x) => x)

**Import order:**

1. Node built-ins (`import { randomUUID } from "node:crypto"`)
2. Third-party packages (`import { PermissionFlagsBits } from "discord.js"`)
3. Local modules (`import { UserSchema } from "@db/index"`)

**Naming:**

- Files: `kebab-case` with type suffix - `ping.slash.ts`, `user.schema.ts`, `autocomplete.inventory.event.ts`
- Commands: `ping.slash.ts`, `userInfo.ctx.ts`
- Classes/Types: `PascalCase`
- Variables/Functions: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE`

## Non-Negotiable Code Rules

- **No `any`, use `unknown`** with type guards, or proper generics
- **Explicit return types** for every function: `async function foo(): Promise<void>`
- **Path aliases only** never use relative imports (`../../`), see alias table in tsconfig.json if it exists
- **`export default`** all command and event files
- **`deferReply: true`** any command that hits DB or takes > 1s
- **`editReply` after defer** never `reply` on a deferred interaction
- **`async/await` everywhere** never `.then()` chains
- **Semicolons** after every statement
- **Never hardcode secrets** tokens, IDs, URIs always from env or constants
- **One command per file** no exceptions
- **`const` over `let`** never `var`
- **Comments for readability** use section headers (// --- Section Name ---) for code blocks within functions and inline comments to improve code skim-ability and readability. Skip section headers for top-level declarations like imports, constants, and command definitions
- **Barrel exports** for example, new schemas go in `src/db/index.ts` immediately
- **Truthy checks** prefer `!variable` for empty/falsy checks over explicit comparisons like `.length === 0`
- **Inline pluralization** use ternary operators for simple pluralization: `word${count === 1 ? "" : "s"}`. Ensure grammar is correct — check verb agreement too (e.g., `${count === 1 ? "has" : "have"}`)
