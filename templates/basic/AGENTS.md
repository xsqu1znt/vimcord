# Bot conventions

This bot runs on Vimcord, a Discord.js framework. Before writing code, read `node_modules/vimcord/docs/index.md` and the topic pages it links. Use the Discord.js builders, intents, and events directly; Vimcord does not wrap them.

## Modules

- `src/index.ts` creates the client. `modules: "./"` loads modules from every folder under `src` by file suffix. Shared command hooks go in its `hooks` option and UX defaults (embed colors, default command replies) in `ux`.
- One module per file, as its default export. Any file without one of these suffixes is a helper and is never loaded.

| Suffix | Default export |
| --- | --- |
| `.slash.ts` | `SlashCommandModule` |
| `.prefix.ts` | `PrefixCommandModule` |
| `.mctx.ts` | `MessageContextCommandModule` |
| `.uctx.ts` | `UserContextCommandModule` |
| `.event.ts` | `EventModule` |

Commands live in `src/commands` and events in `src/events`.

## Environment

Read `.env.example` for the variable names. Never open or print `.env`; it holds the bot token.

## Commands

- `pnpm dev` runs the bot and restarts on changes; `pnpm start` runs it once. Append `--dev` to use `TOKEN_DEV`.
- `pnpm check` type-checks. Run it after every change.
- `pnpm format` formats with Prettier.
