# Paginators

A paginator sends chapters of pages and handles navigation. All indexes in the API are zero-based; the Jump modal displays one-based page numbers.

```ts
import { BetterEmbed, Paginator } from "vimcord";

const paginator = new Paginator({ nav: "long", jump: true })
    .addChapter({ label: "Guide", value: "guide", pages: [
        new BetterEmbed({ title: "Getting started", description: "Run /help." }),
        new BetterEmbed({ title: "Commands", description: "Run /notes list." })
    ] });
await paginator.send(interaction);
```

| Option | Meaning | Default |
| --- | --- | --- |
| `pages` | Initial pages in a chapter labeled Default | `[]` |
| `nav` | `"short"` for back/next, `"long"` adds first/last | `"short"` |
| `jump` | Adds a page-jump modal | `false` |
| `idle` | End after this long without an accepted click | Global `defaultIdle` (`60_000`) |
| `timeout` | Absolute duration; mutually exclusive with idle | None |
| `onResolve` | Cleanup action or callback receiving `{ message, reason }` | Global `paginator.onResolve` (`"disable"`) |
| `chapterSelectPosition` | Chapter select relative to supplied send components; navigation is last | `"afterComponents"` |
| `onLoading` | Placeholder returned while a lazy destination loads | None |

Pass participants in `send(target, { participants })`, with other [send options](dyna-send.md). The same [participant rules](collector.md#participants) apply: infer from a human trigger, require an explicit list for guild channels, message edits, or replies to a bot's message. `[]` permits nobody; `"anyone"` permits everyone. A reply to a bot's guild message fails before sending when participants are missing. Fresh interaction replies request their message automatically.

## Chapter inputs

`addChapter(chapter)` accepts `PaginatorChapterInput`. All variants have Discord select option fields (`label`, optional `description`, `emoji`, `default`) and optional stable `value`. Up to 25 chapters are allowed, and values must be unique.

| Source | Fields | Loading |
| --- | --- | --- |
| Static | `pages: [...]` | Already available |
| Chapter loader | `load: () => pages` | Once on first opening, cached until reload |
| Page loader | `pageCount`, `page: (index, context) => page` | On each requested page |

A page is a string, embed, BetterEmbed, attachment, container, array of embeds, `{ content?, embeds?, files? }`, or `{ containers, files? }`. An inner array is one page with several embeds. Attach files to the page payload that needs them.

```ts
import { Paginator } from "vimcord";

const paginator = new Paginator({ onLoading: () => ({ content: "Loading users..." }) })
    .addChapter({ label: "Users", value: "users", load: async () => loadUsers() })
    .addChapter({ label: "Records", value: "records", pageCount: 20,
        page: async (index, { setPageCount }) => {
            const result = await loadRecordPage(index);
            setPageCount(Math.max(1, result.pageCount));
            return { content: result.text };
        }
    });
```

Page counts must be positive integers. `setPageCount(count)` corrects a changing count; if the requested page disappeared, the new last page loads instead. `reloadChapter(index?)` invalidates a chapter loader's cache and reloads the selected chapter. A failed reload keeps the previous chapter available and logs the failure. Select an earlier page before retrying a reload that removed the current page.

`replaceChapters([{ label, value, pages }])` replaces static chapters and re-renders. Stable values preserve selection through reordering; omitted values preserve position. A shorter chapter clamps the page; removing the selected chapter returns to the first chapter/page. An empty replacement or chapter throws.

## Loading and Components V2

`onLoading(destination)` runs only for lazy loads. Returning nothing keeps the existing page visible. A returned placeholder appears after a 150 ms loading delay and must use the same page format.

```ts
import { BetterContainer, Paginator } from "vimcord";

const paginator = new Paginator({
    onLoading: () => ({ containers: [new BetterContainer().addText("Loading users...")] })
}).addChapter({
    label: "Users",
    pageCount: 20,
    page: async index => ({ containers: [new BetterContainer().addText(await loadUserPageText(index))] })
});
```

Use ordinary content/embeds throughout one paginator, or Components V2 containers throughout. Static mixtures fail before send; invalid lazy results fail before edit. Placeholders follow the same rule. Navigation edits replace page files and content while preserving the paginator controls.

## Events and custom controls

```ts
import { ButtonBuilder, ButtonStyle } from "discord.js";

paginator.on("paginate", ({ previous, destination, action, page }) => {
    console.log(previous.nested, destination.nested, action, page);
});
paginator.insertButtonAt(1, new ButtonBuilder().setCustomId("guide:feedback").setLabel("Feedback").setStyle(ButtonStyle.Secondary));
paginator.onComponent("guide:feedback", async i => { await i.reply({ content: "Thanks!", flags: "Ephemeral" }); });
```

| Method or event | Meaning |
| --- | --- |
| `on` / `once` | Observe an event repeatedly or once |
| `paginate` | One event after a successful changed navigation edit |
| `collect` | Accepted interaction, current page, and index before its handler |
| `preTimeout` / `postTimeout` | Message before and after resolution, including manual stops |
| `onComponent(id, handler, { deferUpdate? })` | Custom ID handler; deferUpdate defaults false |
| `insertButtonAt(index, button)` | Insert at a zero-based rendered navigation position |
| `removeButtonAt(...indexes)` | Remove using the same insertion positions |
| `setNav("short" \| "long")` | Change navigation layout |
| `setPage(chapter?, page?)` | Navigate, defaulting to current indexes |
| `refresh()` | Re-render the loaded page without loading or emitting paginate |
| `spliceChapters(index, count)` | Remove chapters and reset current page |
| `stop(reason = "manual")` | End navigation and apply resolution |

Initial sends, unchanged positions, refreshes, placeholders, and cleanup do not emit paginate. Events and custom IDs use separate registration methods. Custom handlers normally acknowledge their interactions; `deferUpdate: true` does it first, which is unsuitable when the handler must open a modal. Participant filtering covers every custom ID.

## Jump and status messages

```ts
const client = new Vimcord({ intents, ux: { paginator: { messages: {
    loadFailed: "That page could not be loaded.",
    expired: "This paginator has expired.",
    chapterChanged: "The chapter changed. Open Jump again."
} } } });
```

| Global setting | Default |
| --- | --- |
| `paginator.notAParticipantMessage` | `"You are not allowed to use this."` |
| `paginator.messages.loadFailed` | `null` |
| `paginator.messages.expired` | `null` |
| `paginator.messages.chapterChanged` | `null` |
| `paginator.jumpModal.title` | `"Jump to Page"` |
| `paginator.jumpModal.label`, `.placeholder` | `"Page number"` |
| `paginator.jumpModal.description`, `.invalidPageMessage` | `"Enter a page number between 1 and $MAX_PAGE."` |
| `paginator.jumpModal.timeout` | `60_000` |
| `paginator.buttons` | Labels `<<`, `<`, `Jump`, `>`, `>>` |

Null status messages silently acknowledge when necessary; strings send ephemeral responses. Jump text supports `$CURRENT_PAGE` and `$MAX_PAGE`. Global button entries accept `label` and `emoji`; emojis may be Unicode strings or `{ name, id?, animated? }`.
