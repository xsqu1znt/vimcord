# Commands

## SlashCommandBuilder

Creates a slash command.

```typescript
new SlashCommandBuilder(config: SlashCommandConfig): SlashCommandBuilder
```

### SlashCommandConfig

```typescript
interface SlashCommandConfig extends BaseCommandConfig<CommandType.Slash>, BaseAppCommandConfig {
    builder: AnySlashCommandBuilder | ((builder: SlashCommandBuilder) => AnySlashCommandBuilder);
    deferReply?: boolean | { ephemeral?: boolean };
    routes?: Array<{
        name: string;
        handler: (client: Vimcord<true>, interaction: ChatInputCommandInteraction) => any;
    }>;
    onUnknownRouteHandler?: (client: Vimcord<true>, interaction: ChatInputCommandInteraction) => any;
}
```

### BaseCommandConfig

```typescript
interface BaseCommandConfig<T extends CommandType> {
    enabled?: boolean;
    conditions?: Array<(...args: BaseCommandParameters<T>) => boolean | Promise<boolean>>;
    permissions?: CommandPermissions;
    metadata?: CommandMetadata;
    rateLimit?: CommandRateLimitOptions;
    logExecution?: boolean;
    beforeExecute?: (...args: BaseCommandParameters<T>) => any;
    execute?: (...args: BaseCommandParameters<T>) => any;
    afterExecute?: (result: any, ...args: BaseCommandParameters<T>) => any;
    onMissingPermissions?: (results: CommandPermissionResults, ...args: BaseCommandParameters<T>) => any;
    onConditionsNotMet?: (...args: BaseCommandParameters<T>) => any;
    onUsedWhenDisabled?: (...args: BaseCommandParameters<T>) => any;
    onRateLimit?: (...args: BaseCommandParameters<T>) => any;
    onError?: (error: Error, ...args: BaseCommandParameters<T>) => any;
}
```

### CommandPermissions

```typescript
interface CommandPermissions {
    user?: PermissionResolvable[];
    bot?: PermissionResolvable[];
    roles?: string[];
    userWhitelist?: string[];
    userBlacklist?: string[];
    roleBlacklist?: string[];
    guildOnly?: boolean;
    guildOwnerOnly?: boolean;
    botOwnerOnly?: boolean;
    botStaffOnly?: boolean;
}
```

### CommandMetadata

```typescript
interface CommandMetadata {
    category?: string;
    categoryEmoji?: string;
    tags?: string[];
    examples?: string[];
    emoji?: string;
    hidden?: boolean;
}
```

### AppCommandDeployment

```typescript
interface AppCommandDeployment {
    guilds?: string[];
    global?: boolean;
    environments?: ("development" | "production")[];
}
```

### CommandRateLimitOptions

```typescript
interface CommandRateLimitOptions {
    max: number;
    interval: number;
    scope: RateLimitScope;
    onRateLimit?: (...args: any) => any;
}

enum RateLimitScope {
    User = 0,
    Guild = 1,
    Channel = 2,
    Global = 3
}
```

---

## PrefixCommandBuilder

Creates a prefix command.

```typescript
new PrefixCommandBuilder(config: PrefixCommandConfig): PrefixCommandBuilder
```

### PrefixCommandConfig

```typescript
interface PrefixCommandConfig extends BaseCommandConfig<CommandType.Prefix> {
    name: string;
    aliases?: string[];
    description?: string;
}
```

---

## ContextCommandBuilder

Creates a context command (user or message menu).

```typescript
new ContextCommandBuilder(config: ContextCommandConfig): ContextCommandBuilder
```

### ContextCommandConfig

```typescript
interface ContextCommandConfig extends BaseCommandConfig<CommandType.Context>, BaseAppCommandConfig {
    builder: ContextMenuCommandBuilder | ((builder: ContextMenuCommandBuilder) => ContextMenuCommandBuilder);
    deferReply?: boolean | { ephemeral?: boolean };
}
```

---

## CommandManager

Manages all command types.

```typescript
client.commands: CommandManager
```

### Properties

```typescript
client.commands.slash; // SlashCommandManager
client.commands.prefix; // PrefixCommandManager
client.commands.context; // ContextCommandManager
```

### Methods

```typescript
// Get a specific command
client.commands.slash.get(name: string): SlashCommandBuilder | undefined
client.commands.prefix.get(name: string): PrefixCommandBuilder | undefined
client.commands.context.get(name: string): ContextCommandBuilder | undefined

// Get all commands
client.commands.slash.getAll(options?: CommandFilter): SlashCommandBuilder[]
client.commands.prefix.getAll(options?: CommandFilter): PrefixCommandBuilder[]
client.commands.context.getAll(options?: CommandFilter): ContextCommandBuilder[]

// Group by category
client.commands.slash.sortByCategory(): CommandByCategory<CommandType.Slash>[]
```

### CommandFilter

```typescript
interface CommandFilter {
    names?: string[];
    fuzzyNames?: string[];
    globalOnly?: boolean;
    ignoreDeploymentOptions?: boolean;
}
```

### Deploy Commands

```typescript
client.commands.registerGlobal(options?: CommandFilter): Promise<void>
client.commands.unregisterGlobal(): Promise<void>
client.commands.registerGuild(options?: CommandFilter & { guilds?: string[] }): Promise<void>
client.commands.unregisterGuild(options?: { guilds?: string[] }): Promise<void>
```

---

## CommandType

```typescript
enum CommandType {
    Slash = 0,
    Prefix = 1,
    Context = 2
}
```

---

## Quick Command Examples

### Slash Command

```typescript
import { SlashCommandBuilder } from "vimcord";

export default new SlashCommandBuilder({
    builder: builder => builder.setName("ping").setDescription("Check bot latency"),
    metadata: { category: "General" },
    async execute(client, interaction) {
        interaction.reply({ content: `Pong! ${client.ws.ping}ms` });
    }
});
```

### Prefix Command

```typescript
import { PrefixCommandBuilder } from "vimcord";

export default new PrefixCommandBuilder({
    name: "ping",
    aliases: ["p"],
    description: "Check bot latency",
    async execute(client, message) {
        message.reply(`Pong! ${client.ws.ping}ms`);
    }
});
```

### Context Command

```typescript
import { ContextCommandBuilder } from "vimcord";

export default new ContextCommandBuilder({
    builder: builder => builder.setName("Check User").setType(ContextCommandType.User),
    metadata: { category: "Moderation" },
    async execute(client, interaction) {
        const user = interaction.targetUser;
        interaction.reply({ content: `User: ${user.tag}` });
    }
});
```
