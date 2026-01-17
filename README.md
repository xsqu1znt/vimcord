# vimcord

**Vimcord** (pronounced as in _vhem-cord_) is a lightweight, opinionated framework for **Discord.js**. Built for developers who want to reduce the distance between an idea and a working command without fighting with the library.

## 🚀 Installation

```bash
npm install vimcord discord.js
# or
pnpm add vimcord discord.js
# or
yarn add vimcord discord.js
```

## 🛠 Quick Start

Vimcord uses a `createClient` factory to initialize a pre-configured environment with optional feature flags.

```ts
import { ActivityType, ClientOptions, GatewayIntentBits } from "discord.js";
import { createClient, GatewayIntentBits, MongoDatabase, StatusType } from "vimcord";

const client = createClient(
    {
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
    },
    {
        useGlobalErrorHandlers: true,
        useDefaultSlashCommandHandler: true,
        useDefaultPrefixCommandHandler: true,
        useDefaultContextCommandHandler: true,

        // Automatically import the .env using dotEnv
        useEnv: true,

        // Automatically import event and command modules
        importModules: {
            events: "./events",
            slashCommands: "./commands/slash",
            prefixCommands: "./commands/prefix"
            contextCommands: "./commands/context"
        }
    }
);

client.start(async client => {
    // NOTE: This runs *BEFORE* the client logs in

    // Use Mongo as our database
    await client.useDatabase(new MongoDatabase(client));
})
```

## 🛠 Features

- **CommandManager**: Advanced managers for **Slash**, **Prefix**, and **Context** commands. Includes deep inference for permissions and automated error boundaries.
- **DatabaseManager**: Seamless **MongoDB/Mongoose** integration via `createMongoSchema` and `useMongoDatabase`.
- **DiscordTools**: High-level interaction helpers including the **Paginator**, **Prompt**, and **BetterModal** for stateful UI.
- **DiscordUtils**: Essential Discord-first utilities like `dynaSend`, `fetchMember`, and `isMentionOrSnowflake`.
- **Logger**: A fun, retro style console logger for clear, actionable terminal output.

## 💎 Useful Utilities

### **The BetterEmbed & ACF**

Stop writing boilerplate for user mentions and avatars. `BetterEmbed` supports **Shorthand Context Formatting (ACF)**, allowing you to use tokens like `$USER` and `$BOT_AVATAR` directly in strings. Vimcord resolves them at runtime.

### **The Paginator (Chapters & Nested Pages)**

Multi-page embeds shouldn't be a chore. The `Paginator` supports **Chapters**, enabling complex, nested page structures with built-in navigation logic and select menu support.

### **The DynaSend: Smart Dispatch**

`DynaSend` is an intelligent message delivery system. It automatically detects the interaction state to decide whether to `.reply()`, `.editReply()`, or `.followUp()`. You write one line and Vimcord handles the logic.

### **MongoSchemaBuilder: Resilient DB Ops**

The `execute` method on your schemas includes built-in **exponential backoff**. If the database is under load or reconnecting, Vimcord retries the operation instead of crashing your command.

## 👀 Mentionables

- **Strictly Typed**: Full TypeScript support with deep inference for command permissions, events, and database documents.
- **Feature-Rich**: Includes a built-in CLI, automated status rotation, and sophisticated error boundaries.
- **Developer-Centric**: Focused on performance and ergonomics.

## 👋 About

_Vimcord was created by **xsqu1znt**,_ and designed for developers who value performance and aesthetic code.

It also takes advantage of my lightweight library [qznt](https://github.com/xsqu1znt/qznt) for a smooth experience.

## **_Vimcord is still a work in progress. If you find any bugs, please let me know._**

License: MIT
