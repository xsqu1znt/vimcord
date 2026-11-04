# Live Discord network benchmarks

**The per-flow 3× latency target is not met.** These measurements use the real Discord REST API and gateway. Their baseline is `d6a7601`, immediately before this network optimization, rather than the original CPU benchmark baseline.

## Retained improvement

Prepared paginator pages acknowledge a component click and change the page with `interaction.update({ withResponse: true })`. The previous path awaited `deferUpdate()` and then edited the message through its sending webhook or channel. The update response supplies the latest message snapshot for navigation and timeout cleanup, without a separate fetch.

This applies to text, Discord.js/Vimcord embed builders, and container builders in static or already-loaded chapters. Unloaded chapters, page loaders, uploads (including shared send-option files), general page objects, modal submissions, and custom collect/component callbacks retain early acknowledgement. Competing clicks and no-op navigation are acknowledged without another page update. All navigation controls and chapter selection use the same path.

Human-triggered component results, 23 clean clicks per build:

| Metric | Baseline | Updated | Speedup |
| --- | ---: | ---: | ---: |
| Median latency | 734.9 ms | 457.0 ms | 1.61× |
| p95 latency | 1300.7 ms | 777.1 ms | 1.67× |
| Requests per page change | 2 | 1 | 2× fewer |
| Combined JSON request-body bytes | 355 | 363 | 2.3% more |

Fewer HTTP requests do not mean the JSON body is smaller: an interaction update wraps the edit payload. HTTP headers, TLS traffic, response bytes, and gateway traffic are not counted by the byte metric. The paginator still requests the returned message because cleanup needs its latest components. There is no additional message fetch.

The user first clicked each build in blocks, then alternated between the two messages. These are small live samples with variable network/server latency, not a controlled load test. The earlier exploratory baseline included overlapping clicks and is excluded from this comparison. [network-interactions.json](network-interactions.json) preserves every paired-session row, including one overlapping bookmarks invocation excluded from summaries.

## Harness and timing

[network.mjs](network.mjs) runs the preserved baseline and updated public command modules against the same logged-in Vimcord client, Discord.js version, REST scheduler, connection pool, guild, and channel. A third control invokes the same application handler directly, bypassing module dispatch. It retains the application's helpers, such as BetterEmbed, so it is a **dispatch-free control**, not a replacement HTTP client.

The automated suite sends nonce-tagged commands through Discord and handles their actual `messageCreate` events. Each of five applications has one warmup invocation per variant, then five measured invocations per variant, rotating baseline/current/control order:

- Utility reports bot availability.
- Economy routes `deposit 5` through a prefix subcommand, validates the amount, and updates its balance.
- Moderation checks the benchmark channel and records a test warning in memory. It does not moderate a server member.
- Support creates a formatted ticket embed.
- Bookmarks saves the harness's own resource message and returns its link.

Only the test harness permits its own bot-authored prefix commands. Normal command permissions are unchanged. Returned response content/embeds are checked. Usage formatting stays enabled; the final logger write is a sink to exclude console output and avoid printing identities.

`ms` starts when the bot receives the command event and ends after its reply and dispatch complete. A request's `ms` measures the SDK's actual HTTP call until response headers; body delivery/parsing and SDK scheduling are included in the outer command measurement. Their difference must not be described as framework CPU time. `gatewayMs` measures the harness's input-send start to gateway receipt; adding it to `ms` gives the automated send-to-reply-completion duration. These are not human UI-to-UI measurements.

The timed reply makes one REST request in each ordinary application, with one additional input-send request made by the harness outside the reply timing. Seed creation, command registration, warmups, and cleanup are excluded. Calls remain under Discord.js rate-limit scheduling. Rows with observed rate-limit waits, overlaps, failures, or incomplete navigation are retained but excluded from clean summaries. No outlier is excluded merely for being slow. With five samples, p95 is the maximum sample and has limited statistical precision.

Human slash-command invocations are smoke checks, generally one invocation per app/variant, and cannot establish a speedup. Slash bookmarks lacks a clean baseline/current pair because its baseline invocation overlapped another invocation. The automated bookmarks flow is measured separately. Message/user context-menu and modal-submit network flows were not benchmarked.

## Repeated gateway results

Five measured invocations per app/variant, after warmup. Times are milliseconds from gateway event receipt through reply completion. All rows made one reply request and none reported a rate-limit wait.

