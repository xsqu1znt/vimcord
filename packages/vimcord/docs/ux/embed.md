# Embeds

`BetterEmbed` stores ordinary text, conditional description lines, and Discord embed fields. `toJSON()` resolves colors and timestamps; `.send()`, `.followUp()`, and `.edit()` use [dynaSend](dyna-send.md).

```ts
import { BetterEmbed } from "vimcord";

const embed = new BetterEmbed({
    title: "Account",
    description: ["Your account is ready.", isStaff && "Staff access enabled.", "", "Use /help to begin."],
    author: { text: user.username, icon: user.displayAvatarURL() },
    color: ["Blue", "Purple"],
    timestamp: true
});
await embed.send(interaction, { withResponse: true });
```

| Data field | Meaning | Default |
| --- | --- | --- |
| `author` | Text or `{ text, icon?, hyperlink? }` | `null` |
| `title` | Text or `{ text, hyperlink? }` | `null` |
| `description` | Text or array of strings and falsey conditional values | `null` |
| `thumbnailUrl` | Thumbnail URL | `null` |
| `imageUrl` | Main image URL | `null` |
| `footer` | Text or `{ text, icon? }` | `null` |
| `fields` | Discord.js embed fields; null/undefined entries ignored | `[]` |
| `color` | Color, random pool, or null for no color | Global environment embed color |
| `timestamp` | Date, numeric timestamp, true for current time, or null | `null` |

String description lines join with newlines. False, zero, null, and undefined are skipped; empty strings preserve blank lines. Text is literal. Pass real icon URLs and construct dynamic text with JavaScript.

Setters mirror data fields: `setAuthor`, `setTitle`, `setDescription`, `setThumbnail`, `setImage`, `setFooter`, `setColor`, and `setTimestamp`. `addFields`, `setFields`, and `spliceFields` edit fields. More than 25 fields throws during serialization. A random color pool and timestamp true resolve once per serialization. `clone(overrides?)` produces an independent embed; `send(target, options?, overrides?)` can override a clone for one send.

## Global colors

```ts
import { defineGlobalUxConfig, getGlobalUxConfig } from "vimcord";

defineGlobalUxConfig({ embedColor: "Blue", embedColorDev: "Orange", defaultIdle: 60_000 });
const config = getGlobalUxConfig();
```

Both colors default to null. Development color falls back to the production color when null. The client's dev mode updates the shared UX dev-mode flag. `defineGlobalUxConfig` merges nested object overrides; arrays and builders are replaced. `getGlobalUxConfig()` returns the live mutable config.
