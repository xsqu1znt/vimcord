# Tools

## Logger

Reusable logger with colored output.

```typescript
new Logger(options?: LoggerOptions): Logger
```

### LoggerOptions

```typescript
interface LoggerOptions {
    colors?: Partial<typeof LOGGER_COLORS>;
    prefix?: string | null;
    prefixEmoji?: string | null;
    minLevel?: LogLevel;
    showTimestamp?: boolean;
}
```

### LogLevel

```typescript
enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    SUCCESS = 2,
    WARN = 3,
    ERROR = 4
}
```

### LOGGER_COLORS

```typescript
const LOGGER_COLORS = {
    primary: string,
    success: string,
    warn: string,
    danger: string,
    muted: string,
    text: string
};
```

### Methods

```typescript
logger.extend<Extra>(extras: Extra): Logger & Extra
logger.setPrefix(prefix: string | null): this
logger.setPrefixEmoji(prefixEmoji: string | null): this
logger.setMinLevel(minLevel: LogLevel): this
logger.setShowTimestamp(show: boolean): this
logger.setColors(colors: Partial<typeof LOGGER_COLORS>): this

// Logging
logger.log(message: string, ...args: any[]): void
logger.debug(message: string, ...args: any[]): void
logger.info(message: string, ...args: any[]): void
logger.success(message: string, ...args: any[]): void
logger.warn(message: string, ...args: any[]): void
logger.error(message: string, error?: Error, ...args: any[]): void
logger.loader(message: string): (newMessage?: string) => void
logger.table(title: string, data: Record<string, any>): void
logger.section(title: string): void
```

### Default Export

```typescript
import { logger } from "vimcord";
```

---

## BetterEmbed

Enhanced embed builder.

```typescript
new BetterEmbed(options?: BetterEmbedData): BetterEmbed
```

### BetterEmbedData

```typescript
interface BetterEmbedData {
    context?: BetterEmbedContext;
    title?: BetterEmbedTitle;
    author?: BetterEmbedAuthor;
    description?: string;
    fields?: APIEmbedField[];
    footer?: BetterEmbedFooter;
    thumbnail?: APIThumbnailComponent;
    image?: string;
    color?: ColorResolvable;
    timestamp?: boolean | Date;
    url?: string;
}
```

### Methods

```typescript
embed.setTitle(title: string | number, url?: string): this
embed.setDescription(description: string): this
embed.setAuthor(name: string, iconURL?: string, url?: string): this
embed.setFooter(text: string, iconURL?: string): this
embed.setThumbnail(url: string): this
embed.setImage(url: string): this
embed.setColor(color: ColorResolvable): this
embed.setTimestamp(date?: Date): this
embed.setURL(url: string): this
embed.addFields(...fields: APIEmbedField[]): this
embed.addField(name: string, value: string, inline?: boolean): this
embed.spliceFields(index: number, deleteCount: number, ...fields: APIEmbedField[]): this
embed.toJSON(): APIEmbed
```

---

## BetterContainer

Action row container for messages.

```typescript
new BetterContainer(data?: BetterContainerData): BetterContainer
```

### BetterContainerData

```typescript
interface BetterContainerData {
    components?: ActionRowBuilder<MessageActionRowComponentBuilder>[];
}
```

### Methods

```typescript
container.addActionRow(): ActionRowBuilder<MessageActionRowComponentBuilder>
container.addButton(customId: string, style: ButtonStyle, label?: string, emoji?: EmojiIdentifier, disabled?: boolean): this
container.addStringSelect(customId: string, placeholder?: string, options?: SelectMenuComponentOptionData[], minValues?: number, maxValues?: number): this
container.addUserSelect(customId: string, placeholder?: string, minValues?: number, maxValues?: number): this
container.addRoleSelect(customId: string, placeholder?: string, minValues?: number, maxValues?: number): this
container.addMentionableSelect(customId: string, placeholder?: string, minValues?: number, maxValues?: number): this
container.addChannelSelect(customId: string, channelTypes?: ChannelType[], placeholder?: string, minValues?: number, maxValues?: number): this
container.toJSON(): APIEmbed[]
```

---

## BetterCollector

Collects interactions with filters.

```typescript
new BetterCollector<T>(options: BetterCollectorOptions<T>): BetterCollector<T>
```

### BetterCollectorOptions

```typescript
interface BetterCollectorOptions<T> {
    target: Message | CommandInteraction | ModalSubmitInteraction;
    channel?: TextBasedChannel;
    timeoutType?: CollectorTimeoutType;
    timeout?: number;
    idle?: number;
    filter?: (Collected: T) => boolean;
    onEnd?: (reason: string, collected: Collection<string, T>) => void;
}
```

### CollectorTimeoutType

```typescript
enum CollectorTimeoutType {
    Time = 0,
    Idle = 1,
    Both = 2,
    None = 3
}
```

### Methods

