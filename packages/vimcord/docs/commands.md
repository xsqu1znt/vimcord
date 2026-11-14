# Commands

Default-export a module from each file in the directories configured on the [client](client.md). `login()` owns dispatch and application command synchronization.

## Slash commands

```ts
import { SlashCommandModule } from "vimcord";

export default new SlashCommandModule({
    builder: b => b.setName("search").setDescription("Finds a saved item.")
        .addStringOption(o => o.setName("query").setDescription("Item name").setAutocomplete(true)),
    deferReply: "ephemeral",
    autocomplete({ focused }) {
        return ["Guide", "Rules"].filter(n => n.toLowerCase().startsWith(String(focused.value).toLowerCase()))
            .map(n => ({ name: n, value: n }));
    },
    async execute({ interaction, user }) {
        await interaction.editReply(`Searching for ${interaction.options.getString("query")} for ${user.username}`);
    }
});
```

`builder` accepts a Discord.js builder or a builder callback. Autocomplete may return choices or respond directly and return nothing. `deferReply` is `false`, `true`, or `"ephemeral"`; the default is false. Deferral happens after gates and before the handler.

Slash `subcommands` is a record keyed by `name` or `group:name`, matching the builder. Each entry has `execute`, optional restrictions, `deferReply`, and `autocomplete`. A subcommand's deferral overrides the parent's, including false. Its autocomplete handler takes priority over the parent's.

```ts
import { SlashCommandModule } from "vimcord";

export default new SlashCommandModule({
    builder: b => b.setName("notes").setDescription("Manages notes.")
        .addSubcommand(s => s.setName("list").setDescription("Lists your notes.")),
    subcommands: {
        list: { async execute({ interaction }) { await interaction.reply("No notes yet."); } }
    }
});
```

## Prefix commands

Enable the Discord message intents and privileged Message Content intent, then configure `prefix` on the client. Prefix functions may be sync or async; return null to ignore a message.

```ts
import { PrefixCommandModule } from "vimcord";

export default new PrefixCommandModule({
    name: "echo",
    aliases: ["say"],
    description: "Repeats your text.",
    async execute({ message, content, args, lowerArgs, user, prefix, trigger }) {
        if (!args.length) { await message.reply(`Usage: ${prefix}${trigger} text`); return; }
        await message.reply({ content: `${user.username}: ${content}`, allowedMentions: { parse: [] } });
    }
});
```

Context provides the ready `client`, `user`, `message`, matched `prefix` and `trigger`, and canonical `subcommand` or null. `content` is the remaining text after the command and matched subcommand. `args` splits it on whitespace, and `lowerArgs` lowercases those tokens; both compute on first access. Use `content.split("|")` for a custom delimiter.

Prefix subcommands use `{ name: { aliases?, description?, execute, ...restrictions } }`. Parent restrictions pass first, then subcommand restrictions. A subcommand's `allowBots` overrides the parent's. With no matching subcommand, `execute` is the fallback if supplied; otherwise `onBlocked` receives `unknownRoute`. At least one executable handler is required.

## Context menus

```ts
// quote.mctx.ts
import { MessageContextCommandModule } from "vimcord";

export default new MessageContextCommandModule({
    builder: b => b.setName("Quote message"),
    async execute({ interaction }) {
        await interaction.reply({ content: interaction.targetMessage.content || "This message has no text.", flags: "Ephemeral", allowedMentions: { parse: [] } });
    }
});
```

```ts
// user-id.uctx.ts
import { UserContextCommandModule } from "vimcord";

export default new UserContextCommandModule({
    builder: b => b.setName("User ID"),
    async execute({ interaction }) { await interaction.reply({ content: interaction.targetUser.id, flags: "Ephemeral" }); }
});
```

The module sets the builder's command type, so do not call `setType`. Context menu commands share deferral, registration, restrictions, metadata, and hooks with slash commands.

## Shared options

| Option | Meaning | Default |
| --- | --- | --- |
| `id` | Module ID | Generated human-readable ID |
| `enabled` | Permit invocation | `true` |
| `requiresReady` | Wait for readiness | `true` for commands |
| `environment` | `"development"`, `"production"`, or `"both"` | `"both"` |
| `metadata` | `category`, `tags`, `emoji`, `examples`, `hidden`, or augmented project fields | `{}`; `hidden` false |
| `singleInvocation` | Skip matching work already running in this process | `false` |
| `hooks` | Local gates and failure handlers | None |
| `registration.global` | Include when syncing global commands | `true`, or `false` when `guilds` is set |
| `registration.guilds` | Guilds the command is registered in; startup sync pushes it there | None |

`singleInvocation: true` keys on module and invoking user. `{ key: ctx => string }` supplies a custom scope. It does not coordinate multiple processes. For standalone handler annotations use `CommandModuleContext<CommandModuleType.Prefix>`, or `GuildCommandModuleContext` where guild-only restrictions guarantee it.

