# Client Setup Examples

## Basic Client Setup

```typescript
import { GatewayIntentBits } from "discord.js";
import { createClient, defineClientOptions, defineVimcordFeatures } from "vimcord";

const client = createClient(
    defineClientOptions({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.GuildMembers,
            GatewayIntentBits.MessageContent
        ]
    }),
    defineVimcordFeatures({
        useGlobalErrorHandlers: true,
        useDefaultSlashCommandHandler: true,
        useDefaultPrefixCommandHandler: true
    })
);

client.start();
```

---

## Full Configuration

```typescript
import { GatewayIntentBits, ActivityType } from "discord.js";
import {
    createClient,
    defineClientOptions,
    defineVimcordFeatures,
    defineGlobalToolsConfig,
    MongoDatabase,
    StatusType
} from "vimcord";

// Configure global tools
defineGlobalToolsConfig({
    embedColor: ["#ff0000", "#00ff00"],
    paginator: {
        notAParticipantMessage: "Not for you.",
        buttons: {
            first: { label: "◀◀", emoji: { name: "⏮️" } },
            back: { label: "◀", emoji: { name: "◀️" } },
            next: { label: "▶", emoji: { name: "▶️" } },
            last: { label: "▶▶", emoji: { name: "⏭️" } }
        }
    }
});

// Create client
const client = createClient(
    defineClientOptions({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
    }),
    defineVimcordFeatures({
        useGlobalErrorHandlers: true,
        useDefaultSlashCommandHandler: true,
        useDefaultPrefixCommandHandler: true,
        enableCommandErrorMessage: {
            inviteButtonLabel: "Support Server",
            inviteUrl: "https://discord.gg/support"
        },
        importModules: {
            events: "./events",
            slashCommands: "./commands/slash",
            prefixCommands: "./commands/prefix",
            contextCommands: "./commands/context"
        }
    })
);

// Add database
client.useDatabase(new MongoDatabase(client));

// Configure sub-systems
client
    .configure("app", { name: "MyBot", verbose: true })
    .configure("staff", {
        ownerId: "123456789",
        superUsers: ["111222333"],
        guild: { id: "444555666", inviteUrl: "https://discord.gg/mybot" }
    })
    .configure("prefixCommands", { defaultPrefix: "!" });

// Start with callback
client.start(() => {
    client.status.set({
        production: {
            activity: { name: "Botting!", type: ActivityType.Playing, status: StatusType.Online }
        }
    });
});
```

---

## Module Import Structure

```
src/
├── events/
│   ├── ready.event.ts
│   ├── messageCreate.event.ts
│   └── interactionCreate.event.ts
├── commands/
│   ├── slash/
│   │   ├── ping.slash.ts
│   │   └── moderation/
│   │       └── kick.slash.ts
│   ├── prefix/
│   │   └── ping.prefix.ts
│   └── context/
│       └── reply.ctx.ts
```

---

## Environment Variables

Vimcord automatically loads `.env` files:

```
TOKEN=your_bot_token
MONGO_URI=mongodb://localhost:27017/db
TOKEN_DEV=your_dev_bot_token
MONGO_URI_DEV=mongodb://localhost:27017/db_dev
```

Use `client.useEnv()` to load them:

```typescript
client.useEnv();
```

---

## Development Mode

Run with `--dev` flag:

```bash
node dist/index.js --dev
```

This enables:

- `TOKEN_DEV` / `MONGO_URI_DEV` environment variables
- `client.$devMode = true`
- `embedColorDev` for embeds
- Event deployment filtering
