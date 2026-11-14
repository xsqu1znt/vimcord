# Modals

Chain `BetterModal` input methods so each custom ID becomes a typed field on the result. Every input requires a unique `customId` and a `label`. Use a command or component interaction that can show a modal, before deferring or replying to it.

```ts
import { BetterModal } from "vimcord";

const modal = new BetterModal({ title: "Edit profile" })
    .addTextInput({ customId: "bio", label: "Bio", maxLength: 200 })
    .addStringSelect({ customId: "theme", label: "Theme", options: [
        { label: "Light", value: "light" }, { label: "Dark", value: "dark" }
    ] });
const result = await modal.showAndAwait(interaction);
if (result) {
    const bio: string = result.fields.bio;
    const themes: readonly string[] = result.fields.theme;
    await result.reply({ content: `${bio} (${themes.join(", ")})`, flags: "Ephemeral" });
}
```

| Constructor option | Meaning | Default |
| --- | --- | --- |
| `customId` | Modal submission route | Generated random ID |
| `title` | Modal title | Required before showing |

| Method | Submitted field |
| --- | --- |
| `addTextInput` | `string`; Short style and required false unless overridden |
| `addStringSelect` | `readonly string[]` |
| `addCheckbox` | `boolean` |
| `addCheckboxGroup` | `readonly string[]` |
| `addRadioGroup` | `string \| null` |
| `addUserSelect` | Discord.js user collection |
| `addRoleSelect` | Discord.js role collection |
| `addChannelSelect` | Discord.js channel collection |
| `addMentionableSelect` | Resolved users, members, and roles collections |
| `addFileUpload` | Discord.js attachment collection |
| `addTextDisplay` | No field; display content only |

Inputs accept their Discord.js component data plus `label`, optional `description`, and camelCase `customId`, including inputs backed by raw API component shapes. Empty selections return empty collections or arrays. A radio group with no selection returns null. Discord allows at most five top-level modal components; duplicate input IDs throw.

`setTitle()` changes the title; `clone()` copies the modal and its typed readers; `toJSON()` returns Discord API data. Keep builder calls chained or assign their returned builder so TypeScript retains the new field keys.

## Submission

`show(interaction)` displays without waiting. `showAndAwait(interaction, options?)` displays and waits. `awaitSubmit(interaction, options?)` waits after a separate show.

| Await option | Meaning | Default |
| --- | --- | --- |
| `timeout` | Milliseconds to wait | Global `modal.timeout` (`60_000`) |
| `deferUpdate` | Defer the submitted interaction before returning | `false` |

A timeout returns null; other errors propagate. Results contain `interaction`, typed `fields`, `reply(options)`, and `followUp(options)`. Reply uses inferred delivery; a fresh reply returns null unless withResponse is true. Follow-up returns a message. For a text confirmation form, read and validate `result.fields` yourself.
