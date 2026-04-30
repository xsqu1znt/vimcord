## Agent Guidelines
> The following are strict guidelines for working inside of this repo.

### Command Line
This project uses the PNPM package manager, avoid using NPM.

| Command       | Description                                 |
| ------------- | ------------------------------------------- |
| `pnpm format` | Formats all `.ts` and `.json` with Prettier |
| `pnpm check`  | Type-checks without emitting                |
| `pnpm build`  | Compiles the project using tsup             |
|               |                                             |

### Workflow
Always run `pnpm format` then `pnpm check` after a task before declaring it complete. There should be zero type errors from anything relevant you touched unless instructed by the user to ignore it.

**This is the format you should follow when instructed to build something:**
1. Identify what actually exists vs. what needs to be built
2. If there’s missing context or something you’re unsure about, ask the user and/or search the web — never assume based on your training data
3. Gather the coding style used in a few surrounding and related files, do not introduce slop code
4. Write the code — optimize for maintainability and readability with high senior engineer standards
5. Provide the user a brief summary of what was changed and any important-to-know implementation choices that were made, but keep it straight-forward

**Code Style:**
- Prefer inlining code instead of creating a top-level utility function where possible
- Prefer `!variable` for empty/falsy checks over explicit comparisons like `.length === 0`
- Use an existing `.prettierrc` in the working directory as the source of truth for formatting style
- Use ternary operators for simple pluralization: `word${count === 1 ? "" : "s"}`. Ensure grammar is correct — check verb agreement too (e.g., `${count === 1 ? "has" : "have"}`)
- Use section header style comments (// --- Section Name ---) for code blocks within functions, and inline comments (// Ensure the string contains a prefix) to improve code skim-ability and readability. Skip section headers for top-level declarations like imports, constants, and command definitions
- Never use `any`, only proper generics
- Always barrel export any new files
- Always use `const` over `let`, never use `var`

**Name Conventions:**
- Files: `PascalCase` if exporting a main class, otherwise `camelCase`
- Classes/Types: `PascalCase`
- Variables/Functions: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE`

**Import Order:**
1. Node built-ins (`import { randomUUID } from "node:crypto"`)
2. Third-party packages (`import { $ } from "qznt"`)
3. Local modules (`import { UserSchema } from "@db/index"`)

### Important
- Never hard-code secrets.
- Never assume how something works based on your training data.
- Be smart and check `package.json` for the versions you’re working with.
- Don’t be afraid to check `node_modules` for the relevant package’s type-declarations when needed.
- Keep the code you write tight and never overbloat a file.
