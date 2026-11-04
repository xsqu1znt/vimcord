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

**Vimcord** wraps Discord.js with a focused module layer, typed command contexts, shared permission checks, hooks, and UX helpers for embeds, prompts, modals, components, and pagination.

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
    intents: [GatewayIntentBits.Guilds]
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
    intents: [GatewayIntentBits.Guilds]
});
```

The client participates by default once the process CLI is initialized. Set `enableCLI: false` to disable CLI commands for it. Enter `/help` in the process console to view commands.

### Modules And Command Dispatch

Everything is set in the constructor, and `login()` does the rest. Discord.js client options sit at the top level.

```ts
import { GatewayIntentBits } from "discord.js";
import { Vimcord } from "vimcord";
import { DotEnvPlugin } from "@vimcord/plugin-dotenv";

const client = new Vimcord({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    name: "My Bot",
    verbose: true,
    staff: {
        ownerId: "123456789012345678",
        superUsers: ["234567890123456789"]
    },
    plugins: [new DotEnvPlugin()],
    modules: {
        slashCommands: { dir: "./commands/slash", suffix: ".slash" },
        prefixCommands: { dir: "./commands/prefix", suffix: ".prefix" },
        events: { dir: "./events", suffix: ".event" }
    },
    prefix: "!"
});

// Plugins -> plugin lifecycle step -> modules -> listeners -> gateway -> command sync
await client.login();
```

`dir` is relative to the entry file. `suffix` is required: a suffix or list imports the files ending in it and skips the rest, so helper files can sit alongside modules; `null` imports every file in the folder.

Boot fails with the file or folder named when a configured directory is missing or has no matches, a file fails to import, or a matched file's default export isn't that entry's module type. A failure while logging in unloads the plugins and modules it set up.

`prefix` also takes a function, sync or async, that runs once per message. Return the prefixes to accept, or `null` to ignore the message. Set `allowMention: true` to accept a bot mention as a prefix.

`login()` syncs global commands after ready. A sync failure is logged and leaves the bot running. Pass `syncCommands: false` to opt out and call `client.modules.commands.push()` yourself. Guild-registered commands aren't part of this sync. `client.destroy()` removes the command listeners.

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

    subcommands: {
        ban: {
            deferReply: "ephemeral",
            async handler({ interaction }) {
                await interaction.editReply("Ban flow started.");
            }
        },
        "mod:kick": {
            async handler({ interaction }) {
                await interaction.reply("Kick flow started.");
            }
        }
    },

    botPermissions: [PermissionFlagsBits.BanMembers]
});
```

`subcommands` keys are the subcommand name, or `group:name` inside a group, and are fixed when the module is constructed. The command's restrictions run first. A matched subcommand then runs its own restrictions before its handler. Both levels must pass, and failures reach `onBlocked` with the same command context.

When `execute` and `subcommands` are both present, a matched subcommand uses its handler. An invocation without a subcommand uses `execute`. If the interaction names a subcommand with no entry, Vimcord blocks with `unknownRoute`, which goes to `onBlocked` or a default ephemeral response. A command with no `subcommands` sends every invocation to `execute`, including builder subcommands. Commands without `execute` must cover every subcommand declared by the builder.

`deferReply` is `boolean | "ephemeral"`. On a subcommand it overrides the command setting. Omitting it inherits the command setting. Setting it to `false` disables deferral for that subcommand.

Use `singleInvocation: true` to skip a second invocation from the same user while this module is still running. Slash subcommands share that module and user key. For a custom scope, return a key from `singleInvocation.key`. The guard acquires after `before` and releases when the handler finishes or throws. A skipped invocation does not count as executed and only reaches `onBlocked` with `kind: "running"`; it is silent unless you send a response. This in-memory guard coordinates one process only.

```ts
export default new SlashCommandModule({
    builder,
    singleInvocation: true,
    hooks: {
        async onBlocked({ interaction }, block) {
            if (block.kind !== "running") return;
            await interaction.reply({ content: "That command is already running.", flags: "Ephemeral" });
        }
    },
    async execute({ interaction }) {
        await runJob(interaction.user.id);
    }
});
```

