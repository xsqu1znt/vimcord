# Vimcord

An opinionated Discord.js framework: a module layer, typed command contexts, hooks, and UX helpers for embeds, prompts, modals, components, and pagination. It does not hide Discord.js — builders, intents, events, permissions, and interactions stay the Discord.js ones.

See [`packages/vimcord/README.md`](packages/vimcord/README.md) for installation, quick start, and the full API reference. That's what ships to [npm](https://www.npmjs.com/package/vimcord).

## Repo layout

A PNPM workspace.

- [`packages/vimcord`](packages/vimcord) — the `vimcord` package. Holds all the framework code.
- [`packages/plugins/dotenv`](packages/plugins/dotenv) — `@vimcord/plugin-dotenv`, loads env files through the plugin lifecycle.
- [`packages/plugins/mongoose`](packages/plugins/mongoose) — `@vimcord/plugin-mongoose`, the Mongoose connection and `MongoSchemaBuilder`.
- [`templates`](templates) — starter templates for new bots.

## Development

```bash
pnpm install
pnpm build # build every package
pnpm check # typecheck every package
pnpm vitest run # run tests
pnpm format # format every package
```

Releases go through [Changesets](https://github.com/changesets/changesets). Run `pnpm changeset` after a change that should ship, then merge as usual — CI opens a version PR and publishes to npm once it's merged.

## License

MIT
