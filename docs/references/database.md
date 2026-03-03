# Database

## MongoDatabase

MongoDB connection manager with Mongoose integration.

```typescript
new MongoDatabase(client: Vimcord, options?: MongooseOptions): MongoDatabase
```

### Static Methods

```typescript
// Get existing instance
MongoDatabase.getInstance(clientId?: number | Vimcord): MongoDatabase | undefined

// Wait for instance to be ready
MongoDatabase.getReadyInstance(clientId?: number | Vimcord, timeoutMs?: number): Promise<MongoDatabase>

// Start a new session
MongoDatabase.startSession(options?: ClientSessionOptions, clientId?: number | Vimcord): Promise<ClientSession>
```

### Properties

```typescript
database.connection; // Mongoose Connection
database.isReady; // boolean - connection status
database.mongoose; // Mongoose instance
database.clientId; // number - client identifier
```

### Methods

```typescript
// Connect
database.connect(uri?: string, connectionOptions?: ConnectOptions, options?: MongoConnectionOptions): Promise<boolean>

// Disconnect
database.disconnect(): Promise<void>

// Sessions
database.startSession(options?: ClientSessionOptions): Promise<ClientSession>

// Transactions
database.useTransaction(fn: (session: ClientSession) => Promise<void>): Promise<void>

// Wait for ready
database.waitForReady(): Promise<this>
```

### MongoConnectionOptions

```typescript
interface MongoConnectionOptions {
    maxRetries?: number; // default: 3
}
```

---

## Usage

### Connect to MongoDB

```typescript
import { createClient, defineClientOptions, MongoDatabase } from "vimcord";

const client = createClient(
    defineClientOptions({ intents: [...] })
);

client.useDatabase(new MongoDatabase(client));
```

### With Connection URI

```typescript
client.useDatabase(new MongoDatabase(client));
await client.db.connect(process.env.MONGO_URI);
```

### With Custom Options

```typescript
await client.db.connect(
    process.env.MONGO_URI,
    {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000
    },
    { maxRetries: 5 }
);
```

---

## Transactions

```typescript
await client.db.useTransaction(async session => {
    await UserSchema.findByIdAndUpdate(userId, { $inc: { balance: 100 } }, { session });
    await TransactionSchema.create([{ userId, amount: 100 }], { session });
});
```

---

## Schema Helpers

### MongoSchemaBuilder

```typescript
new MongoSchemaBuilder<T>(name: string, schema: SchemaDefinition<T>, options?: MongoSchemaOptions<T>): MongoSchemaBuilder<T>
```

```typescript
interface MongoSchemaOptions<T> {
    collection?: string;
    timestamps?: boolean;
    timeseries?: { timeField: string; metaField?: string; granularity?: "seconds" | "minutes" | "hours" };
    indexes?: Array<{
        fields: Record<string, 1 | -1>;
        options?: Record<string, any>;
    }>;
}
```

### Methods

```typescript
// Indexes
schema.addIndex(fields: Record<string, 1 | -1>, options?: Record<string, any>): this
schema.addUniqueIndex(fields: Record<string, 1 | -1>): this
schema.addTTLIndex(field: string, options?: number): this

// Middleware
schema.pre(method: "save" | "validate" | "remove" | "deleteOne" | "updateOne", fn: (this: any, next: (err?: Error) => void) => void): this

// Methods
schema.method(name: string, fn: (this: any, ...args: any[]) => any): this
schema.static(name: string, fn: (this: Model<T>, ...args: any[]) => any): this

// Virtuals
schema.virtual(name: string, options?: Record<string, any>): this

// Compile
schema.toModel<T>(name: string): Model<HydratedDocument<T>>
```
