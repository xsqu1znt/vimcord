---
"@vimcord/plugin-mongoose": patch
---

Include configured timestamp fields in hydrated documents and `create().toObject()` return types, preserving default names and disabled timestamp settings. Respect explicit `_id` exclusion in `update()` and `upsert()` projections and infer its absence for literal object projections in lean and hydrated results.

Add `TransactionAbort`, `abort()`, `tryTransaction()`, and `TransactionResult<T>` so expected transaction failures return a typed result after rollback. Unexpected errors rethrow unless a fallback message is supplied, in which case the original error is logged.
