# Containers

`BetterContainer` builds Discord Components V2 content. It implements `toJSON()`, so Discord.js accepts it directly as a component.

```ts
import { ButtonBuilder, ButtonStyle, MessageFlags } from "discord.js";
import { BetterContainer } from "vimcord";

const container = new BetterContainer({ color: "Blue" })
    .addText(["## Account", isStaff && "Staff access enabled."])
    .addSeparator()
    .addSection({ text: "Read the guide", button: new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Guide").setURL("https://discord.js.org/") })
    .addRow(new ButtonBuilder().setCustomId("account:refresh").setLabel("Refresh").setStyle(ButtonStyle.Secondary));

await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
```

| Method or option | Meaning | Default |
| --- | --- | --- |
| `new BetterContainer({ color })` | Fixed accent, random pool, or null | Global environment embed color |
| `setColor(color)` | Set or clear the accent; pools roll once here | Explicit argument |
| `addText(text)` | Text or conditional lines; empty results add nothing | Explicit argument |
| `addSeparator({ divider, spacing })` | Visible line and Discord separator spacing | `true`, `1` |
| `addMedia({ url, spoiler, description })` | One URL or URL array in a gallery | Spoiler false, description omitted |
| `addSection({ text, button, thumbnail })` | Text plus a button or thumbnail accessory | Text omitted; raw button style Secondary |
| `addRow(...components)` | Buttons split into rows of five, or one select | Explicit components |

Section buttons accept a `ButtonBuilder` or button data. Thumbnails accept a URL or thumbnail data. A section needs a valid Discord accessory. Mixing buttons with selects, or placing multiple selects in one row, throws. Conditional text follows [embed description rules](embed.md).

`send(target, options?)`, `followUp(interaction, options?)`, and `edit(target, options?)` add the Components V2 flag. Sending returns the same [target-dependent result](dyna-send.md) as other helpers. Color serialization is stable; `toJSON()` does not reroll pools.

When sending through Discord.js directly, include `MessageFlags.IsComponentsV2`. Components V2 messages use container text instead of ordinary content or embeds. Use a [collector](collector.md) for custom buttons and selects.