### Command Permissions

```ts
guildOnly: true,                  // must pass; also narrows ctx.message or ctx.interaction to the guild form
botPermissions: ["BanMembers"],   // must pass
allowBots: true,                  // lets other bots run this
access: {                         // any one grants
    permissions: ["ModerateMembers"],
    users: ["123456789012345678"],
    roles: ["234567890123456789"],
    guildOwner: true,
    botOwner: true,
    staff: true
}
```

These are flat options on a command, and subcommands take the same fields. With no `access`, anyone who passes the rest can use the command.

`guildOnly: true` narrows the handler's context on that command or subcommand, so `ctx.message.guildId` is a `string`. Hook contexts aren't narrowed, since a client's hooks run for every command.

Local permission checks return immediately; staff-role or uncached guild-owner checks may return a promise. Use `await testCommandPermissions(ctx, restrictions)` when calling the exported helper directly rather than chaining `.then()`.

### Autocomplete

Autocomplete handlers run outside the module pipeline (no permissions, no hooks), since Discord gives them 3 seconds and the interaction can't report an error.

```ts
import { SlashCommandBuilder } from "discord.js";
import { SlashCommandModule } from "vimcord";

export default new SlashCommandModule({
    builder: new SlashCommandBuilder()
        .setName("wiki")
        .setDescription("Search the wiki")
        .addStringOption(option => option.setName("query").setDescription("Search term").setAutocomplete(true)),

    async autocomplete({ focused }) {
        return ["Guide", "Getting Started", "FAQ"]
            .filter(name => name.toLowerCase().includes(focused.value.toLowerCase()))
            .map(name => ({ name, value: name }));
    },

    async execute({ interaction }) {
        await interaction.reply(`Searching for "${interaction.options.getString("query")}"...`);
    }
});
```

### Prefix Commands

```ts
import { PrefixCommandModule } from "vimcord";

export default new PrefixCommandModule({
    name: "ping",
    aliases: ["p"],
    async execute({ message, args }) {
        await message.reply(`Pong. You sent ${args.length} arg${args.length === 1 ? "" : "s"}.`);
    }
});
```

The context has `args` (raw whitespace-separated tokens), `lowerArgs` and `content`, parsed only when read. For a custom separator, use `content.split("|")`.

Prefix subcommands use a name-to-handler map. Each value has a `handler`, optional `aliases`, and optional
`description`, and takes the same `guildOnly`, `botPermissions`, `allowBots` and `access` fields as a command. Each handler receives the normal command context:

```ts
export default new PrefixCommandModule({
    name: "buy",
    subcommands: {
        frame: {
            aliases: ["f"],
            description: "Buy a frame",
            async handler({ message, args, subcommand }) {
                const [frame] = args;
                await message.reply(`Buying ${frame} via ${subcommand}`);
            }
        }
    },
    async execute({ message }) {
        await message.reply("Usage: buy frame <name>");
    }
});
```

Names and aliases match the first whitespace-separated argument case-insensitively. For `!buy F Red`,
`ctx.subcommand` is `"frame"`, `content` is `"Red"`, and `args` is `["Red"]`. The original
Discord `message` is unchanged. The public `module.subcommands` map contains canonical lowercase names and their
handler/alias/description configuration, so help commands can enumerate them without listing aliases twice.
Ambiguous names or aliases are rejected during construction.

No token or an unknown token invokes the parent's `execute` with the original arguments and `subcommand: null`.
`execute` is optional when subcommands exist; without it, unmatched invocations block with `unknownRoute`, which goes to `onBlocked` and otherwise does nothing. `before` and hooks run once for the parent, with the selected subcommand and remaining content already available. `singleInvocation` keeps its existing scope.

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

### Command Hooks

Set a client's hooks in the constructor, per command type, and a module's in its own `hooks` option.

