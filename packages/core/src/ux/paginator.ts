import type {
    MessageActionRowComponentBuilder,
    MessageComponentInteraction,
    MessageReaction,
    ReactionCollector,
    SelectMenuComponentOptionData
} from "discord.js";
import type { DynaSendOptions, EmbedResolvable, RequiredDynaSendOptions, SendHandler } from "./dynaSend.js";
import type { Participant } from "./shared.js";

import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    Message,
    MessageFlags,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    User
} from "discord.js";
import { BetterCollector, CollectorMode } from "./betterCollector.js";
import { BetterEmbed } from "./betterEmbed.js";
import { dynaSend, SendMethod } from "./dynaSend.js";
import { ResolveAction, resolveParticipantId } from "./shared.js";

type NavButtonId = "first" | "back" | "jump" | "next" | "last";
type SinglePageResolvable = string | EmbedResolvable | BetterEmbed | ContainerBuilder | AttachmentBuilder;

export type PageResolvable = SinglePageResolvable | EmbedResolvable[] | BetterEmbed[];
export type Chapter = PageResolvable[];

export interface PageIndex {
    chapter: number;
    nested: number;
}

export interface ChapterData extends Omit<SelectMenuComponentOptionData, "value"> {
    value?: string;
    files?: (AttachmentBuilder | undefined)[];
}

export interface PaginationEventMap {
    beforeChapterChange: [chapterIndex: number];
    chapterChange: [option: StringSelectMenuOptionBuilder, page: PageResolvable, index: PageIndex];
    beforePageChange: [nestedIndex: number];
    pageChange: [page: PageResolvable, index: PageIndex];
    first: [page: PageResolvable, index: PageIndex];
    back: [page: PageResolvable, index: PageIndex];
    jump: [page: PageResolvable, index: PageIndex];
    next: [page: PageResolvable, index: PageIndex];
    last: [page: PageResolvable, index: PageIndex];
    collect: [interaction: MessageComponentInteraction, page: PageResolvable, index: PageIndex];
    react: [reaction: MessageReaction, user: User, page: PageResolvable, index: PageIndex];
    preTimeout: [message: Message];
    postTimeout: [message: Message];
}

export interface PaginatorOptions {
    type?: PaginationType;
    participants?: Participant[];
    pages?: PageResolvable[];
    useReactions?: boolean;
    dynamic?: boolean;
    timeout?: number;
    onTimeout?: PaginationTimeoutType;
    jumpSize?: number;
}

export enum PaginationType {
    Short = 0,
    ShortJump = 1,
    Long = 2,
    LongJump = 3
}

export enum PaginationTimeoutType {
    DisableComponents = 0,
    ClearComponents = 1,
    DeleteMessage = 2,
    DoNothing = 3
}

export interface PaginatorChapter {
    id: string;
    option: Omit<ChapterData, "value" | "files">;
    pages: Chapter;
    files?: (AttachmentBuilder | undefined)[];
}

interface PaginatorState {
    message: Message | null;
    sendOptions: DynaSendOptions | undefined;
    currentPage: PageResolvable | null;
    index: PageIndex;
    controlsDisabled: boolean;
    controlsHidden: boolean;
    timedOut: boolean;
}

interface ExtraButton {
    index: number;
    component: ButtonBuilder;
}

interface NavigationButtonConfig {
    label: string;
    emoji: string;
}

type PaginatorListener<K extends keyof PaginationEventMap> = {
    fn: (...args: PaginationEventMap[K]) => unknown;
    once: boolean;
};

const DEFAULT_CONFIG = {
    timeout: 60_000,
    jumpSize: 5,
    jumpableThreshold: 5,
    longThreshold: 4,
    notParticipantMessage: "You are not allowed to use this.",
    buttons: {
        first: { label: "<<", emoji: "⏮️" },
        back: { label: "<", emoji: "◀️" },
        jump: { label: "Jump", emoji: "📄" },
        next: { label: ">", emoji: "▶️" },
        last: { label: ">>", emoji: "⏭️" }
    } satisfies Record<NavButtonId, NavigationButtonConfig>
} as const;

