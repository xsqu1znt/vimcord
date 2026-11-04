# Usage logging optimization

Full local logging overhead falls **80–82%** across the five bot applications, from **3.10–3.32 µs** to **0.55–0.67 µs** per command. Logging-off timings remain roughly unchanged. In the existing dispatch-only benchmark, logging-on speedups are now within about **11%** of logging-off speedups across all five apps.

## What changed

- Direct commands build the final usage record without an intermediate `ModuleRunResult`, timing object, or extra completion closure. The full optional module pipeline retains its existing result reporting.
- Execute-only logging avoids generic timing-list mapping and unused timing-selection work. Other selections keep their ordering, duplicates, unavailable values, and error timing.
- `VimcordLogger.commandUsed()` reuses fixed label styles and builds one output-parts array. It refreshes styles when palette values change.
- The shared `Logger` reuses the locale-formatted timestamp within each wall-clock second, then caches its rendered color per logger. Prefix text is reused until the prefix or its color changes. Clock corrections and palette mutations remain visible.

The caches hold only the current timestamp, prefix, and fixed styles. They do not accumulate command names, users, guilds, or log entries. Timestamp/prefix reuse also applies to ordinary logs, debug/info/success/warn/error output, module/plugin output, and loader lines through the shared logger.

## Measurement boundaries

Reference: `e3492839159a5b4e6ecc75464e553b4ccb37b7d8`, immediately before this logging pass. Node `v22.23.1`, AMD Ryzen 5 8645HS w/ Radeon 760M Graphics. The recorded ANSI level is `0`. Color correctness is separately tested with ANSI level 3 forced.

The same five [bot applications](apps.mjs), reply serialization, handlers, sends, and deferrals run before and after. Three fresh-process repetitions alternate baseline/current order. Each scenario warms up for 5,000 commands and measures nine samples of 20,000 commands. Values below are medians of the three run medians.

Two sinks distinguish costs:

- `record`: replaces `commandUsed()`, retaining only timing and structured-record construction. This preserves the existing benchmark's measurement boundary.
- `write`: executes the real usage formatter, timestamp, and prefix code; replaces the final protected `write()` method. Console I/O, console argument formatting, and terminal-loader rendering are excluded.

Every repetition verifies exactly one usage log for logging-on, zero for logging-off, one send per command, and the unchanged deferral count. The timestamp caches benefit sustained traffic within each second; cold first-log cost is outside the warmed measurements.

## Full local logging, including formatting

All values are µs per command. Extra cost is logging-on minus logging-off. This includes bookkeeping and formatting, not just the formatter in isolation.

| Application | Before off | Before on | After off | After on | Extra cost before → after | Reduction |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| utility | 0.602 | 3.905 | 0.606 | 1.271 | 3.303 → 0.665 | 79.9% |
| economy | 1.170 | 4.272 | 1.168 | 1.720 | 3.102 → 0.552 | 82.2% |
| moderation | 1.119 | 4.383 | 1.103 | 1.737 | 3.264 → 0.634 | 80.6% |
| support | 2.437 | 5.753 | 2.369 | 3.023 | 3.316 → 0.654 | 80.3% |
| bookmarks | 0.847 | 4.037 | 0.848 | 1.416 | 3.190 → 0.568 | 82.2% |

## Timing and record construction alone

Extra cost in ns per command, with the actual formatter bypassed. These smaller differences are more sensitive to ordinary run variation; moderation's absolute logging-on time is essentially unchanged.

| Application | Before extra ns | After extra ns | Reduction |
| --- | ---: | ---: | ---: |
| utility | 301 | 254 | 15.6% |
| economy | 201 | 104 | 48.3% |
| moderation | 218 | 206 | 5.5% |
| support | 219 | 175 | 20.1% |
| bookmarks | 171 | 110 | 35.7% |

## Logging-on versus logging-off gains against the original framework

The refreshed [original-baseline comparison](results.json) still uses the `record` sink. Each column compares the original framework with the updated framework using the same logging setting; these are speedup factors, not the ratio of logging-on latency to logging-off latency.

| Application | Logging off speedup | Logging on speedup |
| --- | ---: | ---: |
| utility | 3.34× | 3.13× |
| economy | 1.77× | 1.88× |
| moderation | 2.49× | 2.38× |
| support | 11.58× | 10.31× |
| bookmarks | 2.08× | 2.25× |

The broader 3× target for every scenario remains unmet: 4/10 scenarios pass. This logging pass preserves that acceptance gate.

## Verification and reproduction

All **417 tests across 27 files**, workspace type checks, and package builds pass. Focused output/timing tests also pass with `FORCE_COLOR=3`. Coverage checks second boundaries, backward clock changes, independent logger palettes, prefix/color mutations, timing order and duplicates, unavailable timings, legacy durations, empty selections, errors, and exactly-once logging.

```bash
pnpm --filter vimcord build
pnpm --filter vimcord bench:logging /absolute/path/to/logging-baseline/index.mjs
```

This checkout retains the pre-change bundle at `packages/vimcord/node_modules/.cache/vimcord-logging-baseline/index.mjs`. Build the reference revision with the same dependencies to reproduce elsewhere, keeping the ESM bundle where Node can resolve them. [logging-results.json](logging-results.json) records every repetition, both sinks, ANSI level, log/transport counts, and bundle hashes. Its comparison is against the immediately preceding implementation; [results.json](results.json) uses the original framework baseline.
