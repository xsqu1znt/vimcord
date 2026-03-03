# Utilities

## Fetch Helpers

### fetchUser

Fetch a user from the client, checking cache first.

```typescript
fetchUser(client: Client<true>, userId: string | undefined | null): Promise<User | null>
```

### fetchGuild

Fetch a guild from the client, checking cache first.

```typescript
fetchGuild(client: Client<true>, guildId: string | undefined | null): Promise<Guild | null>
```

### fetchMember

Fetch a member from a guild, checking cache first.

```typescript
fetchMember(guild: Guild, memberId: string | undefined | null): Promise<GuildMember | null>
```

### fetchChannel

Fetch a channel from a guild, checking cache first.

```typescript
fetchChannel<T extends ChannelType>(guild: Guild, channelId: string | undefined | null, type?: T): Promise<FetchedChannel<T> | null>
```

### fetchMessage

Fetch a message from a channel, checking cache first.

```typescript
fetchMessage(channel: GuildTextBasedChannel | VoiceBasedChannel, messageId: string | undefined | null): Promise<Message | null>
```

### fetchRole

Fetch a role from a guild, checking cache first.

```typescript
fetchRole(guild: Guild, roleId: string | undefined | null): Promise<Role | null>
```

---

## Mention Parsing

### getMessageMention

Get a mention or snowflake argument from a message.

```typescript
getMessageMention<M extends Message, T extends MentionType>(
    message: M,
    content: string | undefined | null,
    type: T,
    index: number,
    idOnly: true
): Promise<string | null>

getMessageMention<M extends Message, T extends MentionType>(
    message: M,
    content: string | undefined | null,
    type: T,
    index?: number,
    idOnly?: false
): Promise<FetchedMessageMention<T, M extends Message<true> ? true : false> | null>
```

### MentionType

```typescript
type MentionType = "user" | "member" | "channel" | "role";
```

### getFirstMentionId

Get the ID of the first mention of a specified type.

```typescript
getFirstMentionId(options: {
    message?: Message;
    content?: string;
    type: MentionType;
}): string
```

### isMentionOrSnowflake

Check if a string is a mention or snowflake.

```typescript
isMentionOrSnowflake(str: string | undefined): boolean
```

### cleanMention

Remove mention syntax from a string.

```typescript
cleanMention(str: string | undefined): string | undefined
```

### \_\_zero

Returns the string if populated, or "0" otherwise.

```typescript
__zero(str?: string | null): string
```

---

## Config Helpers

### createConfigFactory

Create a config factory with validation.

```typescript
createConfigFactory<T extends object>(
    defaultConfig: T,
    validate?: (config: T) => void
): (options?: PartialDeep<T>, existing?: T) => T
```

---

## Module Helpers

### importModulesFromDir

Import modules from a directory.

```typescript
importModulesFromDir<T>(
    dir: string,
    suffix?: string | string[]
): Promise<{ module: T; path: string }[]>
```

---

## Object Helpers

### deepMerge

Deep merge objects - mutates target and returns it.

```typescript
deepMerge<T extends object>(target: T, ...sources: Array<object | undefined>): T
```

---

## Process Helpers

### getPackageJson

Read package.json from the current working directory.

```typescript
getPackageJson(): any
```

### getDevMode

Check if the process was ran using the `--dev` flag.

```typescript
getDevMode(): boolean
```

---

## Quick Utils Example

```typescript
import {
    fetchUser,
    fetchGuild,
    fetchMember,
    fetchChannel,
    getMessageMention,
    isMentionOrSnowflake,
    cleanMention,
    createConfigFactory,
    deepMerge,
    getDevMode
} from "vimcord";

// Fetch entities
const user = await fetchUser(client, "123456789");
const member = await fetchMember(guild, "123456789");
const channel = await fetchChannel(guild, "123456789", ChannelType.GuildText);

// Parse mentions
const userId = await getMessageMention(message, message.content, "user", 0, true);

// Check if string is a mention/snowflake
if (isMentionOrSnowflake(arg)) {
}

// Clean mentions
const cleaned = cleanMention("<@123456789>"); // "123456789"

// Config factory
const createMyConfig = createConfigFactory(
    {
        enabled: true,
        timeout: 5000
    },
    config => {
        if (config.timeout < 1000) throw new Error("Timeout too short");
    }
);

// Deep merge
const merged = deepMerge(base, { a: 1 }, { b: 2 });

// Dev mode
if (getDevMode()) {
    console.log("Running in dev mode");
}
```