```ts
const client = new Vimcord({
    intents: [GatewayIntentBits.Guilds],
    hooks: {
        slash: {
            // Must return a boolean. Anything but true stops the command, so respond here when you do.
            async before({ user, interaction }) {
                if (!(await isBanned(user.id))) return true;
                await interaction.reply({ content: "You can't use this bot.", flags: "Ephemeral" });
                return false;
            },
            async onBlocked({ interaction }, block) {
                // block.kind: "permission" | "environment" | "running" | "unknownRoute"
                if (block.kind !== "permission") return;
                await interaction.reply({ content: `Missing access: ${block.reason}`, flags: "Ephemeral" });
            },
            async onError({ interaction, error }) {
                const content = `Something went wrong: ${error?.message ?? "Unknown error"}`;

                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content, flags: "Ephemeral" });
                    return;
                }

                await interaction.reply({ content, flags: "Ephemeral" });
            }
        }
    }
});
```

`before` composes: the client's runs first, then the module's, so a module can never skip the client's gate. `onBlocked` and `onError` on a module override the client's. Without an `onBlocked`, a block with a `reason` goes to `onError`. `ctx.module` is the running command module, including its metadata, and every command context has `ctx.user`.

Set `environment: "production"` or `"development"` on a module to run it in only that mode.

Built-in modules pass one invocation context through checks, hooks, and execution. Changes a hook makes to that context are visible to the handler. Custom `createModuleCTX`/`createHookCTX` overrides are still supported. Protected `checkInjection()` and `performTests()` can return a boolean or a promise; asynchronous overrides can use `await super.performTests(ctx)`. Omitted protected `restrictions` is `undefined`, so subclass code should use optional access.

`prepareExecute()` runs handler setup before timing starts, and `shouldMeasureExecution()` controls timing collection.

### BetterEmbed

```ts
import { BetterEmbed, defineGlobalUxConfig } from "vimcord";

defineGlobalUxConfig({
    embedColor: "#5865F2",
    embedColorDev: "#FF9D00"
});

const embed = new BetterEmbed({
    title: `Welcome, ${interaction.user.username}`,
    description: [showAvatar && `Your avatar: ${interaction.user.displayAvatarURL()}`, "", "Glad you're here."],
    timestamp: true
});

await embed.send(interaction);
```

`BetterEmbed.toJSON()` produces Discord API data directly. Color resolution, timestamps, and the 25-field limit run locally; Discord validates text lengths and URLs when sent. Invalid text or URLs therefore fail at the Discord request rather than during local builder serialization. Timestamp `0` represents the Unix epoch.

`send` returns the message for channels, messages, members and users. A fresh interaction reply returns `null` unless you pass `{ withResponse: true }`, and the types follow, so forgetting the flag before attaching a `BetterCollector` is a compile error.

`embed.followUp(interaction)` sends a follow-up, and `embed.edit(target)` edits a `Message` or an interaction's reply. `BetterContainer` has the same three methods.

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
import { ButtonBuilder, ButtonStyle } from "discord.js";
import { Paginator } from "vimcord";

// Invoker-only, 60s idle, disables on end.
const paginator = new Paginator();

paginator
    .addChapter({
        label: "General",
        emoji: "📖",
        pages: ["Help overview", "Use `/help command` for command-specific help."]
    })
    .addChapter({ label: "Moderation", emoji: "🛡️", pages: ["Ban, kick, and timeout commands."] })
    .addChapter({ label: "Users", load: () => loadUsers() })
    .addChapter({ label: "Items", pageCount: 20, page: i => loadItemPage(i) });

paginator.insertButtonAt(
    0,
    new ButtonBuilder().setCustomId("help:feedback").setLabel("Feedback").setStyle(ButtonStyle.Secondary)
);

paginator.on("paginate", ({ previous, destination, action, page }) => {
    console.log(`${action}: ${previous.chapter}.${previous.nested} -> ${destination.chapter}.${destination.nested}`);
});

// Custom component handlers receive the original interaction without an automatic acknowledgement.
paginator.onComponent("help:feedback", async buttonInteraction => {
    await buttonInteraction.reply({ content: "Thanks for your feedback!", flags: "Ephemeral" });
});