const NAV_CUSTOM_IDS = {
    first: "paginator:first",
    back: "paginator:back",
    jump: "paginator:jump",
    next: "paginator:next",
    last: "paginator:last",
    chapterSelect: "paginator:chapter"
} as const;

function wrapIndex(value: number, max: number): number {
    if (max < 0) return 0;
    return ((value % (max + 1)) + (max + 1)) % (max + 1);
}

function resolvePages(pages: PageResolvable | PageResolvable[]): PageResolvable[] {
    if (!Array.isArray(pages)) return [pages];
    return pages as PageResolvable[];
}

function cloneButton(button: ButtonBuilder, disabled: boolean): ButtonBuilder {
    return new ButtonBuilder(button.data).setDisabled(disabled || Boolean(button.data.disabled));
}

function createNavButton(id: NavButtonId): ButtonBuilder {
    const data = DEFAULT_CONFIG.buttons[id];
    return new ButtonBuilder({ customId: NAV_CUSTOM_IDS[id], label: data.label, style: ButtonStyle.Secondary });
}

function getNavButtonIds(type: PaginationType): NavButtonId[] {
    switch (type) {
        case PaginationType.Short:
            return ["back", "next"];
        case PaginationType.ShortJump:
            return ["back", "jump", "next"];
        case PaginationType.Long:
            return ["first", "back", "next", "last"];
        case PaginationType.LongJump:
            return ["first", "back", "jump", "next", "last"];
    }
}

function addComponentsV2Flag(flags: DynaSendOptions["flags"]): DynaSendOptions["flags"] {
    if (Array.isArray(flags)) {
        return flags.includes(MessageFlags.IsComponentsV2) ? flags : [...flags, MessageFlags.IsComponentsV2];
    }

    if (typeof flags === "number") return flags | MessageFlags.IsComponentsV2;
    if (!flags) return [MessageFlags.IsComponentsV2];

    return [flags, MessageFlags.IsComponentsV2];
}

export class Paginator {
    chapters: PaginatorChapter[] = [];

    private options: Required<PaginatorOptions>;
    private readonly extraButtons: ExtraButton[] = [];
    private readonly listeners: { [K in keyof PaginationEventMap]: PaginatorListener<K>[] };
    private readonly navButtons: Record<NavButtonId, ButtonBuilder> = {
        first: createNavButton("first"),
        back: createNavButton("back"),
        jump: createNavButton("jump"),
        next: createNavButton("next"),
        last: createNavButton("last")
    };

    private collector: BetterCollector | null = null;
    private reactionCollector: ReactionCollector | null = null;
    private ignoreNextCollectorEnd = false;
    private ignoreNextReactionEnd = false;
    private state: PaginatorState = {
        message: null,
        sendOptions: undefined,
        currentPage: null,
        index: { chapter: 0, nested: 0 },
        controlsDisabled: false,
        controlsHidden: false,
        timedOut: false
    };

    constructor(options: PaginatorOptions = {}) {
        this.options = {
            type: options.type ?? PaginationType.Short,
            participants: options.participants ?? [],
            pages: options.pages ?? [],
            useReactions: options.useReactions ?? false,
            dynamic: options.dynamic ?? false,
            timeout: options.timeout ?? DEFAULT_CONFIG.timeout,
            onTimeout: options.onTimeout ?? PaginationTimeoutType.ClearComponents,
            jumpSize: options.jumpSize ?? DEFAULT_CONFIG.jumpSize
        };

        this.listeners = {
            beforeChapterChange: [],
            chapterChange: [],
            beforePageChange: [],
            pageChange: [],
            first: [],
            back: [],
            jump: [],
            next: [],
            last: [],
            collect: [],
            react: [],
            preTimeout: [],
            postTimeout: []
        };

        if (this.options.pages.length) {
            this.addChapter(this.options.pages, { label: "Default" });
        }
    }

