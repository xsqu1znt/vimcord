# Client & Configuration

## createClient

Creates a new Vimcord client instance.

```typescript
createClient(options: ClientOptions, features?: VimcordFeatures, config?: PartialDeep<VimcordConfig>): Vimcord
```

## defineClientOptions

Wraps Discord.js ClientOptions.

```typescript
defineClientOptions(options: ClientOptions): ClientOptions
```

## defineVimcordFeatures

Enables/disables Vimcord features.

```typescript
defineVimcordFeatures(features: VimcordFeatures): VimcordFeatures
```

### VimcordFeatures

```typescript
interface VimcordFeatures {
    useGlobalErrorHandlers?: boolean;
    useDefaultSlashCommandHandler?: boolean;
    useDefaultPrefixCommandHandler?: boolean;
    useDefaultContextCommandHandler?: boolean;
    enableCommandErrorMessage?: {
        inviteButtonLabel?: string;
        inviteUrl?: string;
    };
    importModules?: {
        events?: string | string[] | ModuleImportOptions;
        slashCommands?: string | string[] | ModuleImportOptions;
        prefixCommands?: string | string[] | ModuleImportOptions;
        contextCommands?: string | string[] | ModuleImportOptions;
    };
}
```

## defineGlobalToolsConfig

Configures global tool settings (embeds, collectors, paginators).

```typescript
defineGlobalToolsConfig(options: PartialDeep<ToolsConfig>): void
```

### ToolsConfig

```typescript
interface ToolsConfig {
    devMode: boolean;
    embedColor: ColorResolvable[];
    embedColorDev: ColorResolvable[];
    timeouts: {
        collectorTimeout: number;
        collectorIdle: number;
        pagination: number;
        prompt: number;
        modalSubmit: number;
    };
    collector: {
        notAParticipantMessage: string;
        userLockMessage: string;
        notAParticipantWarningCooldown: number;
    };
    paginator: {
        notAParticipantMessage: string;
        jumpableThreshold: number;
        longThreshold: number;
        buttons: Record<"first" | "back" | "jump" | "next" | "last", { label: string; emoji: { name: string; id: string } }>;
    };
    prompt: {
        defaultTitle: string;
        defaultDescription: string;
        confirmLabel: string;
        rejectLabel: string;
    };
}
```

## configure

Configures client sub-systems.

```typescript
client.configure("app", config: PartialDeep<AppConfig>)
client.configure("staff", config: PartialDeep<StaffConfig>)
client.configure("slashCommands", config: PartialDeep<SlashCommandConfig>)
client.configure("prefixCommands", config: PartialDeep<PrefixCommandConfig>)
client.configure("contextCommands", config: PartialDeep<ContextCommandConfig>)
```

### AppConfig

```typescript
interface AppConfig {
    name: string;
    version: string;
    devMode: boolean;
    verbose: boolean;
    enableCLI: boolean;
    disableBanner: boolean;
}
```

### StaffConfig

```typescript
interface StaffConfig {
    ownerId: string | null;
    superUsers: string[];
    superUserRoles: string[];
    bypassers: { commandName: string; userIds: string[] }[];
    bypassesGuildAdmin: {
        allBotStaff: boolean;
        botOwner: boolean;
        superUsers: boolean;
        bypassers: boolean;
    };
    guild: {
        id: string | null;
        inviteUrl: string | null;
        channels: Record<string, string>;
    };
}
```

## Vimcord Instance Properties

```typescript
client.status; // StatusManager - bot presence/activity
client.events; // EventManager - event handlers
client.commands; // CommandManager - slash/prefix/context commands
client.db; // DatabaseManager | undefined - MongoDB connection
client.logger; // Logger - instance logger
client.error; // VimcordErrorHandler - error handling
```

## start

Starts the bot and connects to Discord.

```typescript
client.start(callback?: () => void): Promise<void>
```

## useClient / useReadyClient

Retrieve client instances.

```typescript
useClient(clientId?: number): Vimcord | undefined
useReadyClient(clientId?: number, timeoutMs?: number): Promise<Vimcord<true>>
```

---

## Quick Config Example

```typescript
import { GatewayIntentBits } from "discord.js";
import {
    createClient,
    defineClientOptions,
    defineVimcordFeatures,
    defineGlobalToolsConfig,
    MongoDatabase,
    StatusType,
    ActivityType
} from "vimcord";

defineGlobalToolsConfig({
    embedColor: ["#9c3c41", "#ad7e75"],
    paginator: {
        notAParticipantMessage: "These buttons aren't for you.",
        buttons: {
            first: { label: "", emoji: { name: "⏮️", id: "⏮️" } },
            back: { label: "", emoji: { name: "◀️", id: "◀️" } },
            next: { label: "", emoji: { name: "▶️", id: "▶️" } },
            last: { label: "", emoji: { name: "⏭️", id: "⏭️" } }
        }
    }
});

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
        useDefaultPrefixCommandHandler: true,
        importModules: {
            events: "./events",
            slashCommands: "./commands/slash",
            prefixCommands: "./commands/prefix",
            contextCommands: "./commands/context"
        }
    })
);

client.useEnv();
client.useDatabase(new MongoDatabase(client));

client
    .configure("app", { name: "MyBot", verbose: false })
    .configure("staff", {
        ownerId: "123456789",
        superUsers: ["987654321"],
        guild: { id: "111222333", inviteUrl: "https://discord.gg/mybot" }
    })
    .configure("prefixCommands", { defaultPrefix: "!" });

client.start(() => {
    client.status.set({
        production: { activity: { name: "Botting!", type: ActivityType.Playing, status: StatusType.Online } }
    });
});
```
