# Events

Default-export an `EventModule` from an event directory. `login()` loads and mounts it. Discord.js event names and argument tuples remain unchanged, except `clientReady` has no arguments because the client is already in context.

```ts
import { EventModule } from "vimcord";

export default new EventModule({
    name: "ready-log",
    event: "clientReady",
    once: true,
    execute({ client }) { client.logger.success(`Ready as ${client.user?.tag}`); }
});
```

```ts
import { EventModule } from "vimcord";

export default new EventModule({
    event: "guildMemberAdd",
    execute({ client, args: [member] }) { client.logger.info(`${member.user.tag} joined ${member.guild.name}`); }
});
```

| Option | Meaning | Default |
| --- | --- | --- |
| `name` | Module name in logs and `getByName`; names need not be unique | The event name |
| `event` | Discord.js client event | Required |
| `execute` | Handler receiving `{ client, args }` | Required |
| `once` | Unregister after its first event | `false` |
| `id` | Stable module ID | Generated human-readable ID |
| `enabled` | Permit invocation | `true` |
| `requiresReady` | Wait for client readiness | `false` |
| `environment` | Allowed bot environment | `"both"` |
| `metadata` | Category, tags, or augmented fields | `{}` |
| `singleInvocation` | `{ key: ctx => string }` to skip overlapping work | Disabled |
| `hooks` | `before`, `onBlocked`, and `onError` | None |

Events share the [module hook lifecycle](commands.md#hooks) but do not use global command hooks or command permissions. Event context's client may not be ready. Modules are unmounted when the client is destroyed.