await paginator.send(interaction);
```

Options change the defaults:

```ts
new Paginator({ participants: "anyone", nav: "long", jump: true, onResolve: "clear" });
```

`participants` defaults to the invoker from the send target: `message.author` or `interaction.user`. Channel and user targets default to anyone. `nav` is `"short"` (back and next) or `"long"` (adds first and last). Timing is `idle` or `timeout`, never both, and defaults to the UX config's `defaultIdle` of 60 seconds.

Custom paginator handlers must call `showModal`, `update`, `deferUpdate`, `reply`, or otherwise acknowledge the
interaction within Discord's response window. To acknowledge a custom interaction before its handler runs, pass
`{ deferUpdate: true }` as the third argument to `paginator.onComponent()`.

Every paginator starts a collector. A one-page paginator without navigation can still collect controls supplied in the
page or send options and run `collect` and `onComponent` callbacks. Page navigation is omitted for a one-page chapter,
but chapter selection remains when the paginator has several chapters.

By default, components supplied to `send()` appear before the chapter select and built-in navigation
(`chapterSelectPosition: "afterComponents"`). Set `chapterSelectPosition: "beforeComponents"` in the constructor to
put the chapter select first. Supplied action rows keep their exact grouping and order, and built-in navigation stays
after them. The ordering also applies to navigation updates, `refresh()`, and `replaceChapters()`. The chapter select
is omitted when only one chapter remains. For Components V2 pages, this option also places the select before the page's containers.

```ts
const paginator = new Paginator({
    chapterSelectPosition: "beforeComponents"
})
    .addChapter({ label: "Overview", value: "overview", pages: ["Overview"] })
    .addChapter({ label: "Draft", value: "draft", pages: ["Draft page 1", "Draft page 2"] });

await paginator.send(message, {
    components: buttonRows,
    allowedMentions: { repliedUser: false }
});
```

#### Paginator migration

Navigation layouts and Jump are explicit. `dynamic`, `paginator.longThreshold`, `paginator.jumpableThreshold`, and
automatic Jump insertion are gone.

Paginator timeout actions now use the shared `ResolveAction` strings. Replace `PaginationTimeout.DisableComponents` with
`"disable"`, and use the same mapping for the others: `"clear"`, `"delete"` and `"keep"`.

```ts
// Before
new Paginator({ dynamic: true, type: PaginationType.LongSkip, timeout: 60_000 });

// After
new Paginator({ nav: "long", jump: true });
```

All successful navigation edits now emit one `paginate` event. Initial sends, unchanged positions, refreshes, loading
placeholders, and timeout cleanup do not emit it.

```ts
// Before
paginator.on("beforePageChange", loadPage);
paginator.on("pageChange", handlePage);
paginator.on("next", handleNext);

// After
paginator.on("paginate", ({ previous, destination, action, page }) => {
    handlePage({ previous, destination, action, page });
});
```

Paginator events and custom component IDs use separate methods. A custom ID such as `"next"` is never treated as an
event name.

```ts
// Before
paginator.on("help:feedback", handleFeedback, { deferUpdate: true });

// After
paginator.onComponent("help:feedback", handleFeedback, { deferUpdate: true });
```

Chapters accept an array of pages only. An inner array is one page with several embeds.

```ts
// Before: a single page could be passed directly
paginator.addChapter(embedA, { label: "Help" });

// After
paginator.addChapter({ label: "Two pages", pages: [embedA, embedB] });
paginator.addChapter({ label: "One multi-embed page", pages: [[embedA, embedB]] });
```

Files now belong to the page payload they accompany.

```ts
// Before
paginator.addChapter([embedA, embedB], { label: "Reports", files: [fileA, fileB] });

// After
paginator.addChapter({
    label: "Reports",
    pages: [
        { embeds: [embedA], files: [fileA] },
        { embeds: [embedB], files: [fileB] }
    ]
});
```

The public chapter record now describes its source instead of exposing parallel `pages` and `files` arrays.

```ts
// Before
const pages = paginator.chapters[0].pages;