| App | Baseline p50 / p95 | Updated p50 / p95 | Control p50 | Observed p50 ratio | 3× gate |
| --- | ---: | ---: | ---: | ---: | --- |
| Utility | 520.0 / 1400.8 | 528.4 / 826.4 | 1133.9 | 0.98× | FAIL |
| Economy | 596.6 / 2846.9 | 516.5 / 1268.6 | 470.2 | 1.16× | FAIL |
| Moderation | 566.3 / 1778.9 | 482.3 / 803.4 | 543.1 | 1.17× | FAIL |
| Support | 524.5 / 859.7 | 880.7 / 1371.7 | 809.2 | 0.60× | FAIL |
| Bookmarks | 497.3 / 536.5 | 806.9 / 1189.4 | 606.4 | 0.62× | FAIL |

These ratios record this run; they do not establish framework gains or regressions. This patch does not change these ordinary reply paths. The preserved and updated bundles contain identical compiled `dispatchMessage`, prefix `dispatch`/`createModuleCTX`, BetterEmbed `send`/`toJSON`, and `dynaSend` functions. The dispatch-free control also varies substantially. A short live run cannot isolate small CPU costs through that variation, and rerunning until a favorable ratio appears would not demonstrate an optimization.

Response-body delivery and CPU time were not measured independently. In particular, much of support's additional time occurred after response headers arrived. Network variation is a plausible explanation for the higher timings, not an established cause; more randomized paired samples and separate body-delivery/CPU timing are needed to diagnose them.

[network-prefix.json](network-prefix.json) contains all 90 invocations (15 warmups, 75 measured), bundle hashes, p50/p95 summaries, automated input-send-to-reply-completion summaries, and cleanup status. The run removed its 181 public messages with no cleanup failures. Both interactive sessions also removed their temporary guild command and owned public messages. Human command invocations and other users' messages were left alone.

## Transport exploration

A read-only authenticated channel GET probe made ten requests per transport. Excluding the first request, exploratory medians were 262 ms with default fetch, 253 ms with a one-connection agent, and 275 ms with HTTP/2. This single short run provides no evidence of a substantial transport gain. Vimcord retains Discord.js transport defaults.

Ordinary replies already use one REST request. Eliminating local dispatch cannot remove that request or Discord's server response time. A 3× gain for these flows would require a major reduction in network/server latency; this change does not provide that. No required reply, rate-limit handling, permission restriction, or upload acknowledgement was removed to force the target.

## Reproduce

Build and preserve the baseline before changing code, using the same lockfile and toolchain. Keep it under `packages/vimcord/node_modules/.cache/` so its dependencies resolve normally, then build the updated package. This checkout retains the network baseline at `node_modules/.cache/vimcord-network-baseline/index.mjs` relative to the Vimcord package.

Configure these environment variables without putting a credential or real guild/channel IDs in source:

```bash
VIMCORD_BENCH_TOKEN_FILE=/private/path/to/token
VIMCORD_BENCH_GUILD_ID=<dev-guild-id>
VIMCORD_BENCH_CHANNEL_ID=<dev-channel-id>
VIMCORD_BENCH_BASELINE=/absolute/path/to/preserved/index.mjs
VIMCORD_BENCH_SAMPLES=5
```

Export them in the shell, then run from the repository root:

```bash
pnpm --filter vimcord bench:network /absolute/path/to/results.json
```

Set `VIMCORD_BENCH_REQUIRE_3X=1` to fail the process when any measured group misses the per-group target. `targetMet` and every group's `passes3x` are reported regardless. A group lacking either comparison build cannot pass.

For human interactions, set `VIMCORD_BENCH_SAMPLES=0` and `VIMCORD_BENCH_INTERACTIVE_MS=900000`. The harness creates `/vimcord-net` only in the configured guild, refuses to overwrite an existing command with that name, and accepts slash commands only in the configured channel. Invoke `app:pagination variant:baseline` and `variant:current`, then alternate clicks while waiting for each page change. The other application choices exercise slash replies. SIGINT/SIGTERM stops the session and runs cleanup.

The harness deletes only command/message IDs it created, never channel history, other commands, or users' command messages. Where permitted, cleanup batches its own known message IDs without fetching history. Raw output contains timings, counts, payload sizes, and bundle hashes, without credentials, interaction tokens, or guild/channel identities.

## Verification

422 tests across 27 files, workspace type checks, and all package builds pass. Paginator coverage includes prepared text/embed/container pages, retained response snapshots, all navigation actions, chapter selection, ephemeral flags, competing clicks, failed updates, lazy loads, shared files, uploads exceeding three seconds, custom callbacks, and timeout cleanup. The routed/legacy collector integration fixture supplies the real Discord interaction type predicate.
