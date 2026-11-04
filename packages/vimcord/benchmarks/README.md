# Bot application benchmarks

The **3× latency target in every scenario is not met**: 3 of 10 scenarios pass. The minimum speedup is **1.76×**. `bench:compare` exits with status 1 whenever any scenario misses the target; combined averages do not determine acceptance.

Every scenario allocates at least **3.00× fewer promises**. This is a resource improvement, not a substitute for the latency target.

## Applications and protocol

[apps.mjs](apps.mjs) runs five bot applications through built Vimcord package exports and public command dispatchers:

- Utility: `/uptime`, returning bot status.
- Economy: `!bank deposit 5`, with state, positive-amount validation, aliases, and a balance subcommand.
- Moderation: `/mod warn user reason`, with an allowlist, a command condition, routing, warning state, and an ephemeral response.
- Support: `/ticket open`, with route-specific deferral and a formatted embed through `BetterEmbed.send()` and `dynaSend()`.
- Bookmarks: alternating message and user context commands, saving a message or returning a profile.

The fixture code, application state changes, and transport behavior are identical for baseline and current builds. The transport serializes payloads and counts sends/deferrals. Every application verifies its state and output before and after timing. No gateway, REST request, or database is contacted. Usage logging is measured off and on; its output goes to a sink, excluding console formatting and I/O. These are local processing measurements, not Discord round-trip latency.

Each scenario warms up for 5,000 commands, then measures nine samples of 20,000 commands. Three fresh-process repetitions alternate baseline/current order. The table reports the median of the three sample medians. A separate 100-command `async_hooks` pass counts promise allocations without affecting timings. Counts include the handler, transport, harness await, and Vimcord.

## Recorded results

Baseline: `c40fe1ff023388db82b5dc5063db27a32d1cd705`. Node `v22.23.1`, AMD Ryzen 5 8645HS w/ Radeon 760M Graphics.

| Application | Logging | Baseline µs | Updated µs | Speedup | Promises/command | 3× gate |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| utility | off | 2.057 | 0.563 | 3.65× | 22 → 3 | pass |
| economy | off | 1.990 | 1.103 | 1.80× | 14 → 3 | FAIL |
| moderation | off | 2.726 | 1.036 | 2.63× | 26 → 4 | FAIL |
| support | off | 27.124 | 2.304 | 11.77× | 30 → 10 | pass |
| bookmarks | off | 1.733 | 0.816 | 2.12× | 20 → 3 | FAIL |
| utility | on | 2.589 | 0.869 | 2.98× | 24 → 3 | FAIL |
| economy | on | 2.351 | 1.333 | 1.76× | 16 → 3 | FAIL |
| moderation | on | 3.091 | 1.320 | 2.34× | 28 → 4 | FAIL |
| support | on | 25.950 | 2.538 | 10.22× | 32 → 10 | pass |
| bookmarks | on | 2.124 | 1.000 | 2.12× | 22 → 3 | FAIL |

The equal-count batch improves **5.57×**, and the geometric mean is **3.21×**. Support contributes most of the batch saving. Neither aggregate result satisfies the per-scenario target. Earlier exploratory comparisons against saved timings were optimistic because the original build also runs faster under the conditions of these fresh paired runs.

Send counts remain one per command. Support still defers once; the other scenarios do not defer. Discord request count and wire payload size have not been reduced.

## Simplification retained

Across the original baseline and this follow-up, runtime source shrinks by a net **247 lines**, excluding tests, documentation, and the benchmark harness.

- Command dispatch reaches the module directly, without private slash/context dispatch wrappers or a separate async usage-logging frame.
- Unconfigured built-in commands reach their handler directly. Configured conditions, permissions, hooks, deferral, concurrency control, readiness waits, deployment rules, verbose logging, and subclass overrides retain the full pipeline.
- Conditions remain synchronous until one actually returns a promise. Command and route conditions share one sequencer, including failure indexing and rejection handling.
- Direct handlers build only their normal context. Hook metadata is attached when the full pipeline or error handling needs it. Hook and handler contexts share the same invocation object by default.
- Execution timing stays in the invocation, eliminating the timing WeakMap and its separate async measurement wrapper. Execute-only logging uses two monotonic clock reads, with no delivery clock or total-timing work. Deferral occurs before handler timing.
- Command names and prefix aliases use their existing lookup maps directly. Prefix subcommands avoid the extra handler-forwarding method, and their no-options argument splitting avoids normalization/filtering work.
- `BetterEmbed` produces API embed data directly, bypassing intermediate builder validation. `dynaSend` forwards supplied options rather than reconstructing seven payload variants. Embed and container sends return its promise directly.
- `commands.mount()` replaces manual listeners and dispatch-only event modules. Remounting replaces its own listeners; unmounting and client cleanup remove them.

[routing.mjs](routing.mjs) measures setup at **62 → 17 lexical tokens (3.65×)**, or seven formatted lines to one. This measures routing boilerplate, not human productivity or total bot authoring effort.

## Remaining gap and profiling

Economy remains the weakest case. CPU profiles identify reply serialization, garbage collection, prefix-context construction, tokenization, and dispatch as its remaining costs. A throwaway application-only probe measured about 619 ns per command; a stripped router using the same handler measured about 789 ns. The fresh paired baseline's economy/off target is 663 ns. Those probes are diagnostics, not a mathematical lower bound or a replacement for the public-API benchmark.

Additional local cuts flattened out. Parser-offset plumbing was removed after it failed to demonstrate a useful gain; the original three-argument prefix invocation remains intact. No fixture was weakened, transport work skipped, logging disabled, or timing threshold relaxed to make the gate pass. Further work must demonstrate improvement in these same per-scenario measurements.

## Compatibility and verification

The original command options, routing, hooks, permissions, manual dispatch, concurrency control, and deferral are retained. Intentional changes and subclass considerations:

- `testCommandPermissions()` and protected readiness/test stages may return immediately; use `await` rather than assuming `.then()` is available. Protected `testConditions()` may return a plain test result.
- Omitted protected `permissions` is now `undefined`; subclass code should use optional access.
- Hooks see the same invocation context as the handler by default. Existing custom context factories remain supported, including route-specific deferral when factories copy contexts.
- Embed text-length and URL validation occurs at Discord instead of in `EmbedBuilder`. Color resolution and the 25-field limit remain local; timestamp zero serializes as the Unix epoch.
- Usage-record `durationMs` is populated when pipeline timing is requested. The displayed execute timing remains available with execute-only logging.
- `mount()` is opt-in; do not also install manual dispatch listeners for the same events.

Validation: **411 tests across 25 files, workspace type checks, and all package builds pass**. Added coverage checks synchronous/asynchronous condition sequencing, direct handlers returning thenables, rejection timing, configuration changes between invocations, and prefix whitespace/aliases/hook arguments.

## Run

From the repository root:

```bash
pnpm --filter vimcord build
pnpm --filter vimcord bench
pnpm --filter vimcord bench:compare /absolute/path/to/baseline/index.mjs
```

Build the baseline revision with the same lockfile and toolchain, keeping its ESM bundle where Node can resolve the same Discord.js dependencies. This checkout retains the original bundle at `packages/vimcord/node_modules/.cache/vimcord-baseline/index.mjs`. It is ignored, so bundled code is not duplicated in source control.

[results.json](results.json) contains every repetition, min/median/max samples, environment metadata, bundle hashes, and acceptance status. `compare.mjs` records the baseline commit; update it deliberately when changing the reference revision. The ordinary benchmark prints observations; the comparison command enforces the explicit per-scenario 3× target.