// After
const source = paginator.chapters[0].source;
const pages = source.kind === "static" || source.kind === "chapterLoader" ? source.pages : null;
```

Loaders replace `beforeChapterChange` and `hydrateChapter`. A chapter loader is cached once per paginator. Call
`reloadChapter()` when it needs fresh data. Use `await paginator.replaceChapters([{ pages, label, value }])` to replace static chapters and re-render. Stable `value` IDs preserve the selected chapter across reordering; omitted values preserve position. Shortened chapters clamp the page, and a removed chapter returns to the first chapter/page. A page loader receives the requested zero-based page on every navigation
and declares its page count up front. When the data changes while the paginator is open, the loader can call
`setPageCount(count)` from its second argument to correct it. If the requested page no longer exists, the new last page
loads instead.

If reloading fails, the previous chapter stays available. This includes a reload that removes the current page.
The failure is logged; select an earlier page before retrying that reload.

```ts
// Before
paginator.addChapter([loadingPage], { label: "Users" });
paginator.on("beforeChapterChange", async chapter => {
    paginator.hydrateChapter(chapter, await loadUsers(), true);
});

// After: load and cache the complete chapter
paginator.addChapter({ label: "Users", load: async () => loadUsers() });
await paginator.reloadChapter();

// After: load one requested page every time
paginator.addChapter({ label: "Users", pageCount: 20, page: async page => loadUserPage(page) });
```

`onLoading` runs only for a lazy load. Return nothing to leave the current page visible. An ordinary paginator uses
ordinary content or embeds for its placeholder.

```ts
import { Paginator } from "vimcord";

const paginator = new Paginator({
    onLoading: () => ({ content: "Loading users..." })
}).addChapter({ label: "Users", pageCount: 20, page: page => loadUserPage(page) });
```

A Components V2 paginator uses containers for every page and placeholder. A paginator cannot mix ordinary pages and
Components V2 containers. Static mixtures fail before send. Invalid lazy results fail before edit.

```ts
import { BetterContainer, Paginator } from "vimcord";

const paginator = new Paginator({
    onLoading: () => ({ containers: [new BetterContainer().addText("Loading users...")] })
}).addChapter({
    label: "Users",
    pageCount: 20,
    page: async page => ({ containers: [new BetterContainer().addText(await loadUserPageText(page))] })
});
```

`insertButtonAt(index, button)` and `removeButtonAt(...indexes)` now use the same identity: the zero-based insertion
position among rendered navigation buttons.

Jump failures and stale submissions use global messages only. All three defaults are `null`, which silently calls
`deferUpdate()` when the interaction still needs acknowledgement. Set a string to send an ephemeral response.

```ts
defineGlobalUxConfig({
    paginator: {
        messages: {
            loadFailed: "That page could not be loaded.",
            expired: "This paginator has expired.",
            chapterChanged: "The chapter changed. Open Jump again."
        }
    }
});
```

### Prompt

```ts
import { BetterEmbed, promptMessage } from "vimcord";

const result = await promptMessage(interaction, {
    embed: new BetterEmbed({
        title: "Delete this message?",
        description: "This action cannot be undone."
    }),
    timeout: 30_000,
    onResolve: ({ status }) => (status === "timeout" ? "delete" : "disable")
});

if (result.status === "confirmed") {
    await targetMessage.delete();
}
```

Like a paginator, a prompt defaults to the invoker, 60 seconds idle, and disabling on end. Pass `participants: "anyone"` to open it up.

Pressing a button in `extraButtons` always ends the prompt, with `status: "custom"` and the custom ID of the button that was pressed. With the `prompt.highlightSelectedButton` UX config on, a selected extra button turns Primary.

```ts
const { status, customId } = await promptMessage(interaction, {
    content: "Buy this item?",
    extraButtons: [
        new ButtonBuilder().setCustomId("use_voucher").setLabel("Use voucher").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("use_credit").setLabel("Use credit").setStyle(ButtonStyle.Secondary)
    ]
});

