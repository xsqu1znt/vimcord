---
"vimcord": patch
---

Paginator navigation no longer times out on slow pages ([#49](https://github.com/xsqu1znt/vimcord/pull/49)). Arrow buttons, chapter selection and jump-modal submissions acknowledge the interaction with `deferUpdate()` before preparing the next page or attachment, then edit the existing message.
