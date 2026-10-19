---
"@vimcord/plugin-mongoose": patch
---

Respect explicit `_id` exclusion in `update()` and `upsert()` inclusion projections. Literal object projections with `_id: 0` or `_id: false` also omit `_id` from the inferred return type for lean and hydrated results.
