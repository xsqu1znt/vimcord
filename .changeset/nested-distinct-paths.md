---
"@vimcord/plugin-mongoose": minor
---

Add typed dotted schema paths to `MongoSchemaBuilder.distinct()`. Nested object and array paths now infer their distinct value types, so `distinct("asset.imageUrl")` returns `string[]` for a string field while invalid paths remain type errors.
