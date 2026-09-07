---
"vimcord": minor
---

Add `resolveOnAdditionalButton` to `promptMessage`, letting an extra button end the prompt like confirm and reject do.

Turn it on and a press of any button in `additionalButtons` resolves the prompt with `status: "custom"` and `customId` set to the button that was pressed. `onCustom` picks the resolve action, defaulting to `ResolveAction.DeleteMessage` like the other three. With `highlightSelectedButton` on, the pressed button keeps its style and both confirm and reject grey out.

The flag is off by default, so callers driving extra buttons through `onCollector` keep their current behavior. An additional button using the reserved `prompt:confirm` or `prompt:reject` custom ID now throws at build time.
