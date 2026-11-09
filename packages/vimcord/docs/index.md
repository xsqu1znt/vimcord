# Vimcord docs

- [basic starter template](https://github.com/xsqu1znt/vimcord/tree/main/templates/basic): a copyable bot with slash and prefix commands, a ready event, and dotenv.
- [client.md](client.md): client options, module loading, staff, status, logging, and CLI commands.
- [commands.md](commands.md): slash, prefix, context menus, autocomplete, permissions, and hooks.
- [events.md](events.md): Discord event modules.
- [ux/embed.md](ux/embed.md): embeds, conditional lines, colors, and sending.
- [ux/container.md](ux/container.md): Components V2 containers, sections, and action rows.
- [ux/collector.md](ux/collector.md): participant access, click handlers, timing, and cleanup.
- [ux/paginator.md](ux/paginator.md): chapters, lazy pages, navigation, and loading states.
- [ux/prompt.md](ux/prompt.md): confirmation and custom decisions.
- [ux/modal.md](ux/modal.md): typed form inputs and submissions.
- [ux/dyna-send.md](ux/dyna-send.md): target inference, delivery overrides, and return types.
- [plugins.md](plugins.md): plugin lifecycle and health probes.
- [migration/v5.md](migration/v5.md): steps from Vimcord 4 and Mongoose plugin 1 to the new API.

| I want to | Use |
| --- | --- |
| Copy a working starter bot | [Basic template](https://github.com/xsqu1znt/vimcord/tree/main/templates/basic) |
| Start a bot or register a terminal command | [Client and CLI](client.md) |
| Restrict a command or gate all commands | [Permissions and hooks](commands.md) |
| React to a Discord event | [EventModule](events.md) |
| Display rich content | [BetterEmbed](ux/embed.md) or [BetterContainer](ux/container.md) |
| Handle buttons or selects | [BetterCollector](ux/collector.md) |
| Browse several pages or load data on demand | [Paginator](ux/paginator.md) |
| Ask for a decision | [promptMessage](ux/prompt.md) |
| Collect typed form values | [BetterModal](ux/modal.md) |
| Send through different Discord targets | [dynaSend](ux/dyna-send.md) |
| Own an external service connection | [VimcordPlugin](plugins.md) |
| Add MongoDB | [Mongoose plugin](https://www.npmjs.com/package/@vimcord/plugin-mongoose) |
