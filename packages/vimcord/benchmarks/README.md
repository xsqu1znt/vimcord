# Bot application benchmarks

This harness runs five small bot applications through Vimcord's public command managers, using built package exports rather than private helpers. The applications live in [apps.mjs](apps.mjs):

- Utility: `/uptime`, replying with the bot's status.
- Economy: `!bank deposit 5`, with balance state, positive-amount validation, aliases, and a balance subcommand.
- Moderation: `/mod warn user reason`, with an allowlist, a command condition, routing, warning state, and an ephemeral response.
- Support: `/ticket open`, with route-specific deferral and a formatted embed sent through `BetterEmbed.send()` and `dynaSend()`.
- Bookmarks: alternating message and user context commands, saving a message or returning a profile.

The Discord transport is offline. It serializes outgoing payloads and records send/deferral counts. Every application verifies its response and state before and after timing. No token, gateway connection, REST request, or database is needed. This measures local command handling, not Discord round-trip latency. Usage logging is measured both off and on; the logger output is replaced with a sink, so console formatting and I/O are excluded.

## Recorded result

Baseline: `c40fe1ff023388db82b5dc5063db27a32d1cd705`. Node `v22.23.1`, AMD Ryzen 5 8645HS w/ Radeon 760M Graphics.

Each scenario warms up for 5,000 commands, then measures nine samples of 20,000 commands. The comparison alternates baseline/current order across three repetitions in fresh processes. The table reports the median of those three sample medians. Promise allocations use a separate 100-command `async_hooks` pass so instrumentation does not affect timings. Counts include the handler, transport, and harness await as well as Vimcord.

| Application | Usage logging | Baseline µs | Updated µs | Speedup | Promises/command |
| --- | --- | ---: | ---: | ---: | ---: |
| utility | off | 2.735 | 1.148 | 2.38× | 22 → 8 |
| economy | off | 2.592 | 2.136 | 1.21× | 14 → 8 |
| moderation | off | 3.680 | 1.955 | 1.88× | 26 → 15 |
| support | off | 30.886 | 3.256 | 9.49× | 30 → 15 |
| bookmarks | off | 2.451 | 1.487 | 1.65× | 20 → 8 |
| utility | on | 3.810 | 1.941 | 1.96× | 24 → 10 |
| economy | on | 3.296 | 2.689 | 1.23× | 16 → 10 |
| moderation | on | 4.191 | 2.762 | 1.52× | 28 → 17 |
| support | on | 32.676 | 4.605 | 7.10× | 32 → 17 |
| bookmarks | on | 3.022 | 2.333 | 1.30× | 22 → 10 |

An equal-count batch containing all ten scenarios takes **3.67× less local processing time**. This is the sum of baseline median times divided by the sum of updated median times; the expensive support application contributes most of the saving. The geometric mean of individual speedups is **2.22×**. Individual scenarios do **not** all reach 3×. Threefold local processing improvement does not imply threefold improvement to bots dominated by network or database waits.

Every scenario still sends exactly once per command. Support still defers once; other scenarios do not defer. There is no measured reduction in Discord request count or wire payload size.

Routing setup in [routing.mjs](routing.mjs) shrinks from **62 to 17 TypeScript lexical tokens (3.65×)**, or seven formatted lines to one. Both versions enable application and prefix commands and reject bot invocations with the default permissions. This is a narrowly defined authoring proxy, not a measurement of human task completion time or total application size. The complete application fixture code is unchanged between runtime comparisons.

The runtime source changes remove a net **307 lines**, excluding tests, documentation, and this harness.

## What was simplified

- Slash, prefix, and both context-menu command dispatch go directly from lookup to module execution, without separate private dispatch wrappers or per-request callbacks.
- Module readiness and local deployment/permission checks return immediately. Asynchronous conditions and remote staff lookups retain their asynchronous behavior. Empty async stages no longer produce promises.
- Built-in event and command modules share one invocation context instead of cloning a second hook context. Slash routes store their path on that invocation instead of maintaining a WeakMap and a shared route-selection object.
- Deferral and handler timing share one command entry point. Context menus no longer duplicate async execution wrappers. Disabled command logging skips its clocks and timing data.
- `BetterEmbed` writes API embed data directly, bypassing the intermediate builder and repeated validation. Colors, tokens, timestamps, field limits, and independent serialization remain supported.
- `dynaSend` forwards supplied data instead of rebuilding seven payload variants. It retains target selection, flag filtering, response extraction, and deletion scheduling. Embed and container sends return its promise directly.
- `commands.mount()` connects Discord.js events directly to dispatch. Remounting replaces its own listeners; unmounting and module/client cleanup remove them. It replaces both manual listeners and dispatch-only event modules in the package examples.

## Compatibility notes

Existing command options, routes, hooks, manual dispatch methods, permission rules, logging selection, and concurrency control remain supported. The intentional changes are:

- `testCommandPermissions()` and protected readiness/test stages may return immediately. Use `await`, rather than assuming every result has `.then()`.
- Built-in hooks and handlers see the same invocation context, so hook mutations are visible to the handler. Custom context factory overrides remain supported.
- Embed text-length and URL validation occurs at Discord rather than in `EmbedBuilder`. Invalid data can fail later, during the request. Color resolution and the 25-field limit remain local. Timestamp zero now serializes as the Unix epoch.
- `mount()` is opt-in. Do not also install manual command dispatch listeners for the same events.

## Run

From the repository root:

```bash
pnpm --filter vimcord build
pnpm --filter vimcord bench
pnpm --filter vimcord bench:compare /absolute/path/to/baseline/index.mjs
```

Build the baseline revision with the same lockfile and toolchain, and keep its ESM bundle somewhere Node can resolve the same Discord.js dependencies. During this task the original bundle was saved to `packages/vimcord/node_modules/.cache/vimcord-baseline/index.mjs`; that ignored local copy can be used to repeat the comparison in this checkout. Bundled code is not duplicated in source control.

[results.json](results.json) contains all repetitions, per-run min/median/max samples, environment details, and SHA-256 hashes of the two bundles. The baseline commit in `compare.mjs` identifies the recorded starting revision; update it when deliberately recording another baseline. Ordinary runs never fail a noisy timing threshold. Structural behavior is covered by the command, permission, module, embed, and transport tests.
