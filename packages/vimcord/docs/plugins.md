# Writing plugins

Extend `VimcordPlugin`, declare its identity, and pass an instance in the client's `plugins` array. Dependencies name other registered plugins; missing names and cycles fail at client construction.

```ts
import type { VimcordPluginContext } from "vimcord";
import { VimcordPlugin } from "vimcord";

export class MetricsPlugin extends VimcordPlugin {
    name = "metrics";
    override description = "Reports in-process metrics health.";
    override version = "1.0.0";

    install({ health }: VimcordPluginContext): void {
        health.register({
            id: "metrics",
            label: "Metrics",
            timeout: 1000,
            check: ({ signal }) => ({ status: signal.aborted ? "unavailable" : "healthy" })
        });
    }
}
```

| Member | Purpose | Default |
| --- | --- | --- |
| `name` | Plugin identity, dependency key, and discovery | Required |
| `description`, `version` | Shown in `/plugins`; missing ones show `—` | None |
| `dependencies` | Plugin names installed first | None |
| `install(context)` | Acquire resources; throw if startup cannot continue | Required |
| `onPluginsInstalled(context)` | Work requiring all plugins, before modules/gateway | No work |
| `uninstall()` | Release resources during failure cleanup or destruction | No work |

`VimcordPluginContext` contains `client` and `health.register(probe)`. Install runs in dependency order, and uninstall in reverse. `login()` runs the installed step after token validation. Registered plugins survive an unload so failed login can retry; health probes are removed automatically. Release partial resources if your own install throws before completing.

Use `client.plugins.get<MyPlugin>("name")` for a registered plugin, or `get<MyPlugin>("name", true)` to require it installed. `getAll`, `has`, and `isInstalled` provide discovery. Registration belongs in the constructor's array.

## Health probes

| Probe field | Meaning | Default |
| --- | --- | --- |
| `id` | Client-wide unique identifier | Required |
| `label` | Human-readable service name | Required |
| `timeout` | Maximum duration in milliseconds | `2000` |
| `check({ client, signal })` | Sync/async `HealthProbeResult` | Required |

Return `{ status: "healthy" | "degraded" | "unavailable", latencyMs?, detail? }`. Respect the abort signal where possible; it fires on timeout or when the CLI command stops. `/ping` reports registered probes alongside Discord health.

Official plugins are [dotenv](https://www.npmjs.com/package/@vimcord/plugin-dotenv) for environment loading and [Mongoose](https://www.npmjs.com/package/@vimcord/plugin-mongoose) for an isolated database connection, inferred builders, and startup migrations.
