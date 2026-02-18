# Vimcord Technical HOWTO

> A comprehensive technical guide for AI agents building Discord bots with Vimcord.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Project Scaffolding](#project-scaffolding)
3. [Core Concepts](#core-concepts)
4. [Command Builders](#command-builders)
5. [Event System](#event-system)
6. [Database Integration](#database-integration)
7. [UI Components](#ui-components)
8. [Error Handling](#error-handling)
9. [Configuration Patterns](#configuration-patterns)
10. [Best Practices](#best-practices)

---

## Architecture Overview

Vimcord is an opinionated Discord.js framework built on these architectural pillars:

### Core Philosophy

- **Builder Pattern**: All Discord entities use fluent builder APIs
- **Configuration Merging**: Layered config (global → type-specific → local) with deep merging
- **Automatic Error Boundaries**: Commands wrap in try/catch with automatic user feedback
- **Type Safety**: Full TypeScript inference with zero `any` usage

### Module Structure

```
Vimcord
├── Client (extends discord.js Client)
│   ├── EventManager - Event handler registry
│   ├── CommandManager - Command registry (slash/prefix/context)
│   ├── StatusManager - Bot presence rotation
│   └── DatabaseManager - Database abstraction
│
├── Builders (instantiable classes)
│   ├── SlashCommandBuilder
│   ├── PrefixCommandBuilder
│   ├── ContextCommandBuilder
│   └── EventBuilder
│
├── Tools (UI/UX helpers)
│   ├── BetterEmbed - Auto-formatting embeds
│   ├── Paginator - Multi-page navigation
│   ├── Prompt - Confirmation dialogs
│   ├── BetterModal - Modal V2 components
│   └── DynaSend - Universal send method
│
└── Database (MongoDB abstraction)
    ├── MongoDatabase - Connection manager
    └── MongoSchemaBuilder - CRUD + plugins
```

### Configuration Hierarchy

Vimcord merges configuration in this priority order (later overrides earlier):

```typescript
1. Framework defaults (embedded in Vimcord)
2. Global client config (passed to createClient)
3. Type-specific config (slashCommands/prefixCommands/contextCommands)
4. Local command options (individual command config)
```

---

## Project Scaffolding

### Minimum Project Structure

```
my-bot/
├── src/
│   ├── index.ts              # Entry point
│   ├── client.ts             # Client factory
│   ├── commands/
│   │   ├── slash/            # Slash commands (*.slash.ts)
│   │   ├── prefix/           # Prefix commands (*.prefix.ts)
│   │   └── context/          # Context menu commands (*.ctx.ts)
│   ├── events/               # Event handlers (*.event.ts)
│   ├── schemas/              # MongoDB schemas (*.schema.ts)
│   └── utils/                # Shared utilities
├── .env                      # Environment variables
├── .env.example              # Environment template
├── package.json
├── tsconfig.json
└── README.md
```

### Essential Configuration Files

**tsconfig.json** (Required settings):

```json
{
    "compilerOptions": {
        "target": "ES2022",
        "module": "NodeNext",
        "moduleResolution": "NodeNext",
        "esModuleInterop": true,
        "strict": true,
        "noImplicitAny": true,
        "strictNullChecks": true,
        "skipLibCheck": true,
        "outDir": "./dist",
        "rootDir": "./src",
        "baseUrl": ".",
        "paths": {
            "@/*": ["./src/*"]
        }
    },
    "include": ["src/**/*"]
}
```

**.env.example**:

```bash
# Discord Bot Tokens
TOKEN=your_production_bot_token
TOKEN_DEV=your_development_bot_token

# MongoDB (optional)
MONGO_URI=mongodb://localhost:27017/discord-bot
MONGO_URI_DEV=mongodb://localhost:27017/discord-bot-dev
```

### Package Dependencies

```json
{
    "dependencies": {
        "vimcord": "^1.0.38",
        "discord.js": "^14.25.1"
    },
    "devDependencies": {
        "@types/node": "^22.19.11",
        "typescript": "^5.9.3"
    },
    "optionalDependencies": {
        "mongoose": "^8.23.0"
    }
}
```

### Entry Point Pattern

**src/client.ts**:

```typescript
import { GatewayIntentBits } from "discord.js";
import { createClient, Vimcord } from "vimcord";

export function createBot(): Vimcord {
    return createClient(
        {
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildMembers
            ]
        },
        {
            // Feature flags
            useDefaultSlashCommandHandler: true,
            useDefaultContextCommandHandler: true,
            useDefaultPrefixCommandHandler: true,
            useGlobalErrorHandlers: true,
            maxLoginAttempts: 3,

            // Auto-import modules
            importModules: {
                events: "./events",
                slashCommands: "./commands/slash",
                prefixCommands: "./commands/prefix",
                contextCommands: "./commands/context"
            }
        }
    );
}
```

**src/index.ts**:

```typescript
import { createBot } from "./client";
import { MongoDatabase } from "vimcord";

async function main() {
    const client = createBot();

    // Load environment variables
    client.useEnv();

    // Configure app settings
    client.configure("app", {
        name: "MyBot",
        verbose: process.argv.includes("--verbose")
    });

    // Connect to database (optional)
    if (process.env.MONGO_URI) {
        await client.useDatabase(new MongoDatabase(client));
    }

    // Start the bot
    await client.start();
}

main().catch(console.error);
```

---

## Core Concepts

### The Client Instance

Vimcord extends discord.js Client with these additions:

```typescript
// Access via client property
client.$name; // Bot name (get/set)
client.$version; // Bot version (get/set)
client.$devMode; // Development mode flag (get/set)
client.$verboseMode; // Verbose logging flag (get/set)

// Managers
client.events; // EventManager
client.commands; // CommandManager (slash/prefix/context)
client.status; // StatusManager
client.db; // DatabaseManager (after useDatabase)
client.logger; // Logger instance
client.error; // ErrorHandler

// Utilities
client.fetchUser(id); // Cached user fetch
client.fetchGuild(id); // Cached guild fetch
```

### Module Importing System

Vimcord automatically imports modules using file suffixes:

| Module Type      | Default Suffix | Example Filename |
| ---------------- | -------------- | ---------------- |
| Slash Commands   | `.slash`       | `ping.slash.ts`  |
| Prefix Commands  | `.prefix`      | `help.prefix.ts` |
| Context Commands | `.ctx`         | `avatar.ctx.ts`  |
| Events           | `.event`       | `ready.event.ts` |

**Custom Suffix Configuration**:

```typescript
createClient({...}, {
    importModules: {
        slashCommands: {
            dir: "./commands",
            suffix: ".cmd",        // Custom suffix
            recursive: true         // Include subdirectories
        }
    }
})
```

---

## Command Builders

### Slash Commands

**Basic Structure**:

```typescript
import { SlashCommandBuilder } from "vimcord";
import { PermissionFlagsBits } from "discord.js";

export default new SlashCommandBuilder({
    // Discord.js builder instance
    builder: new SlashCommandBuilder().setName("ping").setDescription("Check bot latency"),

    // Optional: Auto-defer reply
    deferReply: true,
    // Or with options: deferReply: { ephemeral: true }

    // Execution logic
    execute: async (client, interaction) => {
        const latency = client.ws.ping;
        await interaction.reply(`Pong! Latency: ${latency}ms`);
    }
});
```

**With Subcommand Routing**:

```typescript
import { SlashCommandBuilder } from "vimcord";
import { SlashCommandBuilder as DJSSlashCommandBuilder, PermissionFlagsBits } from "discord.js";

export default new SlashCommandBuilder({
    builder: new DJSSlashCommandBuilder()
        .setName("moderation")
        .setDescription("Server moderation tools.")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addSubcommand(sub =>
            sub
                .setName("ban")
                .setDescription("Ban a user.")
                .addUserOption(opt => opt.setName("user").setDescription("User to ban").setRequired(true))
                .addStringOption(opt => opt.setName("reason").setDescription("Ban reason"))
        )
        .addSubcommand(sub =>
            sub
                .setName("kick")
                .setDescription("Kick a user.")
                .addUserOption(opt => opt.setName("user").setDescription("User to kick").setRequired(true))
        ),

    // Route subcommands to separate handlers
    routes: [
        {
            name: "ban",
            handler: async (client, interaction) => {
                const user = interaction.options.getUser("user", true);
                const reason = interaction.options.getString("reason") ?? "No reason";
                // Ban logic...
            }
        },
        {
            name: "kick",
            handler: async (client, interaction) => {
                const user = interaction.options.getUser("user", true);
                // Kick logic...
            }
        }
    ]
});
```

### Prefix Commands

**Basic Structure**:

```typescript
import { PrefixCommandBuilder } from "vimcord";

export default new PrefixCommandBuilder({
    name: "ping",
    aliases: ["p", "latency"],
    description: "Check bot latency.",

    execute: async (client, message, args) => {
        const latency = client.ws.ping;
        await message.reply(`Pong! Latency: ${latency}ms`);
    }
});
```

### Context Menu Commands

```typescript
import { ContextCommandBuilder } from "vimcord";
import { ContextMenuCommandBuilder, ApplicationCommandType } from "discord.js";

export default new ContextCommandBuilder({
    builder: new ContextMenuCommandBuilder().setName("Get Avatar").setType(ApplicationCommandType.User),

    execute: async (client, interaction) => {
        const targetUser = interaction.targetUser;
        await interaction.reply({
            content: targetUser.displayAvatarURL({ size: 1024 }),
            flags: "Ephemeral"
        });
    }
});
```

### Command Configuration

**Permissions**:

```typescript
new SlashCommandBuilder({
    builder: {...},
    permissions: {
        user: [PermissionFlagsBits.ManageMessages],      // User perms
        bot: [PermissionFlagsBits.ManageMessages],       // Bot perms
        roles: ["123456789"],                            // Allowed role IDs
        userWhitelist: ["123456789"],                    // Only these users
        userBlacklist: ["987654321"],                    // Block these users
        roleBlacklist: ["111222333"],                    // Block these roles
        guildOnly: true,                                 // No DMs
        guildOwnerOnly: false,                           // Only server owner
        botOwnerOnly: false,                             // Only bot owner
        botStaffOnly: false                              // Bot staff/owner only
    },
    // ...
});
```

**Rate Limiting**:

```typescript
import { RateLimitScope } from "vimcord";

new SlashCommandBuilder({
    builder: {...},
    rateLimit: {
        max: 3,                    // Max uses
        interval: 60_000,          // Per 60 seconds
        scope: RateLimitScope.User // Per user (User/Guild/Channel/Global)
    },
    onRateLimit: async (client, interaction) => {
        await interaction.reply({
            content: "Please slow down!",
            flags: "Ephemeral"
        });
    }
});
```

**Deployment Options**:

```typescript
new SlashCommandBuilder({
    builder: {...},
    deployment: {
        global: true,              // Deploy globally
        guilds: ["guild_id_1"],    // Or specific guilds
        environments: ["production"] // dev/prod only
    }
});
```

**Lifecycle Hooks**:

```typescript
new SlashCommandBuilder({
    builder: {...},
    beforeExecute: async (client, interaction) => {
        console.log("Command starting...");
    },
    execute: async (client, interaction) => {
        // Main logic
    },
    afterExecute: async (result, client, interaction) => {
        console.log("Command finished:", result);
    },
    onError: async (error, client, interaction) => {
        console.error("Command failed:", error);
    }
});
```

---

## Event System

### Event Builder Pattern

```typescript
import { EventBuilder } from "vimcord";
import { Events } from "discord.js";

export default new EventBuilder({
    event: Events.MessageCreate,
    name: "AutoMod", // Optional identifier
    enabled: true,
    once: false, // Run once or continuously
    priority: 0, // Execution order (higher = first)

    // Conditions that must all pass
    conditions: [async message => !message.author.bot, async message => message.guild !== null],

    // Rate limiting
    rateLimit: {
        max: 5,
        interval: 10_000
    },

    execute: async (client, message) => {
        // Event logic
    },

    onError: async (error, client, message) => {
        console.error("Event error:", error);
    }
});
```

### Event Priorities

Events execute by priority (highest first). Use for ordering dependencies:

```typescript
new EventBuilder({
    event: Events.GuildMemberAdd,
    name: "Logging",
    priority: 100, // Runs first
    execute: async (client, member) => {
        await logMemberJoin(member);
    }
});

new EventBuilder({
    event: Events.GuildMemberAdd,
    name: "WelcomeMessage",
    priority: 50, // Runs second
    execute: async (client, member) => {
        await sendWelcome(member);
    }
});
```

---

## Database Integration

### MongoDB Setup

**1. Initialize Connection**:

```typescript
import { createBot } from "./client";
import { MongoDatabase } from "vimcord";

const client = createBot();

client.start(async () => {
    await client.useDatabase(new MongoDatabase(client));
});
```

**2. Define Schemas** (`src/schemas/user.schema.ts`):

```typescript
import { createMongoSchema, createMongoPlugin } from "vimcord";

// Define schema
export const UserSchema = createMongoSchema("Users", {
    userId: { type: String, required: true, unique: true },
    username: String,
    balance: { type: Number, default: 0 },
    experience: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Create a plugin (reusable logic)
export const SoftDeletePlugin = createMongoPlugin(builder => {
    builder.schema.add({
        deletedAt: { type: Date, default: null }
    });

    builder.extend({
        async softDelete(filter: any) {
            return this.update(filter, { deletedAt: new Date() });
        }
    });
});

// Apply plugin to schema
UserSchema.use(SoftDeletePlugin);
```

**3. CRUD Operations**:

```typescript
import { UserSchema } from "../schemas/user.schema";

// Create
const newUser = await UserSchema.create([
    {
        userId: "123456",
        username: "JohnDoe",
        balance: 100
    }
]);

// Read
const user = await UserSchema.fetch({ userId: "123456" });
const users = await UserSchema.fetchAll({ balance: { $gt: 0 } });

// Update
await UserSchema.upsert({ userId: "123456" }, { $inc: { balance: 50 } });

// Delete
await UserSchema.delete({ userId: "123456" });

// Transactions
await UserSchema.useTransaction(async (session, model) => {
    await model.updateOne({ userId: "123" }, { $inc: { balance: -100 } }, { session });
    await model.updateOne({ userId: "456" }, { $inc: { balance: 100 } }, { session });
});
```

### Schema Extension

Add custom methods to schemas:

```typescript
UserSchema.extend({
    async getLeaderboard(limit: number = 10) {
        return this.aggregate([{ $sort: { experience: -1 } }, { $limit: limit }]);
    },

    async addExperience(userId: string, amount: number) {
        return this.upsert({ userId }, { $inc: { experience: amount }, $set: { updatedAt: new Date() } });
    }
});

// Usage
const topUsers = await UserSchema.getLeaderboard(5);
```

---

## UI Components

### BetterEmbed

**Auto Context Formatting (ACF)**:

```typescript
import { BetterEmbed } from "vimcord";

const embed = new BetterEmbed({
    context: { interaction }, // Enables ACF
    title: "Welcome, $USER!",
    description: ["Your avatar: $USER_AVATAR", "Server: $DISPLAY_NAME", "Today: $MONTH/$DAY/$YEAR"],
    color: "#5865F2"
});

await embed.send(interaction);
```

**Available ACF Tokens**:

- `$USER` - User mention
- `$USER_NAME` - Username
- `$DISPLAY_NAME` - Server nickname
- `$USER_AVATAR` - User avatar URL
- `$BOT_AVATAR` - Bot avatar URL
- `$YEAR/$MONTH/$DAY` - Date (2-digit month/day)
- `$year/$month/$day` - Short date format
- `$INVIS` - Invisible character (zero-width space)

**Escape ACF**: Use backslash: `\$USER`

### Paginator

```typescript
import { Paginator, PaginationType } from "vimcord";
import { BetterEmbed } from "vimcord";

const paginator = new Paginator({
    type: PaginationType.LongJump, // first | back | jump | next | last
    timeout: 120_000, // 2 minutes
    onTimeout: 1 // 0=disable, 1=clear, 2=delete, 3=nothing
});

// Add chapters (grouped pages)
paginator.addChapter(
    [
        new BetterEmbed({ title: "Help Page 1", description: "..." }),
        new BetterEmbed({ title: "Help Page 2", description: "..." })
    ],
    { label: "General Help", emoji: "📖" }
);

paginator.addChapter([new BetterEmbed({ title: "Mod Page 1", description: "..." })], { label: "Moderation", emoji: "🛡️" });

// Send and get message
const message = await paginator.send(interaction);

// Events
paginator.on("pageChange", (page, index) => {
    console.log(`Chapter ${index.chapter}, Page ${index.nested}`);
});
```

### Prompt

```typescript
import { Prompt } from "vimcord";

const prompt = new Prompt({
    embed: new BetterEmbed({
        context: { interaction },
        title: "Delete this message?",
        description: "This action cannot be undone."
    }),
    timeout: 30_000,
    onResolve: [PromptResolveType.DisableComponents, PromptResolveType.DeleteOnConfirm] // Clear components on confirm, delete on reject
});

await prompt.send(interaction);
const result = await prompt.awaitResponse();

if (result.confirmed) {
    await message.delete();
}
```

### BetterModal

```typescript
import { BetterModal } from "vimcord";
import { TextInputStyle } from "discord.js";

const modal = new BetterModal({
    title: "Create Ticket",
    components: [
        {
            textInput: {
                label: "Subject",
                custom_id: "subject",
                style: TextInputStyle.Short,
                required: true,
                max_length: 100
            }
        },
        {
            textInput: {
                label: "Description",
                custom_id: "description",
                style: TextInputStyle.Paragraph,
                max_length: 1000
            }
        }
    ]
});

// Show and await in one call
const result = await modal.showAndAwait(interaction, {
    timeout: 60_000,
    autoDefer: true // Close modal after submission
});

if (result) {
    const subject = result.getField("subject", true);
    const description = result.getField("description");

    await result.reply({
        content: `Ticket created: ${subject}`,
        flags: "Ephemeral"
    });
}
```

### DynaSend

Universal send method that works with any Discord object:

```typescript
import { dynaSend } from "vimcord";

// Works with: interactions, channels, messages, users
await dynaSend(interaction, {
    content: "Hello!",
    embeds: [myEmbed],
    components: [actionRow],
    files: [attachment],
    flags: "Ephemeral"
});
```

Auto-detects the correct method:

- Interactions → reply/editReply/followUp
- Channels → channel.send()
- Messages → message.reply() / message.edit()
- Users → user.send()

---

## Error Handling

### Command Error Handling

Vimcord automatically handles command errors with user-friendly embeds:

```typescript
// Errors are caught and displayed to users automatically
// Configure the error message globally:
client.configure("app", {
    // Uses default error embed
});

// Or handle specific cases:
new SlashCommandBuilder({
    builder: {...},
    execute: async (client, interaction) => {
        try {
            // Risky operation
        } catch (err) {
            // Throw to trigger Vimcord's error handling
            throw new Error("Custom error message");
        }
    },
    onError: async (error, client, interaction) => {
        // Handle error locally (re-throw for global handling)
        await interaction.reply({ content: "Custom error handling", flags: "Ephemeral" });
        throw error;
    }
});
```

### Global Error Handlers

```typescript
createClient({...}, {
    useGlobalErrorHandlers: true  // Catches uncaught exceptions
});

// Or manual setup:
process.on("unhandledRejection", error => {
    client.logger.error("Unhandled rejection", error as Error);
});
```

### Logger

```typescript
import { Logger } from "vimcord";

const logger = new Logger({
    prefix: "Economy",
    prefixEmoji: "💰",
    colors: { primary: "#57F287" },
    minLevel: 1 // 0=debug, 1=info, 2=success, 3=warn, 4=error
});

logger.info("Processing transaction...");
logger.success("Transaction complete!");
logger.warn("Low balance detected");
logger.error("Transaction failed", error);

// Loader for async operations
const stopLoader = logger.loader("Connecting to database...");
await connectToDB();
stopLoader("Connected successfully!");

// Table output
logger.table("Stats", {
    users: 150,
    revenue: "$420.69"
});
```

---

## Configuration Patterns

### App Configuration

```typescript
client.configure("app", {
    name: "MyBot",
    version: "1.0.0",
    devMode: false, // Uses TOKEN_DEV, MONGO_URI_DEV
    verbose: false, // Extra logging
    enableCLI: false, // Interactive CLI
    disableBanner: false // Hide ASCII banner
});
```

### Staff Configuration

```typescript
client.configure("staff", {
    ownerId: "123456789",
    staffRoleIds: ["111222333"]
});
```

### Command Type Configuration

Global defaults for all commands of a type:

```typescript
client.configure("slashCommands", {
    enabled: true,
    logExecution: true,
    permissions: {
        bot: [PermissionFlagsBits.SendMessages]
    }
});
```

---

## Best Practices

### Code Style

**Import Order**:

```typescript
// 1. Node built-ins
import { randomUUID } from "node:crypto";

// 2. Third-party packages
import { PermissionFlagsBits } from "discord.js";
import { SlashCommandBuilder } from "vimcord";

// 3. Local modules
import { UserSchema } from "@/schemas/user.schema";
```

**Function Signatures**: Always use explicit return types

```typescript
// Good
async function getUserData(userId: string): Promise<UserData | null> {
    return await UserSchema.fetch({ userId });
}

// Bad (relying on inference)
async function getUserData(userId: string) {
    return await UserSchema.fetch({ userId });
}
```

### Security

**Never hardcode tokens**:

```typescript
// ❌ BAD
const token = "abc123...";

// ✅ GOOD
const token = process.env.TOKEN;
```

**Validate permissions before operations**:

```typescript
execute: async (client, interaction) => {
    const member = interaction.member as GuildMember;

    if (!member.permissions.has(PermissionFlagsBits.BanMembers)) {
        return await interaction.reply({
            content: "Missing permission: Ban Members",
            flags: "Ephemeral"
        });
    }

    // Proceed with ban...
};
```

### Performance

**Use caching for frequently accessed data**:

```typescript
// Cache expensive operations
const cache = new Map<string, any>();

async function getCachedData(key: string) {
    if (cache.has(key)) return cache.get(key);
    const data = await expensiveOperation(key);
    cache.set(key, data);
    return data;
}
```

**Database: Use lean queries for read-only operations**:

```typescript
// Fast - returns plain objects
const users = await UserSchema.fetchAll({}, null, { lean: true });

// Slower - returns Mongoose documents with full functionality
const users = await UserSchema.fetchAll();
```

### Type Safety

**Never use `any`**: Use `unknown` with type guards

```typescript
// ❌ BAD
function process(data: any) {
    return data.value;
}

// ✅ GOOD
function process(data: unknown) {
    if (typeof data === "object" && data !== null && "value" in data) {
        return (data as { value: string }).value;
    }
    return null;
}
```

**Use `satisfies` for shape validation**:

```typescript
const config = {
    name: "MyBot",
    version: "1.0.0"
} satisfies { name: string; version: string };
```

### Error Handling

**Wrap all async operations**:

```typescript
execute: async (client, interaction) => {
    try {
        await riskyOperation();
    } catch (err) {
        client.logger.error("Operation failed", err as Error);
        await interaction.reply({
            content: "An error occurred",
            flags: "Ephemeral"
        });
    }
};
```

**Use discriminated unions for state**:

```typescript
type CommandState = { status: "loading" } | { status: "success"; data: any } | { status: "error"; error: Error };

// Better than: { isLoading: boolean; error?: Error; data?: any }
```

### Module Structure

**One command per file**:

```typescript
// commands/slash/ping.slash.ts
import { SlashCommandBuilder } from "vimcord";

export default new SlashCommandBuilder({...});
```

**Extract shared logic into utilities**:

```typescript
// utils/permissions.ts
export async function checkModPermissions(member: GuildMember): Promise<boolean> {
    return member.permissions.has([PermissionFlagsBits.ManageMessages, PermissionFlagsBits.KickMembers]);
}

// Use in multiple commands
import { checkModPermissions } from "@/utils/permissions";
```

### Database Patterns

**Use transactions for related operations**:

```typescript
await UserSchema.useTransaction(async (session, model) => {
    await model.updateOne({ userId: sender }, { $inc: { balance: -amount } }, { session });
    await model.updateOne({ userId: receiver }, { $inc: { balance: amount } }, { session });
});
```

**Index frequently queried fields**:

```typescript
export const UserSchema = createMongoSchema("Users", {
    userId: { type: String, required: true, unique: true, index: true },
    username: { type: String, index: true }
});
```

---

## Common Patterns

### Help Command with Categories

```typescript
import { SlashCommandBuilder, Paginator, PaginationType } from "vimcord";
import { SlashCommandBuilder as DJSSlashCommandBuilder } from "discord.js";

export default new SlashCommandBuilder({
    builder: new DJSSlashCommandBuilder().setName("help").setDescription("View all commands"),

    execute: async (client, interaction) => {
        const categories = client.commands.slash.sortByCategory();

        const paginator = new Paginator({
            type: PaginationType.Short
        });

        for (const category of categories) {
            const embed = new BetterEmbed({
                context: { interaction },
                title: `${category.emoji || "📋"} ${category.name}`,
                description: category.commands
                    .map(cmd => {
                        const name = cmd.builder.name;
                        const desc = cmd.builder.description;
                        return `**/${name}** - ${desc}`;
                    })
                    .join("\n")
            });

            paginator.addChapter([embed], {
                label: category.name,
                emoji: category.emoji
            });
        }

        await paginator.send(interaction);
    }
});
```

### Guild-Only Command with Database

```typescript
import { SlashCommandBuilder } from "vimcord";
import { GuildConfigSchema } from "@/schemas/guild.schema";

export default new SlashCommandBuilder({
    builder: new DJSSlashCommandBuilder()
        .setName("setprefix")
        .setDescription("Change server prefix")
        .addStringOption(opt => opt.setName("prefix").setDescription("New prefix").setRequired(true).setMaxLength(5)),

    permissions: {
        user: [PermissionFlagsBits.ManageGuild],
        guildOnly: true
    },

    execute: async (client, interaction) => {
        const prefix = interaction.options.getString("prefix", true);
        const guildId = interaction.guildId;

        await GuildConfigSchema.upsert({ guildId }, { $set: { prefix, updatedAt: new Date() } });

        await interaction.reply({
            content: `Prefix updated to: ${prefix}`,
            flags: "Ephemeral"
        });
    }
});
```

### Confirmation Flow

```typescript
import { SlashCommandBuilder, Prompt, BetterEmbed } from "vimcord";

export default new SlashCommandBuilder({
    builder: new DJSSlashCommandBuilder().setName("purge").setDescription("Delete messages"),

    permissions: {
        user: [PermissionFlagsBits.ManageMessages],
        bot: [PermissionFlagsBits.ManageMessages]
    },

    execute: async (client, interaction) => {
        const prompt = new Prompt({
            embed: new BetterEmbed({
                context: { interaction },
                title: "⚠️ Warning",
                description: "This will delete 100 messages. Continue?",
                color: "#FEE75C"
            }),
            timeout: 30_000
        });

        await prompt.send(interaction);
        const result = await prompt.awaitResponse();

        if (result.confirmed) {
            await interaction.channel?.bulkDelete(100);
        }
    }
});
```

---

## Debugging

### Enable Verbose Mode

```bash
node dist/index.js --verbose
# or
client.configure("app", { verbose: true });
```

### Use the Logger

```typescript
client.logger.debug("Debug info");
client.logger.table("State", { key: "value" });

// Custom logger per module
const modLogger = new Logger({
    prefix: "Moderation",
    prefixEmoji: "🛡️"
});
```

### Check Client State

```typescript
console.log(client.toJSON());
// Shows: { options, features, config }
```

---

## Migration Guide

### From Raw Discord.js

**Before**:

```typescript
client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "ping") {
        await interaction.reply("Pong!");
    }
});
```

**After**:

```typescript
export default new SlashCommandBuilder({
    builder: new SlashCommandBuilder().setName("ping").setDescription("Ping command"),
    execute: async (client, interaction) => {
        await interaction.reply("Pong!");
    }
});
```

### Adding Vimcord to Existing Project

1. Install Vimcord alongside existing discord.js
2. Keep existing event handlers, migrate incrementally
3. Use Vimcord tools (BetterEmbed, Paginator) with existing code
4. Gradually replace command handlers with builders

---

## Environment Reference

| Variable        | Required | Description                                       |
| --------------- | -------- | ------------------------------------------------- |
| `TOKEN`         | Yes      | Production bot token                              |
| `TOKEN_DEV`     | No       | Development bot token (used when `devMode: true`) |
| `MONGO_URI`     | No       | Production MongoDB URI                            |
| `MONGO_URI_DEV` | No       | Development MongoDB URI                           |

---

## Quick Reference

### Import Map

```typescript
// Core
import { createClient, Vimcord } from "vimcord";

// Builders
import { SlashCommandBuilder, PrefixCommandBuilder, ContextCommandBuilder, EventBuilder } from "vimcord";

// Tools
import { BetterEmbed, Paginator, Prompt, BetterModal, Logger, dynaSend } from "vimcord";

// Database
import { MongoDatabase, createMongoSchema, createMongoPlugin } from "vimcord";

// Types
import { RateLimitScope, MissingPermissionReason, CommandType } from "vimcord";
```

### Common Types

```typescript
// Rate limiting scopes
RateLimitScope.User; // Per user
RateLimitScope.Guild; // Per guild
RateLimitScope.Channel; // Per channel
RateLimitScope.Global; // Across all users

// Pagination types
PaginationType.Short; // back, next
PaginationType.ShortJump; // back, jump, next
PaginationType.Long; // first, back, next, last
PaginationType.LongJump; // first, back, jump, next, last

// Prompt resolve types
PromptResolveType.DisableComponents; // Disable buttons after response
PromptResolveType.ClearComponents; // Remove buttons after response
PromptResolveType.DeleteOnConfirm; // Delete message on confirm
PromptResolveType.DeleteOnReject; // Delete message on reject
```

---

_End of HOWTO.md_
