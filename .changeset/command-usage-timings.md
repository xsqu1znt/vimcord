---
"vimcord": minor
---

Add `globals.app.commandLogging` to select delivery, pre-execute, execute, and total command timings in display order. Usage logs now default to execute-only timing and omit guild IDs. Execute timing excludes automatic deferral and includes awaited prompts. `false` or an empty array disables logging by default; explicit per-command `metadata.logUsage: true` opts back in with execute timing, while `false` always suppresses that command.
