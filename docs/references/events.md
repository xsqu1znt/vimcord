# Events

## EventBuilder

Creates an event handler.

```typescript
EventBuilder.create<T extends keyof ClientEvents>(event: T, name?: string): EventBuilder<T>
new EventBuilder<T extends keyof ClientEvents>(config: EventConfig<T>): EventBuilder<T>
```

### EventConfig

```typescript
interface EventConfig<T extends keyof ClientEvents> {
    event: T;
    name?: string;
    enabled?: boolean;
    once?: boolean;
    priority?: number;
    conditions?: Array<(...args: EventParameters<T>) => boolean>;
    metadata?: EventMetadata;
    deployment?: EventDeployment;
    rateLimit?: EventRateLimitOptions<T>;
    beforeExecute?: (...args: EventParameters<T>) => any;
    execute?: (...args: EventParameters<T>) => any;
    afterExecute?: (result: any, ...args: EventParameters<T>) => any;
    onError?: (error: Error, ...args: EventParameters<T>) => any;
}
```

### EventMetadata

```typescript
interface EventMetadata {
    category?: string;
    tags?: string[];
}
```

### EventDeployment

```typescript
interface EventDeployment {
    environments?: ("development" | "production")[];
}
```

### EventRateLimitOptions

```typescript
interface EventRateLimitOptions<T extends keyof ClientEvents> {
    max: number;
    interval: number;
    onRateLimit?: (...args: EventParameters<T>) => any;
}
```

### EventParameters

```typescript
type EventParameters<T extends keyof ClientEvents> = [client: Vimcord<true>, ...args: ClientEvents[T]];
```

---

## EventBuilder Methods

```typescript
// Configuration
builder.setEnabled(enabled: boolean): this
builder.setExecute(execute: (...args: EventParameters<T>) => any): this

// Validation & Conversion
builder.validate(): void
builder.clone(): EventBuilder<T>
builder.toConfig(): EventConfig<T>

// Execution
builder.isRateLimited(updateExecutions?: boolean): boolean
builder.checkConditions(...args: EventParameters<T>): Promise<boolean>
builder.executeEvent(...args: EventParameters<T>): Promise<any>
```

---

## EventManager

Manages event handlers.

```typescript
client.events: EventManager
```

### Methods

```typescript
// Register/unregister
client.events.register<T extends keyof ClientEvents>(...events: EventBuilder<T>[]): void
client.events.unregister(...names: string[]): void
client.events.clear(): void

// Lookup
client.events.get(name: string): EventBuilder | undefined
client.events.getByTag(tag: string): EventBuilder[]
client.events.getByCategory(category: string): EventBuilder[]
client.events.getByEvent<T extends keyof ClientEvents>(eventType: T): EventBuilder<T>[]

// Execute
client.events.executeEvents<T extends keyof ClientEvents>(eventType: T, ...args: ClientEvents[T]): Promise<void>
```

---

## Event Importing

Vimcord automatically imports events from directories when configured:

```typescript
defineVimcordFeatures({
    importModules: {
        events: "./events"
    }
});
```

### File Naming

Events should be named with the `.event` suffix by default:

```
src/events/
├── ready.event.ts
├── messageCreate.event.ts
└── interactionCreate.event.ts
```

---

## Quick Event Examples

### Simple Event

```typescript
import { EventBuilder } from "vimcord";

export default EventBuilder.create("messageCreate", "Message Logger").setExecute(async (client, message) => {
    if (message.author.bot) return;
    console.log(`[${message.guild?.name}] ${message.author.tag}: ${message.content}`);
});
```

### Event with Conditions

```typescript
import { EventBuilder } from "vimcord";

export default new EventBuilder({
    event: "messageCreate",
    name: "Staff Only",
    conditions: [(client, message) => message.member?.permissions.has("Administrator") ?? false],
    metadata: { category: "Moderation" },
    execute: async (client, message) => {
        // Handle staff messages
    }
});
```

### Once Event

```typescript
import { EventBuilder } from "vimcord";

export default new EventBuilder({
    event: "ready",
    name: "Startup",
    once: true,
    execute: async client => {
        console.log(`Logged in as ${client.user?.tag}`);
    }
});
```
