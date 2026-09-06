---
"@vimcord/plugin-mongoose": patch
---

Fix `InferDoc`, `InferHydratedDoc`, and `CreateDocument` failing to compile: a type name collision with the internal document type used by `create()`, and a missing `CreateDocInput` reference.
