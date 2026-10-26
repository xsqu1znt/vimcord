---
"@vimcord/plugin-mongoose": patch
---

Keyed updates keep unrelated cache entries ([#47](https://github.com/xsqu1znt/vimcord/pull/47)). `update()`, `upsert()`, `updateOne()` and `updateAll()` now invalidate only the pinned cache key when the update leaves that path untouched, so frequent writes to one document no longer evict cached reads for others. Key changes, overlapping paths, `$rename` destinations, collations and document-replacing pipelines still clear the whole cache.
