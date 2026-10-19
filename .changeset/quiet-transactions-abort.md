---
"@vimcord/plugin-mongoose": patch
---

Add `TransactionAbort`, `abort()`, `tryTransaction()`, and `TransactionResult<T>` so expected transaction failures return a typed result after rollback. Unexpected errors rethrow unless a fallback message is supplied, in which case the original error is logged.
