# Event Examples

## VSCode Snippets

Use these snippets in VSCode for quick scaffolding:

| Snippet | Trigger  |
| ------- | -------- |
| Event   | `vEvent` |

---

## Simple Event

```typescript
import { EventBuilder } from "vimcord";

export default EventBuilder.create("messageCreate", "Message Logger").setExecute(async (client, message) => {
    if (message.author.bot) return;
    console.log(`${message.author.tag}: ${message.content}`);
});
```

---

## Event with Conditions

```typescript
import { EventBuilder } from "vimcord";

export default new EventBuilder({
    event: "messageCreate",
    name: "Staff Messages",

    conditions: [(client, message) => message.member?.permissions.has("Administrator") ?? false],

    metadata: { category: "Moderation" },

    execute: async (client, message) => {
        // Handle staff messages
    }
});
```

---

## Once Event (Runs Once)

```typescript
import { EventBuilder } from "vimcord";

export default new EventBuilder({
    event: "ready",
    name: "Startup Logger",
    once: true,

    execute: async client => {
        console.log(`Logged in as ${client.user?.tag}`);
        console.log(`Serving ${client.guilds.cache.size} guilds`);
    }
});
```

---

## Deployment Filtering

```typescript
import { EventBuilder } from "vimcord";

export default new EventBuilder({
    event: "presenceUpdate",
    name: "Vanity Tracker",

    // Only run in production
    deployment: {
        environments: ["production"]
    },

    execute: async (client, oldPresence, newPresence) => {
        // Production-only logic
    }
});
```

---

## Event with Priority

Lower priority executes first:

```typescript
import { EventBuilder } from "vimcord";

export default new EventBuilder({
    event: "messageCreate",
    name: "High Priority Handler",
    priority: -100, // Runs early

    execute: async (client, message) => {
        // Runs early
    }
});
```

---

## Rate Limited Event

```typescript
import { EventBuilder } from "vimcord";

export default new EventBuilder({
    event: "messageCreate",
    name: "Rate Limited",

    rateLimit: {
        max: 5,
        interval: 60000, // Per minute

        onRateLimit: (client, message) => {
            console.log("Rate limited!");
        }
    },

    execute: async (client, message) => {
        // Handle message
    }
});
```

---

## Event with Before/After Hooks

```typescript
import { EventBuilder } from "vimcord";

export default new EventBuilder({
    event: "messageCreate",
    name: "Message Processor",

    beforeExecute: async (client, message) => {
        console.log("Processing message from", message.author.tag);
    },

    execute: async (client, message) => {
        // Main logic
    },

    afterExecute: async (result, client, message) => {
        console.log("Processed:", result);
    }
});
```

---

## Error Handling

```typescript
import { EventBuilder } from "vimcord";

export default new EventBuilder({
    event: "messageCreate",
    name: "Error Prone",

    execute: async (client, message) => {
        throw new Error("Something went wrong");
    },

    onError: async (error, client, message) => {
        console.error("Event error:", error);
    }
});
```

---

## Looking Up Events

```typescript
// Get event by name
client.events.get("Message Logger");

// Get events by tag
client.events.getByTag("moderation");

// Get events by category
client.events.getByCategory("Moderation");

// Get events by Discord event type
client.events.getByEvent("messageCreate");
```
