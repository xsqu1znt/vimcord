# @vimcord/plugin-mongoose

[![npm](https://img.shields.io/npm/v/@vimcord/plugin-mongoose)](https://www.npmjs.com/package/@vimcord/plugin-mongoose)

A plugin-owned Mongoose connection for Vimcord, with inferred schema builders, lean reads, transactions, optional caching, and run-once startup migrations. Use raw Mongoose models when a builder method does not fit.

## Install

```sh
pnpm add @vimcord/plugin-mongoose vimcord discord.js
```

## Start

```ts
import { GatewayIntentBits } from "discord.js";
import { Vimcord } from "vimcord";
import { createMongoSchema, MongoosePlugin } from "@vimcord/plugin-mongoose";

const Users = createMongoSchema("users", {
    userId: { type: String, required: true },
    points: { type: Number, default: 0 }
}).index({ userId: 1 }, { unique: true });

const client = new Vimcord({
    intents: [GatewayIntentBits.Guilds],
    plugins: [new MongoosePlugin()]
});
await client.login();
const user = await Users.fetch({ userId: USER_ID });
```

Provide `TOKEN` and `MONGO_URI` through your process environment, or load them with the dotenv plugin. Dev mode selects `TOKEN_DEV` and `MONGO_URI_DEV`. Register indexes and migrations before login; access models after the database plugin installs.

## Guide

[Connection options, schemas, reads and writes, caching, transactions, and migrations](docs/mongoose.md).

[Migration from plugin 1 to 2](https://github.com/xsqu1znt/vimcord/blob/main/packages/vimcord/docs/migration/v5.md#mongoose-plugin-1-to-2).

[Vimcord docs](https://github.com/xsqu1znt/vimcord/blob/main/packages/vimcord/docs/index.md).