```typescript
collector.await<T>(options?: {
    componentType?: MessageComponentType | InteractionType;
    customId?: string;
    max?: number;
}): Promise<Collection<string, T>>
collector.awaitButton(customId?: string, max?: number): Promise<ButtonInteraction>
collector.awaitSelect(customId: string, max?: number): Promise<StringSelectMenuInteraction>
collector.awaitMessage(options?: { filter?: (m: Message) => boolean; max?: number }): Promise<Message>
```

---

## Paginator

Paginated message builder.

```typescript
new Paginator(options?: PaginatorOptions): Paginator
```

### PaginatorOptions

```typescript
interface PaginatorOptions {
    target: Message | CommandInteraction;
    pages: Chapter[];
    config?: PartialDeep<ToolsConfig["paginator"]>;
}
```

### Chapter / ChapterData

```typescript
interface ChapterData {
    embed?: BetterEmbedData;
    content?: string;
    components?: ActionRowBuilder<MessageActionRowComponentBuilder>[];
}

interface Chapter extends ChapterData {
    id: string;
}
```

### Methods

```typescript
paginator.setPages(pages: Chapter[]): this
paginator.setPage(page: number): this
paginator.setConfig(config: PartialDeep<ToolsConfig["paginator"]>): this
paginator.send(options?: { ephemeral?: boolean }): Promise<Message>
paginator.edit(message: Message): Promise<Message>
paginator.delete(): Promise<void>
```

---

## Prompt

Interactive confirmation prompt.

```typescript
prompt(handler: SendHandler, options?: PromptOptions, sendOptions?: DynaSendOptions): Promise<PromptResult>
```

### PromptOptions

```typescript
interface PromptOptions {
    content?: string;
    embed?: BetterEmbedData;
    container?: BetterContainerData;
    textOnly?: boolean;
    customButtons?: Record<string, CustomButton>;
    onResolve?: PromptResolveType[];
    timeout?: number;
    config?: PartialDeep<ToolsConfig["prompt"]>;
}
```

### CustomButton

```typescript
interface CustomButton {
    style?: ButtonStyle;
    label?: string;
    emoji?: EmojiIdentifier;
    confirm?: ButtonBuilder | Partial<APIButtonComponent>;
    reject?: ButtonBuilder | Partial<APIButtonComponent>;
}
```

### PromptResult

```typescript
interface PromptResult {
    message: Message | null;
    confirmed: boolean | null;
    customId: string | null;
    timedOut: boolean;
}
```

### PromptResolveType

```typescript
enum PromptResolveType {
    DeleteOnConfirm = 0,
    DeleteOnReject = 1,
    DisableOnConfirm = 2,
    DisableOnReject = 3,
    ReplyOnConfirm = 4,
    ReplyOnReject = 5
}
```

---

## dynaSend / DynaSendOptions

Dynamic message sending.

```typescript
dynaSend(target: SendHandler, options?: DynaSendOptions): Promise<Message | Message[]>
```

### DynaSendOptions

```typescript
interface DynaSendOptions {
    content?: string;
    embeds?: APIEmbed[];
    components?: ActionRowBuilder<MessageActionRowComponentBuilder>[];
    files?: FilePayload[];
    reply?: ReplyOptions;
    ephemeral?: boolean;
    fetchReply?: boolean;
}
```

---

## BetterModal

Modal interaction builder.

```typescript
new BetterModal(options?: BetterModalOptions): BetterModal
```

### BetterModalOptions

```typescript
interface BetterModalOptions {
    title?: string;
    customId?: string;
    components?: ModalActionRowComponentBuilder[];
}
```

### Methods

```typescript
modal.setTitle(title: string): this
modal.setCustomId(customId: string): this
modal.addTextInput(customId: string, label: string, options?: BetterTextInputComponent): this
modal.addParagraphInput(customId: string, label: string, options?: BetterTextInputComponent): this
modal.addNumberInput(customId: string, label: string, options?: BetterTextInputComponent): this
modal.addChannelInput(customId: string, label: string, options?: BetterTextInputComponent): this
modal.addRoleInput(customId: string, label: string, options?: BetterTextInputComponent): this
modal.addUserInput(customId: string, label: string, options?: BetterTextInputComponent): this
modal.toJSON(): ModalBuilder
```

### BetterTextInputComponent

```typescript
interface BetterTextInputComponent {
    style?: TextInputStyle;
    placeholder?: string;
    value?: string;
    required?: boolean;
    minLength?: number;
    maxLength?: number;
}
```

---

## Quick Tools Example

```typescript
import { BetterEmbed, BetterContainer, Paginator, Prompt } from "vimcord";

// Embed
const embed = new BetterEmbed({
    title: "My Embed",
    description: "Hello world!",
    color: "#ff0000"
});

// Container with buttons
const container = new BetterContainer().addButton("primary", "custom_id_1", "Click Me", { name: "🔘" });

// Paginator
const pages = [
    { embed: { title: "Page 1", description: "Content 1" } },
    { embed: { title: "Page 2", description: "Content 2" } }
];
new Paginator({ target: message, pages }).send();

// Prompt
const result = await prompt(interaction, {
    content: "Are you sure?",
    customButtons: {
        delete: { label: "Delete", emoji: { name: "🗑️" }, style: ButtonStyle.Danger }
    }
});
```