if (status === "custom" && customId === "use_voucher") {
    await chargeVoucher();
}
```

`promptMessage`, `BetterCollector`, and `Paginator` accept `onResolve` as an action (`"disable"`, `"clear"`, `"delete"` or `"keep"`) or an async callback.
Return `{ action, ...messageEditOptions }` to deliver the final content, embeds, or files with component cleanup in **one edit**:

```ts
await promptMessage(message, {
    embed: new BetterEmbed({ description: "Pull for 100 petals?" }),
    onResolve: async ({ status }) => {
        if (status !== "confirmed") return "disable";
        const result = await payOutOnce();
        return {
            action: "disable",
            embeds: [new BetterEmbed({ description: result.description }).toJSON()],
            files: result.files
        };
    }
});
```

Prompt callbacks receive `{ message, status, customId }`, with status `confirmed`, `rejected`, `custom`, or `timeout`.
Collector callbacks receive `{ message, reason, collected }`; paginator callbacks receive `{ message, reason }` after pending navigation finishes.
Prompts and paginators sent through an interaction edit and delete via its webhook, including ephemeral replies and follow-ups. For a `BetterCollector` attached to an interaction response, pass `{ interaction }` in its options to enable the same cleanup.
All three default to `"disable"`, and skip the edit when the message was deleted. `BetterCollector` keeps explicit `participants`, since it only receives the bot's own message, and `retainHistory` defaults to `false`, which leaves `collected` empty.

Call `collector.resetTimer()` after a modal submission or result edit to restart a `BetterCollector`'s configured
idle or timeout window. Reset it before waiting on slow work as well, so the collector stays active until the result
is ready. An ended collector cannot be restarted.
`"disable"` and `"clear"` apply to returned components when present, otherwise to the existing message.
`"keep"` still delivers a returned payload; `"delete"` deletes and ignores edit fields. Callbacks run once and are never retried on edit failure.
Prompt resolution awaits the callback and final edit, returns the updated message, and propagates failures. Collector/paginator failures are logged.

Migrating from v3: replace prompt `onConfirm`, `onReject`, `onCustom`, and `onTimeout` with one `onResolve` callback switching on `status`.
Rename paginator `onTimeout` (including the global paginator default) to `onResolve`. Move follow-up edits into returned payloads to combine them with cleanup.

### BetterModal

```ts
import { TextInputStyle } from "discord.js";
import { BetterModal } from "vimcord";

const result = await new BetterModal({ title: "Create Ticket" })
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
        style: TextInputStyle.Paragraph
    })
    .addUserSelect({
        customId: "assignees",
        label: "Assignees",
        maxValues: 3,
        required: false
    })
    .showAndAwait(interaction);
if (!result) return;

result.fields.subject; // string
result.fields.assignees; // collection of the selected users

await result.reply({
    content: `Ticket created: ${result.fields.subject}`,
    flags: "Ephemeral"
});
```

`result.fields` is typed from the builder chain, so keep the `add*` calls chained, and every input needs a `customId`. Text inputs read as strings, string selects and checkbox groups as arrays, checkboxes as booleans, and radio groups as a string or `null`. User, role, channel and mentionable selects and file uploads read as collections, empty when nothing was chosen. Use `result.interaction.fields` when you need a Discord.js getter these don't cover. `showAndAwait` waits for the UX config's `modal.timeout`, 60 seconds by default, unless you pass `{ timeout }`.

Deferral methods now live only on the original interaction. `followUp()` remains a helper and always creates a follow-up message, even after a reply or deferral.

```ts
// Before
await result.deferUpdate();
await result.deferReply({ flags: "Ephemeral" });

// After
await result.interaction.deferUpdate();
await result.interaction.deferReply({ flags: "Ephemeral" });
```

### DynaSend

```ts
import { dynaSend } from "vimcord";

await dynaSend(interaction, {
    content: "Hello from one send helper.",
    embeds: [embed]
});
```

The send is inferred from the target: an interaction replies or edits its reply, and a channel, message, member or user sends. The two that can't be inferred are `sendMethod: "followUp"` and `sendMethod: "edit"`, which edits a `Message` or an interaction's reply. Paginators and prompts take `sendMethod` in their send options too.

### MongoDB Plugin

```ts
import { createMongoSchema, MongoosePlugin } from "@vimcord/plugin-mongoose";

const client = new Vimcord({
    intents: [GatewayIntentBits.Guilds],
    plugins: [
        new MongoosePlugin({
            connectOptions: {
                dbName: "vimcord"
            }
        })
    ]
});

const Users = createMongoSchema("Users", {
    userId: { type: String, required: true, unique: true },
    balance: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    deletedAt: { type: Date, default: null }
});

