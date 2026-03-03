# Status

## StatusManager

Manages bot presence/activity with rotation support.

```typescript
client.status: StatusManager
```

### Methods

```typescript
status.start(): this
status.pause(): this
status.set(status: PartialDeep<VimcordClientStatus>): Promise<this>
status.destroy(): Promise<this>
status.clear(): Promise<this>
```

---

## StatusType

```typescript
enum StatusType {
    DND = "dnd",
    Idle = "idle",
    Online = "online",
    Invisible = "invisible"
}
```

---

## VimcordClientStatus

```typescript
interface VimcordClientStatus {
    production: ClientStatus;
    development: ClientStatus;
}
```

### ClientStatus

```typescript
interface ClientStatus {
    interval?: number; // Rotation interval in seconds
    randomize?: boolean; // Randomize rotation order
    activity: ClientActivity | ClientActivity[];
}
```

### ClientActivity

```typescript
interface ClientActivity {
    name: string;
    type: ActivityType;
    status: StatusType;
    streamUrl?: string;
}
```

---

## createVimcordStatusConfig

Creates a status configuration.

```typescript
createVimcordStatusConfig(options?: PartialDeep<VimcordClientStatus>): VimcordClientStatus
```

### Activity Types (discord.js)

```typescript
ActivityType.Playing;
ActivityType.Streaming;
ActivityType.Listening;
ActivityType.Watching;
ActivityType.Custom;
ActivityType.Competing;
```

---

## Quick Status Examples

### Static Status

```typescript
import { ActivityType, StatusType } from "discord.js";
import { StatusType as VimcordStatusType } from "vimcord";

client.status.set({
    production: {
        activity: {
            name: "My Bot",
            type: ActivityType.Playing,
            status: VimcordStatusType.Online
        }
    }
});
```

### Rotating Status

```typescript
client.status.set({
    production: {
        interval: 15,
        randomize: true,
        activity: [
            { name: "Game 1", type: ActivityType.Playing, status: StatusType.DND },
            { name: "Listening to Music", type: ActivityType.Listening, status: StatusType.Idle },
            { name: "Watching TV", type: ActivityType.Watching, status: StatusType.Online }
        ]
    }
});
```

### Placeholders in Status

The `$USER_COUNT` and `$GUILD_COUNT` placeholders are automatically replaced:

```typescript
client.status.set({
    production: {
        activity: {
            name: "$GUILD_COUNT servers | $USER_COUNT users",
            type: ActivityType.Watching,
            status: StatusType.Online
        }
    }
});
```

---

## Status Events

```typescript
status.on("changed", (activity: ClientActivity) => {});
status.on("cleared", () => {});
status.on("rotation", (activity: ClientActivity) => {});
status.on("paused", (loop: Loop) => {});
status.on("started", (loop: Loop) => {});
status.on("destroyed", () => {});
```
