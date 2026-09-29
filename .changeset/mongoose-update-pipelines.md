---
"@vimcord/plugin-mongoose": minor
---

`MongoSchemaBuilder.update()` now accepts aggregation update pipelines and a `returnDocument` option (`"before"` or `"after"`, default `"after"`). Pipelines enable Mongoose's `updatePipeline` option automatically. The result type is nullable unless the call is an upsert that returns `"after"`, so `{ upsert: true, returnDocument: "before" }` returns `null` when it inserted.
