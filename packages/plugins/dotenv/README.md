# @vimcord/plugin-dotenv

Loads env files through Vimcord's plugin lifecycle before the bot token and later plugins read environment variables.

```sh
pnpm add @vimcord/plugin-dotenv vimcord discord.js
```

```ts
import { GatewayIntentBits } from "discord.js";
import { Vimcord } from "vimcord";
import { DotEnvPlugin } from "@vimcord/plugin-dotenv";

const client = new Vimcord({
    intents: [GatewayIntentBits.Guilds],
    plugins: [new DotEnvPlugin()]
});
await client.login();
```

The constructor accepts dotenv's `DotenvConfigOptions`, including `path` and `override`. Loading uses `quiet: true` unless you override it. Put this plugin before plugins that read environment variables, or declare `dependencies = ["dotenv"]` on your own plugin.

Vimcord reads `TOKEN`, or `TOKEN_DEV` in dev mode. The Mongoose plugin similarly reads `MONGO_URI` or `MONGO_URI_DEV`. This plugin loads variables; it does not validate them or choose the client's dev mode. Set devMode in client options or pass `--dev` to the process.

[Vimcord plugin lifecycle](https://github.com/xsqu1znt/vimcord/blob/main/packages/vimcord/docs/plugins.md).
