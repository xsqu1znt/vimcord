---
"vimcord": major
---

Unify prompt, collector, and paginator resolution under `onResolve`, using the existing `ResolveAction` enum or an awaited callback returning `{ action, ...messageEditOptions }`. Apply final content and component cleanup in one message edit, preserve selected prompt button highlighting, and return the updated prompt message after the edit completes. Resolution callbacks run once; failed edits never rerun application side effects.

Breaking: replace prompt `onConfirm`, `onReject`, `onCustom`, and `onTimeout` with `onResolve` and branch on its `status` (`confirmed`, `rejected`, `custom`, or `timeout`). Rename paginator `onTimeout`, including its global default, to `onResolve`. Collector callbacks receive `message`, `reason`, and `collected`; paginator callbacks receive `message` and `reason` after pending navigation finishes. Fixed actions and existing defaults remain available. Prompt resolution errors now propagate; collector and paginator resolution errors are logged.