    private async build(): Promise<RequiredDynaSendOptions> {
        await this.setPage();
        return this.buildSendOptions(this.state.sendOptions);
    }

    private getEffectiveType(pageCount: number): PaginationType {
        if (!this.options.dynamic) return this.options.type;

        const hasJump =
            pageCount >= DEFAULT_CONFIG.jumpableThreshold &&
            (this.options.type === PaginationType.ShortJump || this.options.type === PaginationType.LongJump);
        const isLong = pageCount >= DEFAULT_CONFIG.longThreshold;

        if (isLong) return hasJump ? PaginationType.LongJump : PaginationType.Long;
        return hasJump ? PaginationType.ShortJump : PaginationType.Short;
    }

    private getCurrentChapter(): PaginatorChapter {
        const chapter = this.chapters[this.state.index.chapter];
        if (!chapter) throw new Error(`[Paginator] Could not find chapter at index ${this.state.index.chapter}`);
        return chapter;
    }

    private getCurrentPage(): PageResolvable {
        const page = this.state.currentPage;
        if (!page) throw new Error("[Paginator] Could not find the current page");
        return page;
    }

    private buildRows(): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
        if (this.state.controlsHidden) return [];

        const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
        const chapter = this.getCurrentChapter();
        const pageCount = chapter.pages.length;
        const navigationRequired = pageCount > 1;

