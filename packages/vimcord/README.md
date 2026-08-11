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
[![License](https://img.shields.io/npm/l/vimcord?color=%23FEE75C&label=license&style=flat-square)](LICENSE)
[![Discord.js](https://img.shields.io/badge/discord.js-14.x-%235865F2?style=flat-square&logo=discord)](https://discord.js.org/)

[Installation](#installation) · [Quick Start](#quick-start) · [Features](#features) · [API](#api-reference) · [Examples](#examples)

</div>

---

## What's Vimcord?

**Vimcord** wraps Discord.js with a focused module layer, typed command contexts, shared permission checks, global hooks, and UX helpers for embeds, prompts, modals, components, and pagination.

It does not hide Discord.js. You still use Discord.js builders, intents, events, permissions, and interactions directly where that is the right tool.

---

## Installation

```bash
pnpm add vimcord discord.js
```

Optional plugins:

```bash
pnpm add @vimcord/plugin-dotenv
pnpm add @vimcord/plugin-mongoose
```

---

## Quick Start

### Minimum Client

```ts
import { GatewayIntentBits } from "discord.js";
import { Vimcord } from "vimcord";

const client = new Vimcord({
    client: {
        intents: [GatewayIntentBits.Guilds]
    }
});

await client.login();
```

`login()` uses `TOKEN`, or `TOKEN_DEV` when `client.$devMode` is true.

### Process CLI

Call `setupCLI()` once to enable promptless slash commands through the process stdin. This works in a local terminal and in hosting dashboards that provide a console command field.

```ts
import { GatewayIntentBits } from "discord.js";
import { setupCLI, Vimcord } from "vimcord";

setupCLI({
    loaders: "auto" // "auto" | "always" | "never"
});

const client = new Vimcord({
    customId: "main",
    client: {
        intents: [GatewayIntentBits.Guilds]
    }
});
```

Clients participate by default once the process CLI is initialized. Set `globals.app.enableCLI` to `false` on clients that should remain unavailable to CLI commands. Enter `/help` in the process console to view commands.

### Modules And Command Dispatch

```ts
import { GatewayIntentBits } from "discord.js";
import { Vimcord } from "vimcord";
import { DotEnvPlugin } from "@vimcord/plugin-dotenv";

const client = new Vimcord({
    client: {
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
    },
    globals: {
        app: {
            name: "My Bot"
        },
        staff: {
            ownerId: "123456789012345678",
            superUsers: ["234567890123456789"]
        }
    },
    connectionRefresh: {
        interval: 60_000,
        maxFailures: 2
    },
    verbose: true
});

client.use(new DotEnvPlugin());

await client.modules.load({
    slashCommands: { dir: "./src/commands/slash", suffix: ".slash" },
    prefixCommands: { dir: "./src/commands/prefix", suffix: ".prefix" },
    events: { dir: "./src/events", suffix: ".event" }
});

client.on("interactionCreate", interaction => {
    void client.modules.commands.dispatchInteraction(interaction);
});

client.on("messageCreate", message => {
    if (message.author.bot) return;
    void client.modules.commands.dispatchMessage(message, ["!"]);
});

await client.login();
await client.modules.commands.push();
```

---

## Features

### Slash Commands

```ts
import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { SlashCommandModule } from "vimcord";

export default new SlashCommandModule({
    builder: new SlashCommandBuilder()
        .setName("manage")
        .setDescription("Server management")
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .addSubcommand(subcommand => subcommand.setName("ban").setDescription("Ban a user")),

    routes: [
        {
            path: "ban",
            deferReply: { flags: "Ephemeral" },
            async handler({ interaction }) {
                await interaction.editReply("Ban flow started.");
            }
        }
    ],

    permissions: {
        client: [PermissionFlagsBits.BanMembers]
    }
});
```

### Prefix Commands

```ts
import { PrefixCommandModule } from "vimcord";

export default new PrefixCommandModule({
    name: "ping",
    aliases: ["p"],
    async execute({ message, messageContent, splitContent }) {
        const args = splitContent({ lowercase: true });
        await message.reply(`Pong. You sent ${args.length} arg${args.length === 1 ? "" : "s"}.`);
    }
});
```

### Event Modules

```ts
import { Events } from "discord.js";
import { EventModule } from "vimcord";

export default new EventModule({
    name: "logMessages",
    event: Events.MessageCreate,
    async execute({ args: [message] }) {
        if (message.author.bot) return;
        console.log(`${message.author.tag}: ${message.content}`);
    }
});
```

### Global Command Hooks

```ts
import { defineGlobalCommandHooks } from "vimcord";

defineGlobalCommandHooks({
    slash: {
        async onError({ interaction, error }) {
            const content = `Something went wrong: ${error?.message ?? "Unknown error"}`;

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content, flags: "Ephemeral" });
                return;
            }

            await interaction.reply({ content, flags: "Ephemeral" });
        }
    }
});
```

Command-local hooks override `client.globals.hooks`, and `client.globals.hooks` override `defineGlobalCommandHooks()`.

### BetterEmbed

```ts
import { BetterEmbed, defineGlobalUxConfig } from "vimcord";

defineGlobalUxConfig({
    embedColor: "#5865F2",
    embedColorDev: "#FF9D00"
});

const embed = new BetterEmbed({
    context: { interaction },
    title: "Welcome, $USER_NAME",
    description: [showAvatar && "Your avatar: $USER_AVATAR", "", "Today is $MONTH/$DAY/$YEAR"],
    timestamp: true
});

await embed.send(interaction);
```

### BetterContainer And Components V2

```ts
import { ButtonStyle } from "discord.js";
import { BetterContainer } from "vimcord";

const container = new BetterContainer({ color: "#5865F2" })
    .addText("## Account linked")
    .addText(["Your Discord account is connected.", "Use the dashboard button to manage settings."])
    .addSection({
        text: "Open your dashboard.",
        button: {
            customId: "dashboard:open",
            label: "Dashboard",
            style: ButtonStyle.Primary
        }
    });

await container.send(interaction);
```

### Paginator

```ts
import { BetterContainer, Paginator, PaginationTimeout, PaginationType } from "vimcord";

const intro = new BetterContainer().addText("## Help").addText("Choose a page below.");
const moderation = new BetterContainer().addText("## Moderation").addText("Ban, kick, and timeout commands.");

const paginator = new Paginator({
    type: PaginationType.LongSkip,
    skipSize: 5,
    idle: 60_000,
    onTimeout: PaginationTimeout.DisableComponents
});

paginator
    .addChapter([intro, "Use `/help command` for command-specific help."], { label: "General", emoji: "📖" })
    .addChapter([moderation], { label: "Moderation", emoji: "🛡️" });

paginator.on("pageChange", (_page, index) => {
    console.log(`Viewing chapter ${index.chapter}, page ${index.nested}`);
});

await paginator.send(interaction);
```

### Prompt

```ts
import { BetterEmbed, promptMessage, ResolveAction } from "vimcord";

const result = await promptMessage(interaction, {
    embed: new BetterEmbed({
        context: { interaction },
        title: "Delete this message?",
        description: "This action cannot be undone."
    }),
    participants: [interaction.user],
    timeout: 30_000,
    onConfirm: ResolveAction.DisableComponents,
    onReject: ResolveAction.DisableComponents,
    onTimeout: ResolveAction.DeleteMessage,
    highlightSelectedButton: true
});

if (result.confirmed) {
    await targetMessage.delete();
}
```

### BetterModal

```ts
import { TextInputStyle } from "discord.js";
import { BetterModal } from "vimcord";

const modal = new BetterModal({ title: "Create Ticket" })
    .addTextDisplay({
        content: "Please provide the details below so we can help."
    })
    .addTextInput({
        customId: "subject",
        label: "Subject",
        style: TextInputStyle.Short,
        required: true
    })
    .addTextInput({
        customId: "description",
        label: "Description",
        style: TextInputStyle.Paragraph,
        required: false
    })
    .addUserSelect({
        customId: "assignees",
        label: "Assignees",
        maxValues: 3,
        required: false
    });

const result = await modal.showAndAwait(interaction, { timeout: 60_000 });
if (!result) return;

const subject = result.getField<string>("subject", true);
const assignees = result.getField("assignees", "getSelectedUsers");

await result.reply({
    content: `Ticket created: ${subject}`,
    flags: "Ephemeral"
});
```

### DynaSend

```ts
import { dynaSend, SendMethod } from "vimcord";

await dynaSend(interaction, {
    sendMethod: interaction.deferred || interaction.replied ? SendMethod.EditReply : SendMethod.Reply,
    content: "Hello from one send helper.",
    embeds: [embed]
});
```

### MongoDB Plugin

```ts
import { createMongoPlugin, createMongoSchema, MongoosePlugin } from "@vimcord/plugin-mongoose";

client.use(
    new MongoosePlugin({
        connectionRefresh: {
            interval: 60_000,
            maxFailures: 2
        }
    })
);

const Users = createMongoSchema("Users", {
    userId: { type: String, required: true, unique: true },
    balance: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

const user = await Users.fetch({ userId: "123" }, undefined, { required: true });
await Users.upsert({ userId: "123" }, { $inc: { balance: 100 } });

const SoftDeletePlugin = createMongoPlugin(builder => {
    builder.schema.add({ deletedAt: { type: Date, default: null } });
    builder.extend({
        async softDelete(filter) {
            return this.update(filter, { deletedAt: new Date() });
        }
    });
});

Users.use(SoftDeletePlugin);
```

### Client Logger

```ts
client.logger.success("Startup complete");
client.logger.debug("Only shown when verbose mode is enabled");

const loader = client.logger.loader("Syncing commands...");
await client.modules.commands.push();
loader.succeed("Commands synced");
```

---

## API Reference

### Core Exports

| Export | Description |
| --- | --- |
| `Vimcord` | Discord.js client subclass with modules, plugins, globals, status, and logging |
| `SlashCommandModule` | Slash command module with optional subcommand routes |
| `PrefixCommandModule` | Prefix command module with aliases and parsed message content |
| `MessageContextCommandModule` | Message context menu command module |
| `UserContextCommandModule` | User context menu command module |
| `EventModule` | Typed Discord event module |
| `BetterEmbed` | Embed helper with context formatting |
| `BetterContainer` | Components V2 container helper |
| `Paginator` | Component-based paginator |
| `BetterModal` | Modal helper with V2 component support |
| `promptMessage`, `promptModal` | Confirmation prompt helpers |
| `dynaSend` | Send helper for interactions, channels, messages, members, and users |
| `defineGlobalUxConfig` | Global UX defaults for embeds, collectors, paginator, and prompts |
| `defineGlobalCommandHooks` | Global command hooks used when modules do not define local hooks |
| `setupCLI` | Initializes the process-wide stdin CLI and its client targets |
| `CLILogger` | CLI-specific logger with target headers, groups, tables, styles, and loaders |

### Client Options

```ts
const client = new Vimcord({
    customId: "main",
    client: {
        intents: [GatewayIntentBits.Guilds]
    },
    globals: {
        app: {
            name: "My Bot",
            devMode: false,
            enableCLI: true,
            disableBanner: false
        },
        staff: {
            ownerId: "123456789012345678",
            superUsers: [],
            superUserRoles: []
        }
    },
    connectionRefresh: {
        interval: 60_000,
        requestTimeout: 10_000,
        maxFailures: 2,
        maxRefreshAttempts: 3
    },
    verbose: false
});
```

### Module Loading

```ts
await client.modules.load({
    slashCommands: { dir: "./src/commands/slash", suffix: ".slash" },
    prefixCommands: { dir: "./src/commands/prefix", suffix: ".prefix" },
    messageContextCommands: { dir: "./src/commands/message-context", suffix: ".mctx" },
    userContextCommands: { dir: "./src/commands/user-context", suffix: ".uctx" },
    events: { dir: "./src/events", suffix: ".event" }
});
```

### Runtime Configuration

```ts
client.configure({
    app: {
        name: "My Bot",
        devMode: true
    },
    staff: {
        ownerId: "123456789012345678",
        superUserRoles: ["987654321098765432"]
    },
    hooks: {
        prefix: {
            async onError({ message, error }) {
                await message.reply(`Command failed: ${error?.message ?? "Unknown error"}`);
            }
        }
    }
});
```

### Plugin CLI And Health Contributions

Plugin install hooks receive a typed context. Contributions remain scoped to that client and are removed automatically when the plugin unloads.

```ts
import type { VimcordPluginContext } from "vimcord";
import { VimcordPlugin } from "vimcord";

class ServicePlugin extends VimcordPlugin {
    override name = "service";
    override description = "Example service integration";
    override version = "1.0.0";

    constructor(private readonly service: { ping(): Promise<void> }) {
        super();
    }

    override install({ cli, health }: VimcordPluginContext) {
        cli.registerCommand({
            name: "service-info",
            description: "Displays service information.",
            execute: ({ logger, client }) => logger.header("Service Info", client)
        });

        health.register({
            id: "service",
            label: "Service API",
            check: async () => {
                const startedAt = performance.now();
                await this.service.ping();
                return { status: "healthy", latencyMs: performance.now() - startedAt };
            }
        });
    }

    override uninstall() {}
}
```

---

## Examples

### Status Rotation

Status config is user-owned. Vimcord does not provide a default status rotation, and a single profile applies in both
development and production.

```ts
import { ActivityType } from "discord.js";

await client.status.set({
    interval: 30_000,
    randomize: true,
    activity: [
        { name: "$GUILD_COUNT servers", type: ActivityType.Watching, status: "online" },
        { name: "Need help? Use /help", type: ActivityType.Custom, status: "online" }
    ]
});
```

Pass `production` and/or `development` profiles when their statuses differ. An omitted profile leaves that environment's
status blank; profiles do not fall back across environments.

### Command Dispatch Events

```ts
import { Events } from "discord.js";
import { EventModule } from "vimcord";

export default new EventModule({
    name: "dispatchInteractions",
    event: Events.InteractionCreate,
    async execute({ client, args: [interaction] }) {
        await client.modules.commands.dispatchInteraction(interaction);
    }
});
```

```ts
import { Events } from "discord.js";
import { EventModule } from "vimcord";

export default new EventModule({
    name: "dispatchPrefixCommands",
    event: Events.MessageCreate,
    async execute({ client, args: [message] }) {
        if (message.author.bot) return;
        await client.modules.commands.dispatchMessage(message, ["!", "?"]);
    }
});
```

### Bot Staff Checks

```ts
const isStaff = await client.isBotStaff(interaction.user.id);
if (!isStaff) {
    await interaction.reply({ content: "This is staff-only.", flags: "Ephemeral" });
}
```

---

## Environment Variables

```bash
TOKEN=your_production_bot_token
TOKEN_DEV=your_development_bot_token

MONGO_URI=mongodb://localhost:27017/discord-bot
MONGO_URI_DEV=mongodb://localhost:27017/discord-bot-dev
```

---

## About

Created by [**xsqu1znt**](https://github.com/xsqu1znt) with a simple goal: make Discord bot development enjoyable again.

**License:** MIT

---

<div align="center">

Built with love for the Discord.js community

Found a bug? [Open an issue](https://github.com/xsqu1znt/vimcord/issues)

</div>
