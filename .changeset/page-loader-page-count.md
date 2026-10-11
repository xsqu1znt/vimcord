---
"vimcord": minor
---

Page loaders receive a `setPageCount(count)` context so a paginator can follow data that changes while it's open. When the requested page no longer exists, the new last page loads instead of an empty one.