const user = await Users.fetch({ userId: "123" }, undefined, { required: true });
await Users.upsert({ userId: "123" }, { $inc: { balance: 100 } });

// Add your own helpers as plain functions next to the schema
const softDelete = (userId: string) => Users.update({ userId }, { deletedAt: new Date() });

await softDelete("123");
```

Reads return plain objects by default. Set `leanByDefault: false` in the schema options when you need hydrated Mongoose
documents, or pass `{ lean: false }` for one query.

Use `Object.assign(createMongoSchema(...), { ... })` if you want helpers with method syntax on the schema object.

#### Sessions

Builder calls inside `useSession` and `useTransaction` use that session automatically. Pass `{ session: null }` to run
one call outside the active session. Await every operation started in the callback. Unawaited work keeps the session
after the transaction ends and fails.

```ts
await Users.useTransaction(async () => {
    await Users.update({ userId: "123" }, { $inc: { balance: -100 } });
    await Bank.update({ userId: "123" }, { $inc: { balance: 100 } });
});
```

#### Pagination

`paginate` uses offset pagination. Deep pages are slower because MongoDB scans through skipped documents. A paginator
page loader requests one database page at a time and does not cache it:

```ts
import { BetterContainer, Paginator } from "vimcord";

const first = await Users.paginate();
const paginator = new Paginator({
    onLoading: () => ({ containers: [new BetterContainer().addText("Loading users...")] })
});

