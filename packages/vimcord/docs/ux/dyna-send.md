# Sending messages

`dynaSend(target, options)` selects delivery from the Discord target. At least one of content, embeds, components, files, stickers, poll, or forward must be supplied.

```ts
import { MessageFlags } from "discord.js";
import { BetterContainer, BetterEmbed, dynaSend } from "vimcord";

const sent = await dynaSend(interaction, {
    embeds: [new BetterEmbed({ title: "Saved" })],
    withResponse: true
});
await dynaSend(sent, { content: "Updated", method: "edit" });
await dynaSend(interaction, { content: "One more thing", method: "followUp" });
await dynaSend(channel, { components: [new BetterContainer().addText("Ready")], flags: MessageFlags.IsComponentsV2 });
```

| Target | Inferred delivery |
| --- | --- |
| Fresh repliable interaction | Initial reply |
| Replied or deferred interaction | Edit original reply |
| Message | Reply to that message |
| Sendable text channel | Channel send |
| User or guild member | DM |

| Option | Meaning | Default |
| --- | --- | --- |
| `method` | `"followUp"` for interactions, `"edit"` for messages or interactions | Inferred |
| `content` | Message text | Omitted |
| `embeds` | Discord embeds or BetterEmbed instances | Omitted |
| `components` | Action rows, ContainerBuilder, or BetterContainer instances, or a flat list of buttons split into rows of 5 | Omitted |
| `files` | Attachments | Omitted |
| `stickers` | Discord stickers | Omitted |
| `poll` | Discord poll data | Omitted |
| `flags` | Discord message flags | Omitted |
| `withResponse` | Require the sent message to be returned | `false` |
| `allowedMentions` | Which mentions may notify | Discord.js defaults |
| `reply` | Channel message reference | Omitted |
| `forward` | Forward reference | Omitted |
| `tts` | Text-to-speech | `false` |
| `deleteAfter` | Delete returned message after this many milliseconds | No deletion |

An incompatible explicit method throws. Ephemeral is removed for non-interaction sends; edits also remove SuppressNotifications. Direct Components V2 sends must include the IsComponentsV2 flag; `BetterContainer.send()` adds it automatically.

## Returned messages

A fresh interaction reply returns null unless `withResponse: true` is provided. That option throws if Discord returns no message. Message, channel, and DM sends return a message, as do explicit edit and follow-up sends. A replied interaction's inferred edit returns a message at runtime, though its broad overload still allows null.

`TriggeredMessage` is a type-only marker for a sent message whose human trigger is known. Sends through interactions, human messages, users, and members can carry it. Guild channel sends and explicit message edits return ordinary Message types, so a [collector](collector.md) requires explicit participants. `SentMessage<T>` describes that distinction for a target type.

`BetterEmbed` and `BetterContainer` expose `send`, `followUp`, and `edit` with the same return rules. Paginators and prompts request their message automatically. Delayed deletion only runs when a message was returned.
