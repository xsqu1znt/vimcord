# Tools Examples

## BetterEmbed

```typescript
import { BetterEmbed } from "vimcord";

const embed = new BetterEmbed({
    title: "Hello World",
    description: "This is an embed",
    color: "#ff0000",
    author: {
        name: "Author Name",
        iconURL: "https://example.com/icon.png",
        url: "https://example.com"
    },
    fields: [
        { name: "Field 1", value: "Value 1", inline: true },
        { name: "Field 2", value: "Value 2", inline: true }
    ],
    footer: { text: "Footer text", iconURL: "https://example.com/footer.png" },
    timestamp: true,
    url: "https://example.com"
});

// Send
message.reply({ embeds: [embed.toJSON()] });
```

---

## BetterContainer

```typescript
import { BetterContainer } from "vimcord";

const container = new BetterContainer();

// Add text sections
container.addText("## Header");
container.addSeparator({ spacing: 2 });
container.addText("Content here");

// Add button
container.addButton("primary", "custom_id", "Click Me", { name: "🔘" });

// Add select menu
container.addStringSelect("select_id", "Choose an option", [
    { label: "Option 1", value: "1", description: "First option" },
    { label: "Option 2", value: "2", description: "Second option" }
]);

// Send
container.send(interaction);
```

---

## Paginator

```typescript
import { Paginator } from "vimcord";

const pages = [
    { embed: { title: "Page 1", description: "Content 1" }, content: "Page 1 content" },
    { embed: { title: "Page 2", description: "Content 2" }, content: "Page 2 content" },
    { embed: { title: "Page 3", description: "Content 3" }, content: "Page 3 content" }
];

const paginator = new Paginator({
    target: message,
    pages,
    config: { jumpableThreshold: 10 }
});

await paginator.send();
```

---

## Prompt (Confirmation)

```typescript
import { Prompt, ButtonStyle, PromptResolveType } from "vimcord";

const result = await Prompt(interaction, {
    content: "Are you sure you want to delete this?",
    embed: {
        title: "Confirm Deletion",
        description: "This action cannot be undone.",
        color: "#ff0000"
    },
    customButtons: {
        delete: {
            label: "Delete",
            style: ButtonStyle.Danger,
            emoji: { name: "🗑️" }
        }
    },
    onResolve: [PromptResolveType.DeleteOnConfirm, PromptResolveType.DeleteOnReject],
    timeout: 30000
});

if (result.confirmed) {
    // User clicked confirm
} else if (result.timedOut) {
    // User didn't respond
}
```

---

## BetterModal

```typescript
import { BetterModal, TextInputStyle } from "vimcord";

const modal = new BetterModal({
    title: "User Feedback",
    components: [
        {
            textInput: {
                label: "Your feedback",
                style: TextInputStyle.Paragraph,
                placeholder: "Tell us what you think...",
                required: true,
                minLength: 10,
                maxLength: 1000
            }
        },
        {
            textInput: {
                label: "Rating (1-5)",
                style: TextInputStyle.Short,
                placeholder: "1-5",
                required: true
            }
        }
    ]
});

const result = await modal.showAndAwait(interaction);

if (result) {
    const feedback = result.values[0];
    const rating = result.values[1];
}
```

---

## Collector

```typescript
import { BetterCollector, CollectorTimeoutType } from "vimcord";

const collector = new BetterCollector({
    target: interaction,
    timeout: 30000,
    idle: 10000,
    filter: btn => btn.user.id === interaction.user.id
});

const button = await collector.awaitButton("confirm");

if (button) {
    await button.deferUpdate();
}
```

---

## Logger

```typescript
import { logger } from "vimcord";

logger.info("Info message");
logger.success("Success message");
logger.warn("Warning message");
logger.error("Error message", error);

// Custom logger
const customLogger = new Logger({
    prefix: "[MyModule]",
    prefixEmoji: "🔧",
    minLevel: "INFO",
    showTimestamp: true
});

customLogger.info("Custom message");
```

---

## dynaSend

```typescript
import { dynaSend } from "vimcord";

// Send to interaction
await dynaSend(interaction, {
    content: "Hello!",
    embeds: [embed.toJSON()],
    components: [row.toJSON()],
    ephemeral: true
});

// Send to channel
await dynaSend(channel, {
    content: "Hello channel!"
});

// Reply to message
await dynaSend(message, {
    content: "Hello!",
    reply: { mention: true }
});
```
