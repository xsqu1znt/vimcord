# AGENTS.md

This project is a monorepo and uses PNPM. Do not use NPM commands unless the user explicitly asks. Use the pnpm `--filter` flag to scope only the package you're working on when running commands.

## Tooling

- Use PNPM, never NPM, unless explicitly asked.
- `.prettierrc` via `pnpm format` is the formatting source of truth. Keep what it produces.

## Verification

- Run `pnpm format && pnpm check` when types, behavior, imports, schemas, command wiring, or build output changed. Fix what it flags.
- Skip it for docs-only, comment-only, or trivial mechanical edits.
- Do not write tests unless explicitly asked. (Overrides the global testing default.)

## TypeScript

- Never `any` — use proper types, generics, `unknown`, or narrowing. Never `var`.
- When a package API is unclear, check its type declarations in `node_modules` or current docs. Do not guess from training data; Discord library APIs change frequently between versions.

## Conventions

- File names: `PascalCase` when exporting a main class, otherwise `camelCase`. Classes and types `PascalCase`, variables and functions `camelCase`, constants `SCREAMING_SNAKE_CASE`.
- Import order: Node built-ins, third-party packages, local modules.
- Barrel-export new public files through the nearest `index.ts` when the surrounding module uses barrel exports.
- Comment non-trivial logic: business rules, side effects, assumptions, edge cases — why, not what. Use section comments (`// --- Validate input ---`) in longer functions. No comments on self-explanatory code.

## Safety

- Never hard-code secrets, tokens, or IDs.
- Never read `.env` files. `.env.example` is fine for understanding environment shape.