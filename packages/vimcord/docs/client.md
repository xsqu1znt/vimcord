# Client

Create one `Vimcord` per process. Pass Discord.js `ClientOptions` and Vimcord settings in the same object. `Vimcord.getInstance()` returns the current client; `destroy()` releases it.

```ts
import { ActivityType, GatewayIntentBits } from "discord.js";
import { Vimcord } from "vimcord";
import { DotEnvPlugin } from "@vimcord/plugin-dotenv";

const client = new Vimcord({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    name: "Example Bot",
    plugins: [new DotEnvPlugin()],
    prefix: "!",
    modules: "./",
    ux: { embedColor: "Blue", command: { error: null } }
});
await client.status.set({ activity: { type: ActivityType.Watching, name: c => `${c.guilds.cache.size} servers` }, interval: 60_000 });
await client.login();
```

## Options

| Option | Meaning | Default |
| --- | --- | --- |
| Discord.js options | Intents, partials, caches, and other `ClientOptions` | Discord.js defaults; `intents` required |
| `name` | Name in logs and banner | `"Discord Bot"` |
| `version` | Application version | Working directory's package version, otherwise `"1.0.0"` |
| `devMode` | Development token, environment rules, and UX colors | Process `--dev` flag |
| `verbose` | Diagnostic logs | `false` |
| `commandLogging` | Fixed delivery, preparation, and execution timings | `true` |
| `cli` | Allow this client to attach to an initialized CLI | `true` |
| `banner` | Print the startup ASCII banner | `true` |
| `plugins` | Plugins installed in dependency order | `[]` |
| `modules` | A directory searched for every conventional suffix, or per-type entries | No directory imports |
| `prefix` | String, strings, or sync/async `(message) => string \| string[] \| null` | No prefix commands |
| `allowMention` | Accept a bot mention as a prefix | `false` |
| `syncCommands` | Sync application commands after readiness | `true` |
| `hooks` | Command hooks: top-level ones for every command, plus `prefix`, `slash`, and `context` | None |
| `ux` | UX defaults for embeds, collectors, paginators, prompts, modals, and command replies; see [Embeds](ux/embed.md#global-colors) | Built-in defaults |
| `staff` | Staff IDs and staff guild | No staff |

`login(token?)` installs plugins, reads the token, runs `onPluginsInstalled`, loads modules, installs command listeners, then connects. It reads `TOKEN_DEV` in dev mode and `TOKEN` otherwise. Failed login unloads acquired resources so it can be retried. Missing dependencies or dependency cycles fail at construction. Plugin startup and module import failures abort login; a command sync failure after readiness is logged without stopping the bot.

## Command sync

With `syncCommands`, readiness syncs global commands, then guild commands in the guilds that modules name in `registration.guilds`; it never walks every cached guild. Each sync creates missing commands, patches changed ones, and deletes remote commands in that scope with no loaded module, matched by name and type. A failed scope or guild is logged and the rest continue.

`/register global` and `/register guild <guilds...|all>` sync the same way. Guild targets get every matching command except those registered to other guilds. With `--names`, `--category`, or `--tag`, the push only creates and patches; nothing outside the filter is deleted. `/unregister` clears a whole scope.

`awaitReady(timeout = 60_000)` resolves to a boolean. Mutable accessors are `$name`, `$version`, `$devMode`, and `$verbose`. Changing `$devMode` also updates UX colors; reapply status to select another environment profile.

`ux` is merged over the built-in UX defaults at construction; its dev-mode flag follows `devMode`. `destroy()` restores the built-in UX defaults, so the next client starts from its own `ux`.

## Module directories

`modules: "./src"` loads every conventional suffix under that directory: `.slash` slash commands, `.prefix` prefix commands, `.mctx` message context commands, `.uctx` user context commands, and `.event` events. A type with no files is fine there; a missing directory still fails login.

For other layouts or suffixes, pass an object. Entries are `slashCommands`, `prefixCommands`, `messageContextCommands`, `userContextCommands`, and `events`. Each takes `dir: string | string[]` and a required `suffix: string | string[] | null`. Directories are relative to the entry file and searched recursively for `.ts` and `.js`, excluding `.d.ts`.

Use `.slash`, `.prefix`, `.mctx`, `.uctx`, and `.event` as conventional suffixes. Unmatched files are ignored. With `suffix: null`, every eligible file must default-export the configured module type. In the object form, a missing directory, no matches, import failure, wrong default export, or duplicate module ID fails login with the source named.

## Staff

```ts
import type { StaffOptions } from "vimcord";

const staff: StaffOptions = { users: [OWNER_ID, STAFF_ID], roles: [STAFF_ROLE_ID], guildId: STAFF_GUILD_ID };
```

| Option | Meaning | Default |
| --- | --- | --- |
| `users` | User IDs granted staff access | `[]` |
| `roles` | Role IDs checked in `guildId`; requires `guildId` | `[]` |
| `guildId` | Guild for staff roles and command access role fallbacks | `null` after resolution |

`client.isBotStaff(userId)` checks users, then configured staff roles. `client.getStaffGuildRoleIds(userId)` fetches current roles and shares concurrent lookups without retaining results. Staff access is a command grant through `access: { staff: true }`; it does not bypass other hard restrictions.

## Status

Call `client.status.set(profile)` with one profile, or `{ production, development }`. An omitted current environment clears the presence. `start()`, `pause()`, and `clear()` control rotation.

| Profile option | Meaning | Default |
| --- | --- | --- |
| `activity` | One activity or an array | Required |
| `interval` | Rotation or dynamic-name refresh interval in milliseconds | Apply once |
| `randomize` | Pick another activity at random | `false` |

Activity options are Discord.js activity fields, including `type`, `url`, and `shardId`. `name` accepts a string or sync/async function receiving a ready client; `status` defaults to `"online"`. A single fixed-name activity does not rotate. Name resolution errors are logged and leave the previous presence visible.

```ts
import { ActivityType } from "discord.js";

await client.status.set({
    production: {
        interval: 60_000,
        activity: [{ type: ActivityType.Watching, name: c => `${c.guilds.cache.size} servers` }]
    },
    development: { activity: { name: "Development" } }
});
```

## Logging

`client.logger` provides `log`, `info`, `success`, `warn`, `error`, and diagnostic `debug`. Use `setVerbose(boolean)` to change diagnostics. Command usage lines contain delivery, preparation, and handler execution timings, and only appear when the handler was reached. A failed deferral has no usage line.

```ts
import { Logger } from "vimcord";

const logger = new Logger({ prefix: "Import", verbose: true });
const loader = logger.loader("Importing records");
loader.update("Importing the next batch");
loader.succeed("Import complete");
```

| Logger option | Default |
| --- | --- |
| `prefix` | `null` |
| `verbose` | `false` |
| `colors` | `DEFAULT_COLORS`, merged with overrides |

A loader accepts `{ cycle: () => string, interval: 3000 }` for changing messages. Handles support `update`, `stop`, `succeed`, and `fail`; completion is idempotent. Animation runs only on TTY stdout. Redirected output gets ordinary start and completion lines.

## CLI

Call `setupCLI()` once to start slash-prefixed stdin commands. It attaches the current or next eligible client. `/help` lists commands; `/help command` shows usage. Built-ins are `/help`, `/version`, `/plugins`, `/modules`, `/ping`, `/stats`, `/guildinfo`, `/userinfo`, `/register`, `/unregister`, `/clear`, and `/exit`. `/exit --confirm` destroys the client and stops the CLI. This is local process input, so hosting dashboards can send one command per line.

```ts
import { getCLI, hasCLIFlag, setupCLI } from "vimcord";
import type { CLICommand } from "vimcord";

setupCLI().addCommand({
    name: "reload-config",
    description: "Reloads config from disk.",
    usage: "/reload-config [--force]",
    async execute({ client, logger, args, flags }) {
        if (!client) throw new Error("No client attached");
        await reloadConfig({ force: hasCLIFlag(flags, "force"), file: args[0] });
        logger.line(`Reloaded config for ${client.$name}`);
    }
});

const command: CLICommand = {
    name: "uptime",
    description: "Displays process uptime.",
    requiresClient: false,
    execute({ logger }) { logger.line(`${Math.floor(process.uptime())} seconds`); }
};
getCLI()?.addCommand(command);
```

| Command option | Meaning | Default |
| --- | --- | --- |
| `name` | Lowercase trigger with no slash or whitespace | Required |
| `description` | One-line help description | Required |
| `usage` | Help usage string | `/${name}` in help |
| `aliases` | Additional lowercase triggers | None |
| `requiresClient` | Reject execution without an attached client | `true` |
| `execute` | Sync/async handler receiving `CLICommandContext` | Required |

Registration throws when any name or alias collides, including built-ins and duplicates within the new command. Custom commands appear in lookup, `getAvailableCommands()`, and help. `addCommand()` returns the CLI for chaining.

Context includes `cli`, `logger`, nullable `client`, `args`, `flags`, and `signal`. Commands run serially; stopping the CLI aborts the active command's signal. Put positional args before flags. Long flags consume values until the next flag, support `--key=value`, quotes, repeated values, and lowercase names. Read them with `hasCLIFlag`, `getCLIFlagValue`, and `getCLIFlagValues`. `--client` is reserved and rejected.

`CLILogger` supports `header`, `line`, `group`, `fields`, `table`, `json`, `commandLoader`, and `failure`. `VimcordCLI` and `CLILogger` are type-only exports; obtain instances through `setupCLI()`, `getCLI()`, and the command context.
