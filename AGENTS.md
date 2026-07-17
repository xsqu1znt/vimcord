# AGENTS.md

This project is a monorepo and uses PNPM. Do not use NPM commands unless the user explicitly asks. Use the pnpm `--filter` flag to scope only the package you're working on when running commands.

## Workflow

- First identify what exists, then make the smallest correct change. Do not rewrite, redesign, or add abstractions unless the task actually needs it.
- If behavior, package APIs, or project intent is unclear, check the repo, `package.json`, relevant `node_modules` type declarations, current docs, or ask the user. Do not guess from training data.
- Read nearby code before editing so new code matches the existing style and architecture.
- Prefer targeted searches, focused file reads, parallel tool calls where safe, and combined commands to reduce API hits and wasted tokens.
- Be selective with verification. Do not run `pnpm format`, `pnpm check`, or `pnpm build` for docs-only edits, config text changes, comments-only changes, or tiny mechanical edits that do not affect TypeScript behavior.
- Run `pnpm format && pnpm check` when code behavior, types, imports, command wiring, schemas, build output, or package configuration changed enough that verification can catch a real issue. Fix relevant errors unless the user tells you not to.
- For small code edits, use judgment: skip full checks when the change is obviously safe, and run the narrowest useful verification when uncertain.
- Do a full pass on the file changes and any code you wrote and make sure the mandatory comments rule is satisfied
- End with a short summary of what changed, important implementation choices, and verification run.

## Coding Rules

- Keep code direct and predictable. Prefer obvious control flow over cleverness.
- Inline simple one-off logic. Create a helper only when logic is reused, isolates a real boundary, or makes a complex block easier to read.
- Keep helpers close to their use unless they are genuinely shared. Avoid top-level utility rabbit holes for single-use transformations.
- Relevant comments are mandatory for non-trivial code. Add section comments like `// --- Validate Input ---` inside longer functions and short inline comments for business rules, side effects, assumptions, edge cases, or non-obvious transformations.
- Do a final comment pass before finishing. If changed logic takes more than a quick skim to understand, add a useful comment instead of leaving it implicit.
- Do not add noise comments for imports, obvious assignments, or code that is already self-explanatory.
- Use `const` by default, but use `let` for intentionally mutated primitive state such as counters, accumulators, retries, cursors, or reassignment. Do not wrap values in objects or arrays just to avoid `let`.
- Never use `var`.
- Never use `any`; use proper types, generics, `unknown`, or narrowed values.
- Prefer `!value` for empty/falsy checks when it stays clear.
- Use ternaries for simple pluralization, and keep grammar correct: `item${count === 1 ? "" : "s"}` and `${count === 1 ? "has" : "have"}`.
- Barrel-export new public files through the nearest `index.ts` when the surrounding module uses barrel exports.
- Keep files tight. Do not add framework, compatibility, or future-proofing code without a concrete need.

## Style

- Use the existing `.prettierrc` and `pnpm format` as the formatting source of truth.
- File names: `PascalCase` when exporting a main class, otherwise `camelCase`.
- Classes and types: `PascalCase`.
- Variables and functions: `camelCase`.
- Constants: `SCREAMING_SNAKE_CASE`.
- Import order: Node built-ins, third-party packages, then local modules.

## Safety

- Never hard-code secrets, tokens, IDs, or environment-specific credentials.
- Never read `.env` files, with an exception for relevant `.env.example` files if understanding an environment shape is needed.
- Do not overwrite or revert user changes unless explicitly requested.
- Do not add backward compatibility unless persisted data, shipped behavior, external consumers, or the user requires it.
- If generated formatting changes appear after `pnpm format`, keep them unless there is a strong reason not to.
- Prefer smart, boring, maintainable TypeScript over abstract or surprising code.