        // --- Chapter Select ---
        if (this.chapters.length > 1) {
            const select = new StringSelectMenuBuilder({
                customId: NAV_CUSTOM_IDS.chapterSelect,
                disabled: this.state.controlsDisabled
            }).setOptions(
                this.chapters.map(
                    (chapter, index) =>
                        new StringSelectMenuOptionBuilder({
                            ...chapter.option,
                            value: chapter.id,
                            default: index === this.state.index.chapter
                        })
                )
            );

            rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().setComponents(select));
        }

        // --- Navigation ---
        if ((navigationRequired && !this.options.useReactions) || this.extraButtons.length) {
            const buttons = navigationRequired
                ? getNavButtonIds(this.getEffectiveType(pageCount)).map(id =>
                      cloneButton(this.navButtons[id], this.state.controlsDisabled)
                  )
                : [];

            for (const extra of this.extraButtons) {
                buttons.splice(extra.index, 0, cloneButton(extra.component, this.state.controlsDisabled));
            }

            if (buttons.length > 5) throw new Error("[Paginator] Navigation row cannot contain more than 5 buttons");
            if (buttons.length) rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().setComponents(buttons));
        }

        return rows;
    }

    private buildSendOptions(options: DynaSendOptions = {}): RequiredDynaSendOptions {
        const page = this.getCurrentPage();
        const chapter = this.getCurrentChapter();
        const files = [...(options.files ?? [])];
        const components = [...(options.components ?? [])];
        const embeds = [...(options.embeds ?? [])];
        const chapterFile = chapter.files?.[this.state.index.nested];
        const pageData: DynaSendOptions = {
            ...options,
            content: options.content ?? "",
            embeds,
            components,
            files,
            withResponse: options.withResponse ?? true
        };

        // --- Page Content ---
        if (chapterFile) files.push(chapterFile);

        if (Array.isArray(page)) {
            embeds.push(...page);
        } else if (typeof page === "string") {
            pageData.content = page;
        } else if (page instanceof AttachmentBuilder) {
            files.push(page);
        } else if (page instanceof ContainerBuilder) {
            components.push(page);
            pageData.flags = addComponentsV2Flag(pageData.flags);
        } else {
            embeds.push(page);
        }

        components.push(...this.buildRows());
        return { ...pageData, embeds, components, files };
    }

    private async refreshControlsAfterTimeout(): Promise<void> {
        const message = this.state.message;
        if (!message || this.state.timedOut) return;

        this.state.timedOut = true;

        await this.emit("preTimeout", message);

        switch (this.options.onTimeout) {
            case PaginationTimeoutType.DisableComponents:
                this.state.controlsDisabled = true;
                await this.refresh().catch(Boolean);
                break;
            case PaginationTimeoutType.ClearComponents:
                this.state.controlsHidden = true;
                await this.refresh().catch(Boolean);
                break;
            case PaginationTimeoutType.DeleteMessage:
                if (message.deletable) await message.delete().catch(Boolean);
                break;
            case PaginationTimeoutType.DoNothing:
                break;
        }

        if (this.options.useReactions) await message.reactions.removeAll().catch(Boolean);
        await this.emit("postTimeout", message);
    }

    private async addReactions(): Promise<void> {
        const message = this.state.message;
        if (!message || !this.options.useReactions || this.state.controlsHidden) return;

        const chapter = this.getCurrentChapter();
        if (chapter.pages.length < 2) return;

        for (const id of getNavButtonIds(this.getEffectiveType(chapter.pages.length))) {
            await message.react(DEFAULT_CONFIG.buttons[id].emoji).catch(Boolean);
        }
    }

    private collectComponents(): void {
        const message = this.state.message;
        if (!message) return;

        if (this.collector) {
            this.ignoreNextCollectorEnd = true;
            this.collector.stop("refresh");
        }

        const collector = new BetterCollector(message, {
            type: null,
            participants: this.options.participants,
            timeout: this.options.timeout,
            idle: this.options.timeout,
            mode: CollectorMode.Sequential,
            onResolve: ResolveAction.DoNothing,
            defer: { update: true }
        });

        this.collector = collector;

        collector.on(async interaction => {
            await this.emit("collect", interaction, this.getCurrentPage(), { ...this.state.index });
        });

        collector.on(NAV_CUSTOM_IDS.chapterSelect, async interaction => {
            if (!interaction.isStringSelectMenu()) return;

            const chapterIndex = this.chapters.findIndex(chapter => chapter.id === interaction.values[0]);
            if (chapterIndex < 0) return;

            await this.setPage(chapterIndex, 0);
            await this.refresh();
        });

        collector.on(NAV_CUSTOM_IDS.first, async () => {
            await this.navigate("first", 0);
        });

        collector.on(NAV_CUSTOM_IDS.back, async () => {
            await this.navigate("back", this.state.index.nested - 1);
        });

        collector.on(NAV_CUSTOM_IDS.jump, async () => {
            await this.navigate("jump", this.state.index.nested + this.options.jumpSize);
        });

        collector.on(NAV_CUSTOM_IDS.next, async () => {
            await this.navigate("next", this.state.index.nested + 1);
        });

        collector.on(NAV_CUSTOM_IDS.last, async () => {
            await this.navigate("last", this.getCurrentChapter().pages.length - 1);
        });

        collector.onEnd(async (_collected, reason) => {
            if (this.ignoreNextCollectorEnd || reason === "refresh") {
                this.ignoreNextCollectorEnd = false;
                return;
            }

            this.collector = null;
            await this.refreshControlsAfterTimeout();
        });
    }

    private collectReactions(): void {
        const message = this.state.message;
        if (!message || !this.options.useReactions) return;

        if (this.reactionCollector) {
            this.ignoreNextReactionEnd = true;
            this.reactionCollector.stop("refresh");
        }

        const collector = message.createReactionCollector({ idle: this.options.timeout });
        const navEntries = Object.entries(DEFAULT_CONFIG.buttons) as [NavButtonId, NavigationButtonConfig][];

        this.reactionCollector = collector;

        collector.on("collect", async (reaction, user) => {
            if (user.bot) return;

            const allowed =
                !this.options.participants.length ||
                this.options.participants.some(p => resolveParticipantId(p) === user.id);
            if (!allowed) {
                await reaction.users.remove(user.id).catch(Boolean);
                return;
            }

            const nav = navEntries.find(([, data]) => data.emoji === reaction.emoji.name);
            if (!nav) return;

            await reaction.users.remove(user.id).catch(Boolean);
            await this.emit("react", reaction, user, this.getCurrentPage(), { ...this.state.index });

            switch (nav[0]) {
                case "first":
                    await this.navigate("first", 0);
                    break;
                case "back":
                    await this.navigate("back", this.state.index.nested - 1);
                    break;
                case "jump":
                    await this.navigate("jump", this.state.index.nested + this.options.jumpSize);
                    break;
                case "next":
                    await this.navigate("next", this.state.index.nested + 1);
                    break;
                case "last":
                    await this.navigate("last", this.getCurrentChapter().pages.length - 1);
                    break;
            }
        });

        collector.on("end", async () => {
            if (this.ignoreNextReactionEnd) {
                this.ignoreNextReactionEnd = false;
                return;
            }

            this.reactionCollector = null;
            await this.refreshControlsAfterTimeout();
        });
    }

    private async navigate(event: NavButtonId, nestedIndex: number): Promise<void> {
        await this.emit(event, this.getCurrentPage(), { ...this.state.index });
        await this.setPage(this.state.index.chapter, nestedIndex);
        await this.refresh();
    }

    private async emit<K extends keyof PaginationEventMap>(event: K, ...args: PaginationEventMap[K]): Promise<void> {
        const listeners = [...this.listeners[event]];

        for (const listener of listeners) {
            try {
                await listener.fn(...args);
            } catch (err) {
                console.error(`[Paginator] ${String(event)} listener error:`, err);
            }

            if (listener.once) {
                const index = this.listeners[event].indexOf(listener);
                if (index > -1) this.listeners[event].splice(index, 1);
            }
        }
    }

    /**
     * Registers a listener for a paginator event.
     * @param event Event name to listen for
     * @param listener Listener to run when the event fires
     */
    on<K extends keyof PaginationEventMap>(event: K, listener: (...args: PaginationEventMap[K]) => unknown): this {
        this.listeners[event].push({ fn: listener, once: false });
        return this;
    }

    /**
     * Registers a one-time listener for a paginator event.
     * @param event Event name to listen for
     * @param listener Listener to run once when the event fires
     */
    once<K extends keyof PaginationEventMap>(event: K, listener: (...args: PaginationEventMap[K]) => unknown): this {
        this.listeners[event].push({ fn: listener, once: true });
        return this;
    }

    /**
     * Adds a chapter to the paginator.
     * @param pages Pages for the chapter
     * @param data Chapter select menu option data
     */
    addChapter(pages: PageResolvable | PageResolvable[], data: ChapterData): this {
        if (this.chapters.length >= 25) throw new Error("[Paginator] Chapter select menus can only contain 25 chapters");

        const id = data.value ?? `paginator:chapter:${this.chapters.length}`;
        const { value: _value, files, ...option } = data;

        this.chapters.push({ id, pages: resolvePages(pages), files, option });
        return this;
    }

    /**
     * Removes chapters from the paginator.
     * @param index Index to start removing chapters at
     * @param deleteCount Number of chapters to remove
     */
    spliceChapters(index: number, deleteCount: number): this {
        this.chapters.splice(index, deleteCount);
        this.state.index.chapter = wrapIndex(this.state.index.chapter, this.chapters.length - 1);
        this.state.index.nested = 0;
        return this;
    }

    /**
     * Adds or replaces pages in an existing chapter.
     * @param index Chapter index to hydrate
     * @param pages Pages to add or set
     * @param set Whether to replace existing pages instead of appending
     */
    hydrateChapter(index: number, pages: PageResolvable | PageResolvable[], set?: boolean): this {
        const chapter = this.chapters[index];
        if (!chapter) throw new Error(`[Paginator] Could not find chapter at index ${index}`);

        const resolvedPages = resolvePages(pages);
        chapter.pages = set ? resolvedPages : [...chapter.pages, ...resolvedPages];
        return this;
    }

    /**
     * Sets the pagination navigation type.
     * @param type Pagination type to use
     */
    setPaginationType(type: PaginationType): this {
        this.options.type = type;
        return this;
    }

    /**
     * Inserts an extra button into the navigation row.
     * @param index Index to insert the button at
     * @param component Button to insert
     */
    insertButtonAt(index: number, component: ButtonBuilder): this {
        this.extraButtons.push({ index, component });
        return this;
    }

    /**
     * Removes extra buttons by their insertion indexes.
     * @param indexes Extra button indexes to remove
     */
    removeButtonAt(...indexes: number[]): this {
        const removeIndexes = new Set(indexes);
        const remainingButtons = this.extraButtons.filter((_, index) => !removeIndexes.has(index));

        this.extraButtons.length = 0;
        this.extraButtons.push(...remainingButtons);
        return this;
    }

    /**
     * Sets the current page by chapter and nested page index.
     * @param chapterIndex Chapter index to switch to
     * @param nestedIndex Nested page index to switch to
     */
    async setPage(chapterIndex = this.state.index.chapter, nestedIndex = this.state.index.nested): Promise<void> {
        if (!this.chapters.length) throw new Error("[Paginator] Cannot set a page without any chapters");

        const previousIndex = { ...this.state.index };
        const nextChapterIndex = wrapIndex(chapterIndex, this.chapters.length - 1);
        const chapter = this.chapters[nextChapterIndex];
        if (!chapter) throw new Error(`[Paginator] Could not find chapter at index ${nextChapterIndex}`);
        if (!chapter.pages.length)
            throw new Error(`[Paginator] Chapter at index ${nextChapterIndex} does not have any pages`);

        await this.emit("beforeChapterChange", nextChapterIndex);
        await this.emit("beforePageChange", nestedIndex);

        const nextNestedIndex =
            nextChapterIndex !== previousIndex.chapter ? 0 : wrapIndex(nestedIndex, chapter.pages.length - 1);
        const page = chapter.pages[nextNestedIndex];
        if (!page) throw new Error(`[Paginator] Could not find page at index ${nextNestedIndex}`);

        this.state.index = { chapter: nextChapterIndex, nested: nextNestedIndex };
        this.state.currentPage = page;

        if (nextChapterIndex !== previousIndex.chapter) {
            const option = new StringSelectMenuOptionBuilder({
                ...chapter.option,
                value: chapter.id,
                default: true
            });

            await this.emit("chapterChange", option, page, { ...this.state.index });
            await this.emit("pageChange", page, { ...this.state.index });
        } else if (nextNestedIndex !== previousIndex.nested) {
            await this.emit("pageChange", page, { ...this.state.index });
        }
    }

    /**
     * Refreshes the paginator message with the current page.
     */
    async refresh(): Promise<Message | null> {
        const message = this.state.message;
        if (!message) throw new Error("[Paginator] Cannot refresh before sending the paginator");
        if (!message.editable) throw new Error("[Paginator] Cannot refresh because the message is not editable");

        await this.setPage();
        this.state.message = await dynaSend(message, {
            sendMethod: SendMethod.MessageEdit,
            ...this.buildSendOptions(this.state.sendOptions)
        });

        return this.state.message;
    }

    /**
     * Sends the paginator and starts its collectors.
     * @param handler Discord object to send through
     * @param options Additional dynaSend options
     */
    async send(handler: SendHandler, options?: DynaSendOptions): Promise<Message | null> {
        this.state.sendOptions = options;
        this.state.controlsDisabled = false;
        this.state.controlsHidden = false;
        this.state.timedOut = false;

        this.state.message = await dynaSend(handler, await this.build());
        if (!this.state.message) return null;

        this.collectComponents();
        await this.addReactions();
        this.collectReactions();

        return this.state.message;
    }

    /**
     * Stops the active component collector.
     * @param reason Reason to pass to the collector
     */
    stop(reason = "manual"): void {
        this.collector?.stop(reason);
        this.reactionCollector?.stop(reason);
    }
}
