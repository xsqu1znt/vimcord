# Prompts

`promptMessage` sends confirmation buttons and waits for a decision. It always returns the final message with a status.

```ts
import { ButtonBuilder, ButtonStyle } from "discord.js";
import { promptMessage } from "vimcord";

const result = await promptMessage(interaction, {
    content: "Delete this draft?",
    extraButtons: [new ButtonBuilder().setCustomId("draft:archive").setLabel("Archive instead").setStyle(ButtonStyle.Secondary)],
    onResolve: ({ status }) => ({ action: "disable", content: `Decision: ${status}` })
}, { flags: "Ephemeral" });
if (result.status === "confirmed") await deleteDraft();
if (result.status === "custom" && result.customId === "draft:archive") await archiveDraft();
```

| Option | Meaning | Default |
| --- | --- | --- |
| `participants` | Users, members, IDs, or `"anyone"` | Inferred from target trigger |
| `content` | Message text | Send options' content |
| `embed` | Embed displayed above buttons | Global prompt title and description |
| `buttons.confirm`, `.reject` | Builders or callbacks overriding decision buttons | Global prompt buttons |
| `extraButtons` | Up to three extra buttons, each with a custom ID | `[]` |
| `idle` | End after no accepted click for this many milliseconds | Global `defaultIdle` (`60_000`) |
| `timeout` | Absolute duration; cannot combine with idle | None |
| `onResolve` | Action or callback receiving the result | `"disable"` |

The third argument accepts [send options](dyna-send.md). Prompts force a returned message for collection. [Participant rules](collector.md#participants) require explicit access for guild channels, edits, and replies to bot messages; an empty list permits nobody. Extra buttons cannot use reserved IDs `prompt:confirm` or `prompt:reject` and always resolve the prompt.

| Result status | Meaning |
| --- | --- |
| `confirmed` | Confirm was pressed |
| `rejected` | Reject was pressed |
| `custom` | An extra button was pressed; `customId` identifies it |
| `timeout` | No decision before collection ended, including external stops |

The result contains `message` in every case. `onResolve` may return `"disable"`, `"clear"`, `"delete"`, `"keep"`, or `{ action, ...messageEdit }`. Final content and cleanup happen together. If the message was deleted, resolution callbacks still run and editing is skipped.

## Global appearance

| Setting | Default |
| --- | --- |
| `prompt.defaultTitle` | `"Confirmation Required"` |
| `prompt.defaultDescription` | `"Please confirm or reject this action."` |
| `prompt.buttons.confirm` | Green Confirm button |
| `prompt.buttons.reject` | Red Reject button |
| `prompt.highlightSelectedButton` | `false` |

Configure these with the client's `ux.prompt` option. Highlighting applies when the resolution action disables components. Use [BetterModal](modal.md) when the answer needs typed text or selections.
