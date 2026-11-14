# Collectors

`BetterCollector` attaches one handler per custom ID to a sent message. Participant filtering runs before counting clicks or resetting idle time. An accepted click invokes all `onCollect` observers in order, then its exact handler, otherwise the wildcard handler, otherwise an automatic `deferUpdate()`.

```ts
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { BetterCollector, dynaSend } from "vimcord";

const sent = await dynaSend(interaction, {
    content: "Refresh this view.",
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("view:refresh").setLabel("Refresh").setStyle(ButtonStyle.Primary)
    )],
    withResponse: true
});
const collector = new BetterCollector(sent, { clickLock: true });
collector.on("view:refresh", async i => { await i.update({ content: "View refreshed." }); });
collector.onCollect(i => { console.log(`Accepted ${i.customId}`); });
collector.onEnd(reason => { console.log(`Ended: ${reason}`); });
```

| Option | Meaning | Default |
| --- | --- | --- |
| `participants` | Users, members, or IDs; `"anyone"` opens access | Inferred from the message trigger |
| `idle` | End after this many milliseconds without an accepted click | Global `defaultIdle` (`60_000`) |
| `timeout` | Absolute duration; cannot combine with idle | None |
| `clickLock` | Reject a user's overlapping clicks while their handler runs | `false` |
| `max` | Stop after this many accepted clicks | Unlimited |
| `interaction` | Originating interaction for trigger inference and ephemeral cleanup | None |
| `onResolve` | Cleanup action or awaited final payload | `"disable"` |
| `notAParticipantMessage` | Rejection content; null acknowledges silently | Global collector rejection message |

## Participants

Participants are resolved to IDs once at creation and apply to every custom ID, including unhandled ones. `[]` permits nobody. `"anyone"` is the explicit open-access choice. Mutating the source array later has no effect.

Inference uses the originating interaction user, the message's interaction metadata, or the human author it replies to. A reply to a bot has no human trigger. A DM with no trigger stays open to its recipient. A guild message with no trigger throws unless participants are explicit.

Messages returned by Vimcord sends carry the `TriggeredMessage` type when the target identifies a trigger. A raw Discord.js `Message` requires explicit participants or its originating interaction, even when runtime metadata would identify the user.

```ts
import { BetterCollector } from "vimcord";

const collector = new BetterCollector(message, { participants: [USER_ID], onResolve: "keep" });
collector.on(async i => { await i.deferUpdate(); });
```

## Handling and cleanup

`on(id, handler)` registers one exact handler; `on(handler)` registers one wildcard. Duplicates throw. Handlers own acknowledgement. `onCollect` observers cannot suppress dispatch; their return values are ignored. Listener errors are logged. With clickLock enabled, the lock releases after observers and the selected handler finish.

`stop(reason = "manual")` ends collection. `resetTimer()` restarts the configured timing window, useful after a modal. `onEnd(reason)` runs before `onResolve`. Interaction history is not retained.

`onResolve` accepts `"disable"`, `"clear"`, `"delete"`, `"keep"`, or a callback receiving `{ message, reason }` and returning one of those strings or `{ action, ...messageEdit }`. Final content and component cleanup are applied in one edit. Deleted-message endings still invoke callbacks but skip the final edit. Supply the original interaction for ephemeral message cleanup.

Global `collector.clickLockMessage` defaults to `"Please wait, your previous action is still processing."`; `collector.notAParticipantMessage` defaults to `"You are not allowed to use this."`. Null rejection messages acknowledge silently. Rejected clicks do not count toward max or extend idle time.
