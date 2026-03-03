# Command Examples

## Slash Command

```typescript
import { InteractionContextType } from "discord.js";
import { SlashCommandBuilder } from "vimcord";

export default new SlashCommandBuilder({
    builder: builder =>
        builder.setName("ping").setDescription("Check bot latency").setContexts(InteractionContextType.Guild),

    metadata: { category: "General" },

    async execute(client, interaction) {
        interaction.reply({ content: `Pong! ${client.ws.ping}ms` });
    }
});
```

---

## Slash Command with Subcommands

```typescript
import { InteractionContextType } from "discord.js";
import { BetterContainer, SlashCommandBuilder } from "vimcord";

export default new SlashCommandBuilder({
    builder: builder =>
        builder
            .setName("backup")
            .setDescription("Manage backups")
            .addSubcommand(sub => sub.setName("create").setDescription("Create a backup"))
            .addSubcommand(sub => sub.setName("list").setDescription("List backups")),

    deferReply: true,
    metadata: { category: "Staff" },

    routes: [
        {
            name: "create",
            async handler(client, interaction) {
                const container = new BetterContainer();
                container.addText("## Backup Created");
                return container.send(interaction);
            }
        }
    ]
});
```

---

## Prefix Command

```typescript
import { PrefixCommandBuilder } from "vimcord";

export default new PrefixCommandBuilder({
    name: "ping",
    aliases: ["p", "pong"],
    description: "Check bot latency",
    metadata: { category: "General" },

    async execute(client, message) {
        message.reply(`Pong! ${client.ws.ping}ms`);
    }
});
```

---

## Prefix Command with Flags

```typescript
import { $ } from "qznt";
import { PrefixCommandBuilder } from "vimcord";

export default new PrefixCommandBuilder({
    name: "restart",
    description: "Restart the bot",
    metadata: { category: "Staff" },

    async execute(client, message) {
        const cancel = $.str.hasFlag(message.content, "--cancel");

        if (cancel) {
            return message.reply("Restart cancelled.");
        }

        // Schedule restart...
    }
});
```

---

## Context Command (Message)

```typescript
import { ApplicationCommandType, InteractionContextType } from "discord.js";
import { BetterModal, ContextCommandBuilder } from "vimcord";

export default new ContextCommandBuilder({
    builder: builder =>
        builder.setName("Reply").setContexts(InteractionContextType.Guild).setType(ApplicationCommandType.Message),

    async execute(client, interaction) {
        const targetMessage = await interaction.channel?.messages.fetch(interaction.targetId);
        if (!targetMessage) return;

        const modal = await new BetterModal({
            title: "Reply",
            components: [{ textInput: { label: "Message", required: true } }]
        }).showAndAwait(interaction);

        if (!modal?.values[0]) return;

        await targetMessage.reply({ content: modal.values[0] });
        return modal.interaction.editReply({ content: "Sent!" });
    }
});
```

---

## Permissions

```typescript
new SlashCommandBuilder({
    builder: builder => builder.setName("admin").setDescription("Admin command"),

    permissions: {
        botStaffOnly: true, // Bot staff only
        guildOwnerOnly: true, // Guild owner only
        botOwnerOnly: true, // Bot owner only
        guildOnly: true, // Guilds only (no DMs)
        user: ["ManageMessages"], // Required user permissions
        bot: ["ManageChannels"] // Required bot permissions
    }
});
```

---

## Conditions

```typescript
new SlashCommandBuilder({
    builder: builder => builder.setName("premium").setDescription("Premium command"),

    conditions: [
        async (client, interaction) => {
            const user = await fetchUser(client, interaction.user.id);
            return user?.premium ?? false;
        }
    ],

    onConditionsNotMet: (client, interaction) => {
        interaction.reply({ content: "Premium only!" });
    }
});
```

---

## Rate Limiting

```typescript
new SlashCommandBuilder({
    builder: builder => builder.setName("daily").setDescription("Daily command"),

    rateLimit: {
        max: 1,
        interval: 86400000, // 24 hours
        scope: "User", // User | Guild | Channel | Global

        onRateLimit: (client, interaction) => {
            interaction.reply({ content: "You can only use this once per day!" });
        }
    }
});
```

---

## Before/After Execute Hooks

```typescript
new SlashCommandBuilder({
    builder: builder => builder.setName("command"),

    beforeExecute: async (client, interaction) => {
        console.log("About to execute:", interaction.commandName);
    },

    execute: async (client, interaction) => {
        // Main logic
    },

    afterExecute: async (result, client, interaction) => {
        console.log("Command executed:", result);
    }
});
```

---

## Error Handling

```typescript
new SlashCommandBuilder({
    builder: builder => builder.setName("command"),

    onError: async (error, client, interaction) => {
        console.error("Command error:", error);
        interaction.reply({ content: "An error occurred!" });
    }
});
```
