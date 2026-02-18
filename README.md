<div align="center">

```
██╗   ██╗██╗███╗   ███╗ ██████╗ ██████╗ ██████╗ ██████╗
██║   ██║██║████╗ ████║██╔════╝██╔═══██╗██╔══██╗██╔══██╗
██║   ██║██║██╔████╔██║██║     ██║   ██║██████╔╝██║  ██║
╚██╗ ██╔╝██║██║╚██╔╝██║██║     ██║   ██║██╔══██╗██║  ██║
 ╚████╔╝ ██║██║ ╚═╝ ██║╚██████╗╚██████╔╝██║  ██║██████╔╝
  ╚═══╝  ╚═╝╚═╝     ╚═╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
```

**vhem-cord** — the Discord.js framework that actually respects your time

[![npm version](https://img.shields.io/npm/v/vimcord?color=%235865F2&label=vimcord&logo=npm&style=flat-square)](https://www.npmjs.com/package/vimcord)
[![npm downloads](https://img.shields.io/npm/dm/vimcord?color=%2357F287&label=downloads&style=flat-square)](https://www.npmjs.com/package/vimcord)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/npm/l/vimcord?color=%23FEE75C&label=license&style=flat-square)](LICENSE)
[![Discord.js](https://img.shields.io/badge/discord.js-14.x-%235865F2?style=flat-square&logo=discord)](https://discord.js.org/)

[Installation](#installation) · [Quick Start](#quick-start) · [Features](#features) · [API](#api-reference) · [Examples](#examples)

</div>

---

## What's Vimcord?

**Vimcord** (pronounced _vhem-cord_) is a lightweight, opinionated framework for **Discord.js**. Built for developers who want to go from an idea to a working command without fighting boilerplate.

Think of it as Discord.js with the sharp edges sanded off — full TypeScript inference, automatic error boundaries, and utilities that actually make sense.

> "I just wanted to build a bot, not write a command handler for the 47th time." — _You, probably_

---

## Installation

```bash
npm install vimcord discord.js
# or
pnpm add vimcord discord.js
# or
yarn add vimcord discord.js
```

**Peer dependencies** (optional but recommended):

```bash
npm install mongoose  # Only if using MongoDB
```

---

## Quick Start

### The Absolute Minimum

```ts
import { createClient, GatewayIntentBits } from "vimcord";

const client = createClient({ intents: [GatewayIntentBits.Guilds] }, { useDefaultSlashCommandHandler: true });

client.start();
```

### The "I Actually Want Features" Setup

```ts
import { GatewayIntentBits } from "discord.js";
import { createClient, MongoDatabase } from "vimcord";

const client = createClient(
    {
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
    },
    {
        // Auto-load modules from directories
        importModules: {
            events: "./events",
            slashCommands: "./commands/slash",
            prefixCommands: "./commands/prefix",
            contextCommands: "./commands/context"
        },

        // Built-in handlers for each command type
        useDefaultSlashCommandHandler: true,
        useDefaultPrefixCommandHandler: true,
        useDefaultContextCommandHandler: true,

        // Catch and log unhandled errors
        useGlobalErrorHandlers: true
    }
);

client.start(async () => {
    // Connect to MongoDB before login
    await client.useDatabase(new MongoDatabase(client));
});
```

---

## Features

### Command Management That Doesn't Suck

**Slash commands** with subcommand routing:

```ts
import { SlashCommandBuilder } from "vimcord";

export default new SlashCommandBuilder({
    builder: new SlashCommandBuilder()
        .setName("manage")
        .setDescription("Server management")
        .addSubcommand(sub => sub.setName("ban").setDescription("Ban a user")),

    // Route subcommands automatically
    routes: [
        {
            name: "ban",
            handler: async (client, interaction) => {
                // Handle /manage ban
            }
        }
    ],

    // Permission inference — Vimcord validates before executing
    permissions: {
        user: [PermissionFlagsBits.BanMembers],
        bot: [PermissionFlagsBits.BanMembers]
    }
});
```

**Prefix commands** with the same DX:

```ts
import { PrefixCommandBuilder } from "vimcord";

export default new PrefixCommandBuilder({
    name: "ping",
    aliases: ["p"],
    execute: async (client, message, args) => {
        await message.reply("Pong!");
    }
});
```

### BetterEmbed: Stop Writing Boilerplate

```ts
import { BetterEmbed } from "vimcord";

const embed = new BetterEmbed({
    context: { interaction }, // Auto-context for tokens
    title: "Welcome, $USER!",
    description: ["Your avatar: $USER_AVATAR", "Today is $MONTH/$DAY/$YEAR"],
    color: "#5865F2"
});

// ACF (Auto Context Formatting) tokens available:
// $USER, $USER_NAME, $DISPLAY_NAME, $USER_AVATAR
// $BOT_AVATAR, $YEAR, $MONTH, $DAY, $INVIS

await embed.send(interaction);
```

### The Paginator: Multi-Page Made Simple

```ts
import { Paginator, PaginationType } from "vimcord";

const paginator = new Paginator({
    type: PaginationType.LongJump, // first | back | jump | next | last
    timeout: 60000
});

// Add chapters (groups of pages)
paginator
    .addChapter([helpPage1, helpPage2, helpPage3], { label: "General Help", emoji: "📖" })
    .addChapter([modPage1, modPage2], { label: "Moderation", emoji: "🛡️" });

// Send it anywhere
const message = await paginator.send(interaction);

// Events for custom logic
paginator.on("pageChange", (page, index) => {
    console.log(`User viewing page ${index.nested} of chapter ${index.chapter}`);
});
```

### Prompt: Confirmation Dialogs

```ts
import { Prompt } from "vimcord";

const prompt = new Prompt({
    embed: new BetterEmbed({
        title: "Delete this message?",
        description: "This action cannot be undone.",
        context: { interaction }
    }),
    timeout: 30000
});

await prompt.send(interaction);
const result = await prompt.awaitResponse();

if (result.confirmed) {
    await message.delete();
}
```

### BetterModal: V2 Components Done Right

```ts
import { BetterModal } from "vimcord";

const modal = new BetterModal({
    title: "Create Ticket",
    components: [
        {
            textInput: {
                label: "Subject",
                custom_id: "subject",
                style: TextInputStyle.Short,
                required: true
            }
        },
        {
            textInput: {
                label: "Description",
                custom_id: "description",
                style: TextInputStyle.Paragraph
            }
        }
    ]
});

// Show and await in one call
const result = await modal.showAndAwait(interaction);

if (result) {
    const subject = result.getField("subject");
    await result.reply({
        content: `Ticket created: ${subject}`,
        flags: "Ephemeral"
    });
}
```

### DynaSend: One Method, Every Context

```ts
import { dynaSend } from "vimcord";

// Works with: interactions, channels, messages, users
// Automatically decides: reply? editReply? followUp? channel.send?
await dynaSend(interaction, {
    content: "Hello!",
    embeds: [myEmbed],
    components: [actionRow]
});
```

### Database: MongoDB Without the Pain

```ts
import { createMongoSchema, MongoDatabase } from "vimcord";

// Define a schema with retry logic built-in
const UserSchema = createMongoSchema("Users", {
    userId: { type: String, required: true, unique: true },
    username: String,
    balance: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

// CRUD operations with automatic retries
const user = await UserSchema.fetch({ userId: "123" });
await UserSchema.upsert({ userId: "123" }, { $inc: { balance: 100 } });

// Create plugins for reusable logic
const SoftDeletePlugin = createMongoPlugin(builder => {
    builder.schema.add({ deletedAt: { type: Date, default: null } });
    builder.extend({
        async softDelete(filter) {
            return this.update(filter, { deletedAt: new Date() });
        }
    });
});

UserSchema.use(SoftDeletePlugin);
```

### Logger: Terminal Output That Doesn't Suck

```ts
import { Logger } from "vimcord";

const logger = new Logger({
    prefix: "Economy",
    prefixEmoji: "💰",
    colors: { primary: "#57F287" }
});

logger.success("User purchased item");
logger.table("Stats", { users: 150, revenue: "$420.69" });

// Loader for async operations
const stopLoader = logger.loader("Connecting to database...");
await connectToDB();
stopLoader("Connected!");
```

---

## API Reference

### Client Creation

| Export                                        | Description                   |
| --------------------------------------------- | ----------------------------- |
| `createClient(options, features?, config?)`   | Create a new Vimcord instance |
| `Vimcord.create(options, features?, config?)` | Same as above                 |
| `Vimcord.getInstance(id?)`                    | Get existing instance by ID   |
| `Vimcord.getReadyInstance(id?, timeout?)`     | Wait for ready instance       |

### Feature Flags

```ts
{
    useDefaultSlashCommandHandler: boolean;   // Auto-handle slash commands
    useDefaultPrefixCommandHandler: boolean;  // Auto-handle prefix commands
    useDefaultContextCommandHandler: boolean; // Auto-handle context commands
    useGlobalErrorHandlers: boolean;          // Catch unhandled errors
    importModules: {
        events?: string | string[] | ModuleImportOptions;
        slashCommands?: string | string[] | ModuleImportOptions;
        prefixCommands?: string | string[] | ModuleImportOptions;
        contextCommands?: string | string[] | ModuleImportOptions;
    };
    maxLoginAttempts?: number;  // Retry login on failure (default: 3)
}
```

### Configuration

```ts
client.configure("app", {
    name: "MyBot", // Display name
    version: "1.0.0", // Version string
    devMode: false, // Use TOKEN_DEV env var
    verbose: false // Extra logging
});

client.configure("staff", {
    ownerId: "123456", // Bot owner
    staffRoleIds: ["..."] // Staff roles
});
```

---

## Examples

### Status Rotation

```ts
client.status.setRotation(
    [
        { name: "with commands", type: ActivityType.Playing },
        { name: "over {guilds} servers", type: ActivityType.Watching }
    ],
    { interval: 30000 }
); // Rotate every 30s
```

### Event Handler

```ts
import { EventBuilder } from "vimcord";

export default new EventBuilder({
    event: Events.MessageCreate,
    execute: async (client, message) => {
        if (message.author.bot) return;
        // Handle message
    }
});
```

### Error Handling

```ts
// Vimcord automatically catches command errors and sends user-friendly messages
// Configure what happens on error:

client.configure("slashCommands", {
    errorMessage: "❌ Something went wrong! Our team has been notified.",
    logErrors: true
});

// Or handle specific errors:
process.on("unhandledRejection", error => {
    client.logger.error("Unhandled rejection", error as Error);
});
```

---

## Environment Variables

```bash
# Required
TOKEN=your_production_bot_token
TOKEN_DEV=your_development_bot_token  # Used when devMode: true

# MongoDB (optional)
MONGO_URI=mongodb://localhost:27017/discord-bot
```

---

## About

Created by [**xsqu1znt**](https://github.com/xsqu1znt) with a simple goal: make Discord bot development enjoyable again.

Built on top of [qznt](https://github.com/xsqu1znt/qznt) for that extra bit of utility magic.

**License:** MIT

---

<div align="center">

Built with 💜 for the Discord.js community

Found a bug? [Open an issue](https://github.com/xsqu1znt/vimcord/issues)

</div>