## Permissions

```ts
import { PermissionFlagsBits } from "discord.js";
import { PrefixCommandModule } from "vimcord";

export default new PrefixCommandModule({
    name: "audit",
    guildOnly: true,
    botPermissions: [PermissionFlagsBits.SendMessages],
    access: { permissions: [PermissionFlagsBits.ManageGuild], staff: true },
    async execute({ message }) { await message.reply(`Auditing ${message.guild.name}`); }
});
```

| Restriction | Rule | Default |
| --- | --- | --- |
| `guildOnly` | Must run in a guild; true also narrows context | `false` |
| `botPermissions` | Bot must hold all permissions in the invoking channel | None |
| `allowBots` | Other bots may invoke it | `false` |
| `access.permissions` | User holds all listed channel permissions | None |
| `access.users` | User matches a configured user | None |
| `access.roles` | User holds any listed role in the invoking or configured staff guild | None |
| `access.guildOwner` | User owns the invoking guild | `false` |
| `access.staff` | User is configured bot staff | `false` |

Hard restrictions (`guildOnly`, bot permissions, and bot filtering) must all pass. Any configured `access` grant is sufficient. An omitted access object, an empty object, or empty grant arrays permit everyone after hard restrictions. Staff are only granted access where `staff: true` is present. Role IDs match either the invoking guild or the configured staff guild, including in DMs when a staff guild is available.

Unrecognized `access` keys log one warning per command or subcommand at construction. The warning names the command, any subcommand, and the ignored keys. When no recognized grant is configured, it says access is open to everyone passing the remaining restrictions. For `botOwner`, it recommends `access: { users: [...] }`. Warnings do not change access checks or run during invocation.

Use Discord.js builder contexts and default member permissions for Discord-side availability. `testCommandPermissions(ctx, restrictions)` provides the same runtime check and may return a promise. Its failed result has `reason: MissingPermissionReason` and optional missing permission or role arrays.

## Hooks

Set shared hooks on the client's `hooks: { all, prefix, slash, context }`, and local hooks on each module. `all` covers every command kind; its context always has `client`, `user`, and `module`, and `"interaction" in ctx` or `"message" in ctx` narrows it.

```ts
import type { GlobalCommandHooks } from "vimcord";

const hooks: GlobalCommandHooks = {
    all: {
        before: async ({ user }) => !user.bot,
        onError({ client }, error) { client.logger.error("Command failed", error); }
    },
    prefix: {
        async onBlocked({ message }, block) {
            if (block.kind === "running") return;
            await message.reply(block.kind === "unknownRoute" ? "Unknown subcommand." : "You cannot run that here.");
        }
    }
};
```

`before` runs `all`, then the kind's global hook, then the local one; each must return exactly true. Respond inside a gate when denying access. `onBlocked` and `onError` use the local callback, else the kind's global callback, else `all`, else the default reply.

`onBlocked(ctx, block)` receives `environment`, `permission`, `running`, or `unknownRoute`. Permission blocks carry the failure reason and missing fields; unknown routes carry `path`. A present `onBlocked` owns every block; blocks never reach `onError`. Handler, gate, and preparation errors go to `onError(ctx, error)`; without one they are logged and get the default error reply. Hook errors are logged.

## Default replies

When no hook takes a block or error, the command answers from the global UX config. A string is sent; `null` stays silent. Interactions get an ephemeral reply, an edit of a pending deferral, or a follow-up once answered. Prefix commands reply to the message without pings. Blocks from a bot invoker are always silent, and a failed send is only logged in verbose mode.

```ts
import { defineGlobalUxConfig } from "vimcord";

defineGlobalUxConfig({ command: { noAccess: "Staff only.", running: "Still working on your last one." } });
```

| Key | Sent for | Default |
| --- | --- | --- |
| `command.noAccess` | No `access` grant matched | `"You don't have permission to use this command."` |
| `command.botMissingPermissions` | The bot lacks `botPermissions` | `"I'm missing permissions needed to run this command."` |
| `command.notInGuild` | `guildOnly`, or a guild-only grant, outside a guild | `"This command can only be used in a server."` |
| `command.unknownSubcommand` | `unknownRoute`; `$PATH` is the unmatched path | `"Subcommand '$PATH' was not found."` |
| `command.environment` | `environment` excludes the current mode | `null` |
| `command.running` | `singleInvocation` skipped an overlapping run | `null` |
| `command.error` | The handler, a gate, or deferral threw; the error is still logged | `"Something went wrong while running this command."` |

Order: enabled/readiness, environment, parent restrictions, route and subcommand restrictions, global/local gates, single-invocation lock, deferral, handler. Hook context includes the typed running `module`, `client`, and command fields.
