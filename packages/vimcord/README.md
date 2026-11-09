<div align="center">

```
██╗   ██╗██╗███╗   ███╗ ██████╗ ██████╗ ██████╗ ██████╗
██║   ██║██║████╗ ████║██╔════╝██╔═══██╗██╔══██╗██╔══██╗
██║   ██║██║██╔████╔██║██║     ██║   ██║██████╔╝██║  ██║
╚██╗ ██╔╝██║██║╚██╔╝██║██║     ██║   ██║██╔══██╗██║  ██║
 ╚████╔╝ ██║██║ ╚═╝ ██║╚██████╗╚██████╔╝██║  ██║██████╔╝
  ╚═══╝  ╚═╝╚═╝     ╚═╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
```

**vhem-cord** - a small Discord.js framework for typed modules, command dispatching, and reusable UX tools.

[![npm version](https://img.shields.io/npm/v/vimcord?color=%235865F2&label=vimcord&logo=npm&style=flat-square)](https://www.npmjs.com/package/vimcord)
[![npm downloads](https://img.shields.io/npm/dm/vimcord?color=%2357F287&label=downloads&style=flat-square)](https://www.npmjs.com/package/vimcord)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/npm/l/vimcord?color=%23FEE75C&label=license&style=flat-square)](https://github.com/xsqu1znt/vimcord/blob/main/LICENSE)
[![Discord.js](https://img.shields.io/badge/discord.js-14.x-%235865F2?style=flat-square&logo=discord)](https://discord.js.org/)

[Quickstart](#quickstart) · [Docs](docs/index.md) · [Migrate to v5](docs/migration/v5.md)

</div>

## What is Vimcord?

Vimcord is an opinionated Discord.js framework with typed command and event modules, shared permissions and hooks, and reusable message UX. It keeps Discord.js builders, intents, interactions, and events available directly.

## Who is it for?

- Bots with enough commands to need a consistent module structure.
- Teams that want shared access rules and hooks across commands.
- Bots with interactive menus, prompts, and paginated messages.

## Why use it?

| With raw Discord.js | With Vimcord |
| --- | --- |
| Route interactions and find handlers yourself | Export command modules and configure their directories |
| Repeat access checks around handlers | Declare restrictions and shared command hooks |
| Coordinate button collectors, cleanup, and page state | Use `BetterCollector`, `promptMessage`, and `Paginator` |

## Quickstart

Start from the [basic bot template](https://github.com/xsqu1znt/vimcord/tree/main/templates/basic), or create the files below.

```sh
pnpm add vimcord discord.js
```

Create `src/index.ts`:

```ts
import { GatewayIntentBits } from "discord.js";
import { Vimcord } from "vimcord";

const client = new Vimcord({
    intents: [GatewayIntentBits.Guilds],
    modules: {
        slashCommands: { dir: "./commands", suffix: ".slash" }
    }
});

await client.login();
```

Create `src/commands/ping.slash.ts`:

```ts
import { SlashCommandModule } from "vimcord";

export default new SlashCommandModule({
    builder: b => b.setName("ping").setDescription("Checks whether the bot is online."),
    async execute({ interaction }) {
        await interaction.reply("Pong!");
    }
});
```

Provide `TOKEN` through your process environment. `--dev` selects `TOKEN_DEV`. Run the entry with your TypeScript runner, or compile and run the matching JavaScript layout. Module directories resolve relative to the entry file. `login()` installs plugins, loads modules, starts routing, and connects; it syncs application commands when ready.

For env-file loading, install `@vimcord/plugin-dotenv` and pass `new DotEnvPlugin()` in the client's `plugins` array.

## Docs

Start with the [topic index and task lookup](docs/index.md).

- [Client, staff, status, logging, and CLI](docs/client.md)
- [Commands, permissions, autocomplete, and hooks](docs/commands.md)
- [Events](docs/events.md)
- [Embeds](docs/ux/embed.md), [containers](docs/ux/container.md), and [sending](docs/ux/dyna-send.md)
- [Collectors](docs/ux/collector.md), [paginators](docs/ux/paginator.md), [prompts](docs/ux/prompt.md), and [modals](docs/ux/modal.md)
- [Writing plugins](docs/plugins.md)
- [Migration from Vimcord 4 to 5](docs/migration/v5.md)

Optional plugins: [dotenv](https://www.npmjs.com/package/@vimcord/plugin-dotenv) and [Mongoose](https://www.npmjs.com/package/@vimcord/plugin-mongoose).