paginator.addChapter({
    label: "Users",
    pageCount: first.pages,
    page: async (page, { setPageCount }) => {
        const { docs, pages } = page === 0 ? first : await Users.paginate(undefined, undefined, { page: page + 1 });
        setPageCount(Math.max(pages, 1));
        return {
            containers: docs.map(user => new BetterContainer().addText(user.userId ?? "Unknown user"))
        };
    }
});
```

#### Read cache

You can cache read-heavy documents on one schema path:

```ts
const Guilds = createMongoSchema("Guilds", { guildId: { type: String, required: true } }, {
    cache: { key: "guildId", ttl: 60_000 }
});
```

Only exact one-key lookups use the cache. Projections, multi-field filters, `$in`, sorts, hydrated reads, and reads with
a session all bypass it. Cached reads return frozen documents. Copy the value first if you need to change it.

The cache lives in one process. Under `ShardingManager`, each shard has its own cache and does not invalidate the others.
Keep TTLs short. Guild-keyed data is usually safe because Discord routes a guild to one shard. User-keyed data can reach
more than one shard. Writes from a dashboard, CLI, or another bot are also invisible to this cache.

Entries expire when their key is read again. There is no size limit, so use a stable low-cardinality key and a short TTL.
Guild settings and feature flags are good fits. A counter incremented on every command is not, because invalidation churn
makes caching it worse than no cache.

### Client Logger

Command usage logs show execute time by default. Fixed labels, prefixes, and second-precision timestamps are reused; prefix and palette changes refresh their cached output.

Select timings in the order you want them displayed:

```ts
const client = new Vimcord({
    intents: [GatewayIntentBits.Guilds],
    commandLogging: ["delivery", "preExecute", "execute", "total"]
});
```

```text
[14:32:10] ⚡ vimcord COMMAND /balance used by maya in Workshop | delivery 48.0ms | pre 12.0ms | exec 126.0ms | total 142.0ms
```

| Setting | Log label | Measures |
| --- | --- | --- |
| `delivery` | `delivery` | Discord message/interaction creation to Vimcord matching the command |
| `preExecute` | `pre` | Command match to your execute callback or subcommand handler starting |
| `execute` | `exec` | Your handler starting to returning or throwing, including awaited prompts |
| `total` | `total` | Command match to the module pipeline finishing, including error handling |

Automatic reply deferral is included in `pre`, not `exec`. Matching is local recognition, not Discord confirming
a reply or defer. `delivery` includes delays before your event handler calls the dispatcher and depends on the
bot's clock agreeing with Discord's; negative values display as `n/a`. Local durations use a monotonic clock.
Context commands use the invoking interaction's timestamp, not the target message's timestamp.

Omitting the setting defaults to `["execute"]`. `false` or `[]` disables usage logging by default.
Command `metadata.logUsage: false` always suppresses that command. Explicit `metadata.logUsage: true` uses
the selected timings, or `["execute"]` when global logging is off. Guild IDs are omitted from usage logs.

Only invocations reaching the internal execute call are logged, including failed executions. If automatic
deferral fails before your handler starts, `pre` and `exec` display as `n/a`; delivery and total are still
available. Blocked/skipped commands, unmatched commands, and autocomplete do not emit usage logs.

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
| `SlashCommandModule` | Slash command module with optional subcommands |
| `PrefixCommandModule` | Prefix command module with aliases, subcommands and parsed message content |
| `MessageContextCommandModule` | Message context menu command module |
| `UserContextCommandModule` | User context menu command module |
| `EventModule` | Typed Discord event module |
| `BetterEmbed` | Embed helper with send, follow-up and edit methods |
| `BetterContainer` | Components V2 container helper |
| `Paginator` | Component-based paginator |
| `BetterModal` | Modal helper with V2 component support |
| `promptMessage` | Confirmation prompt helper |
| `dynaSend` | Send helper for interactions, channels, messages, members, and users |
| `defineGlobalUxConfig` | Global UX defaults for embeds, collectors, paginator, and prompts |
| `setupCLI` | Initializes the process-wide stdin CLI for the client |
| `CLILogger` | CLI-specific logger with target headers, groups, tables, styles, and loaders |

### Client Options

```ts
const client = new Vimcord({
    intents: [GatewayIntentBits.Guilds],
    name: "My Bot",
    version: "1.0.0",
    devMode: false,
    verbose: false,
    enableCLI: true,
    disableBanner: false,
    commandLogging: ["execute"],
    staff: {
        ownerId: "123456789012345678",
        superUsers: [],
        superUserRoles: []
    },
    plugins: [],
    modules: {
        slashCommands: { dir: "./commands/slash", suffix: ".slash" },
        prefixCommands: { dir: "./commands/prefix", suffix: ".prefix" },
        messageContextCommands: { dir: "./commands/message-context", suffix: ".mctx" },
        userContextCommands: { dir: "./commands/user-context", suffix: ".uctx" },
        events: { dir: "./events", suffix: null }
    },
    prefix: "!",
    allowMention: false,
    syncCommands: true,
    hooks: {
        prefix: {
            async onError({ message, error }) {
                await message.reply(`Command failed: ${error?.message ?? "Unknown error"}`);
            }
        }
    }
});
```

Other Discord.js client options sit alongside these. Bots read the settings back through `client.globals`, such as `client.globals.staff`, and `client.$devMode` can change dev mode at runtime.

Plugins are registered only through `plugins`, before login. Read them with `client.plugins.get()`, `has()` and `isInstalled()`.

### Plugin Lifecycle

Override `onPluginsInstalled()` to run work after every plugin is installed and before modules load, such as migrations that need another plugin. A failure there aborts login and unloads the plugins.

### Plugin Health Registration

Plugin install hooks receive a typed context. A registered health probe is scoped to that client and is removed automatically when the plugin unloads.

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

    override install({ health }: VimcordPluginContext) {
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

### Command Routing

Slash, autocomplete, context-menu, and prefix commands connect during `login()` without wrapping dispatch in event modules:

```ts
const client = new Vimcord({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    prefix: ["!", "?"],
    allowMention: true
});
```

A prefix can also depend on the message:

```ts
prefix: async message => (message.guildId ? await getGuildPrefix(message.guildId) : "!")
```

The manager listens directly to Discord.js events. The prefix function runs once per message; a plain string or array never awaits anything.

### Bot Staff Checks

```ts
const isStaff = await client.isBotStaff(interaction.user.id);
if (!isStaff) {
    await interaction.reply({ content: "This is staff-only.", flags: "Ephemeral" });
}
```

`staff.bypassesStaff` grants named users and configured staff-guild roles access only to commands that use `access: { staff: true }`. `staff.bypassesGuildAdmin` can remove the `Administrator` requirement for configured staff. Other required user permissions still apply.

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
