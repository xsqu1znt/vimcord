# Database Examples

## VSCode Snippets

Use these snippets in VSCode for quick scaffolding:

| Snippet               | Trigger                |
| --------------------- | ---------------------- |
| Mongo Schema          | `vMongoSchema`         |
| Extended Mongo Schema | `vExtendedMongoSchema` |

---

## Connecting to MongoDB

```typescript
import { createClient, defineClientOptions, MongoDatabase } from "vimcord";

const client = createClient(
    defineClientOptions({ intents: [...] })
);

client.useDatabase(new MongoDatabase(client));

client.start(async () => {
    await client.db?.connect(process.env.MONGO_URI!);
});
```

---

## Waiting for Database Ready

```typescript
// Method 1: Use waitForReady
await client.db?.waitForReady();

// Method 2: Use static getReadyInstance
const db = await MongoDatabase.getReadyInstance(client);
```

---

## Basic Schema (using createMongoSchema)

```typescript
import { createMongoSchema } from "vimcord";

export interface IUser {
    userId: string;
    username: string;
    balance: number;
}

export const UserSchema = createMongoSchema<IUser>(
    "users",
    {
        userId: { type: String, required: true, unique: true },
        username: String,
        balance: { type: Number, default: 0 }
    },
    { timestamps: true }
);
```

---

## Schema with Indexes

```typescript
import { createMongoSchema } from "vimcord";

export interface ICooldown {
    userId: string;
    commandName: string;
    endsAt: Date;
    guildId?: string;
    channelId?: string;
}

export const CooldownSchema = createMongoSchema<ICooldown>(
    "cooldowns",
    {
        userId: { type: String, required: true },
        commandName: { type: String, required: true },
        endsAt: { type: Date, required: true },
        guildId: String,
        channelId: String
    },
    { timestamps: true }
)
    .addIndex({ userId: 1, commandName: 1 })
    .addTTLIndex("endsAt", 0);
```

---

## Schema with Custom Methods (Extended)

```typescript
import { createMongoSchema } from "vimcord";

export interface IUser {
    userId: string;
    balance: number;
}

export const UserSchema = createMongoSchema<IUser>(
    "users",
    {
        userId: { type: String, required: true, unique: true },
        balance: { type: Number, default: 0 }
    },
    { timestamps: true }
).extend({
    async addBalance(this: any, amount: number) {
        return await this.findOneAndUpdate({ userId: this.userId }, { $inc: { balance: amount } }, { new: true });
    }
});
```

---

## CRUD Operations

```typescript
// Create
await UserSchema.create({ userId: "123", username: "Test" });

// Find
const user = await UserSchema.fetch({ userId: "123" });

// Update
await UserSchema.update({ userId: "123" }, { $inc: { balance: 100 } }, { upsert: true });

// Delete
await UserSchema.delete({ userId: "123" });
```

---

## Transactions

```typescript
await client.db?.useTransaction(async (session) => {
    await UserSchema.update({ userId: "123" }, { $inc: { balance: -100 } }, { session });

   ([{
        userId: "123",
        amount: -100,
        await TransactionSchema.create type: "purchase"
    }], { session });
});
```

---

## Aggregation Pipeline

```typescript
const results = await MySchema.aggregate([
    { $match: { active: true } },
    { $group: { _id: "$category", count: { $sum: 1 } } },
    { $sort: { count: -1 } }
]);
```
