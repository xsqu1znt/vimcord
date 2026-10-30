---
"@vimcord/plugin-mongoose": patch
---

`MongoSchemaBuilder.updateAll()` and `updateOne()` now accept an aggregation pipeline as `update` without passing `{ updatePipeline: true }`, matching `update()`. Previously `updateAll()` threw `MongooseError: Cannot pass an array to query updates unless the updatePipeline option is set`, and `updateOne()` rejected pipelines at the type level. Callers that pass the option explicitly keep working.
