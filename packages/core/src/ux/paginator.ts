import type {
    MessageActionRowComponentBuilder,
    MessageComponentInteraction,
    SelectMenuComponentOptionData
} from "discord.js";
import type { DynaSendOptions, EmbedResolvable, RequiredDynaSendOptions, SendHandler } from "./dynaSend.js";
import type { Participant } from "./shared.js";
import type { UxPaginatorTimeoutAction } from "./uxConfig.js";

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
    TextInputStyle
} from "discord.js";
import { BetterCollector, CollectorMode } from "./betterCollector.js";
import { BetterContainer } from "./BetterContainer.js";
import { BetterEmbed } from "./betterEmbed.js";
import { BetterModal } from "./betterModal.js";
import { dynaSend, SendMethod } from "./dynaSend.js";
import { ResolveAction } from "./shared.js";
import { getGlobalUxConfig } from "./uxConfig.js";

type NavButtonId = "first" | "skipBack" | "back" | "jump" | "next" | "skipNext" | "last";
type SinglePageResolvable = string | EmbedResolvable | BetterEmbed | BetterContainer | ContainerBuilder | AttachmentBuilder;

export type PaginatorTimingOptions =
    | {
          /** Absolute time in milliseconds before pagination ends. */
          timeout: number;
          /** Idle time in milliseconds before pagination ends; overrides timeout when provided. */
          idle?: number;
      }
    | {
          /** Absolute time in milliseconds before pagination ends. */
          timeout?: number;
          /** Idle time in milliseconds before pagination ends; overrides timeout when provided. */
          idle: number;
      };

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
    /** Emitted before moving backward by `skipSize`. */
    skipBack: [page: PageResolvable, index: PageIndex];
    back: [page: PageResolvable, index: PageIndex];
    /** Emitted before jumping to a page selected through the modal. */
    jump: [page: PageResolvable, index: PageIndex];
    next: [page: PageResolvable, index: PageIndex];
    /** Emitted before moving forward by `skipSize`. */
    skipNext: [page: PageResolvable, index: PageIndex];
    last: [page: PageResolvable, index: PageIndex];
    collect: [interaction: MessageComponentInteraction, page: PageResolvable, index: PageIndex];
    preTimeout: [message: Message];
    postTimeout: [message: Message];
}

export interface PaginatorBaseOptions {
    type?: PaginationType;
    participants?: Participant[];
    pages?: PageResolvable[];
    dynamic?: boolean;
    onTimeout?: PaginationTimeout;
    /** Number of pages moved by the skip back and skip forward buttons. */
    skipSize?: number;
}

export type PaginatorOptions = PaginatorBaseOptions & PaginatorTimingOptions;

/** Navigation controls shown by a paginator. */
export enum PaginationType {
    /** Previous and next page controls. */
    Short = 0,
    /** Previous, next, skip-back, and skip-forward controls. */
    ShortSkip = 1,
    /** First, previous, next, and last page controls. */
    Long = 2,
    /** Long controls with skip-back and skip-forward controls. */
    LongSkip = 3
}

export enum PaginationTimeout {
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

interface ResolvedPaginatorOptions extends Required<PaginatorBaseOptions> {
    timeout: number | null;
    idle: number | null;
}

interface ExtraButton {
    index: number;
    component: ButtonBuilder;
}

/** Options for a custom paginator component handler. */
export interface PaginatorComponentHandlerOptions {
    /** Acknowledge the interaction with `deferUpdate()` before the handler runs. */
    deferUpdate?: boolean;
}

type PaginatorListener<K extends keyof PaginationEventMap> = {
    fn: (...args: PaginationEventMap[K]) => unknown;
    once: boolean;
};

interface PaginatorComponentListener {
    customId: string;
    fn: (interaction: MessageComponentInteraction) => unknown;
    deferUpdate: boolean;
}

const NAV_CUSTOM_IDS = {
    first: "paginator:first",
    skipBack: "paginator:skip-back",
    back: "paginator:back",
    jump: "paginator:jump",
    next: "paginator:next",
    skipNext: "paginator:skip-next",
    last: "paginator:last",
    chapterSelect: "paginator:chapter"
} as const;

const JUMP_PAGE_CUSTOM_ID = "paginator:jump:page";

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
    const data = getGlobalUxConfig().paginator.buttons[id];
    const button = new ButtonBuilder({ customId: NAV_CUSTOM_IDS[id], style: ButtonStyle.Secondary });

    if (data.label) button.setLabel(data.label);
    if (data.emoji) button.setEmoji(data.emoji);

    return button;
}

function getNavButtonIds(type: PaginationType, pageCount: number): NavButtonId[] {
    let ids: NavButtonId[];

    switch (type) {
        case PaginationType.Short:
            ids = ["back", "next"];
            break;
        case PaginationType.ShortSkip:
            ids = ["skipBack", "back", "next", "skipNext"];
            break;
        case PaginationType.Long:
            ids = ["first", "back", "next", "last"];
            break;
        case PaginationType.LongSkip:
            ids = ["first", "skipBack", "back", "next", "skipNext", "last"];
            break;
    }

    if (pageCount >= getGlobalUxConfig().paginator.jumpableThreshold) {
        ids.splice(ids.indexOf("next"), 0, "jump");
    }

    return ids;
}

function addComponentsV2Flag(flags: DynaSendOptions["flags"]): DynaSendOptions["flags"] {
    if (Array.isArray(flags)) {
        return flags.includes(MessageFlags.IsComponentsV2) ? flags : [...flags, MessageFlags.IsComponentsV2];
    }

    if (typeof flags === "number") return flags | MessageFlags.IsComponentsV2;
    if (!flags) return [MessageFlags.IsComponentsV2];

    return [flags, MessageFlags.IsComponentsV2];
}

function resolvePaginatorTimeoutAction(action: UxPaginatorTimeoutAction): PaginationTimeout {
    switch (action) {
        case "DisableComponents":
            return PaginationTimeout.DisableComponents;
        case "DeleteMessage":
            return PaginationTimeout.DeleteMessage;
        case "DoNothing":
            return PaginationTimeout.DoNothing;
        case "ClearComponents":
        default:
            return PaginationTimeout.ClearComponents;
    }
}

function createPaginatorCollectorTiming(options: ResolvedPaginatorOptions): { idle: number } | { timeout: number } {
    if (options.idle !== null) return { idle: options.idle };
    if (options.timeout !== null) return { timeout: options.timeout };

    throw new Error("[Paginator] Either idle or timeout must be provided");
}

function isBuiltInNavigationControl(customId: string): boolean {
    return (Object.values(NAV_CUSTOM_IDS) as string[]).includes(customId);
}

export class Paginator {
    chapters: PaginatorChapter[] = [];

    private options: ResolvedPaginatorOptions;
    private readonly extraButtons: ExtraButton[] = [];
    private readonly listeners: { [K in keyof PaginationEventMap]: PaginatorListener<K>[] };
    private readonly componentListeners: PaginatorComponentListener[] = [];
    private readonly navButtons: Record<NavButtonId, ButtonBuilder> = {
        first: createNavButton("first"),
        skipBack: createNavButton("skipBack"),
        back: createNavButton("back"),
        jump: createNavButton("jump"),
        next: createNavButton("next"),
        skipNext: createNavButton("skipNext"),
        last: createNavButton("last")
    };

    private collector: BetterCollector | null = null;
    private ignoreNextCollectorEnd = false;
    private state: PaginatorState = {
        message: null,
        sendOptions: undefined,
        currentPage: null,
        index: { chapter: 0, nested: 0 },
        controlsDisabled: false,
        controlsHidden: false,
        timedOut: false
    };

    constructor(options: PaginatorOptions) {
        if (options.idle === undefined && options.timeout === undefined) {
            throw new Error("[Paginator] Either idle or timeout must be provided");
        }

        const config = getGlobalUxConfig().paginator;

        this.options = {
            type: options.type ?? PaginationType.Short,
            participants: options.participants ?? [],
            pages: options.pages ?? [],
            dynamic: options.dynamic ?? false,
            timeout: options.idle === undefined ? (options.timeout ?? null) : null,
            idle: options.idle ?? null,
            onTimeout: options.onTimeout ?? resolvePaginatorTimeoutAction(config.onTimeout),
            skipSize: options.skipSize ?? config.skipSize
        };

        this.listeners = {
            beforeChapterChange: [],
            chapterChange: [],
            beforePageChange: [],
            pageChange: [],
            first: [],
            skipBack: [],
            back: [],
            jump: [],
            next: [],
            skipNext: [],
            last: [],
            collect: [],
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
        const config = getGlobalUxConfig().paginator;

        const hasSkip =
            pageCount > this.options.skipSize &&
            (this.options.type === PaginationType.ShortSkip || this.options.type === PaginationType.LongSkip);
        const isLong = pageCount >= config.longThreshold;

        if (isLong) return hasSkip ? PaginationType.LongSkip : PaginationType.Long;
        return hasSkip ? PaginationType.ShortSkip : PaginationType.Short;
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
        if (navigationRequired || this.extraButtons.length) {
            const buttons = navigationRequired
                ? getNavButtonIds(this.getEffectiveType(pageCount), pageCount).map(id =>
                      cloneButton(this.navButtons[id], this.state.controlsDisabled)
                  )
                : [];

            for (const extra of this.extraButtons) {
                buttons.splice(extra.index, 0, cloneButton(extra.component, this.state.controlsDisabled));
            }

            // Discord allows five action rows and five buttons per row; reserve one row for chapter selection when used.
            const maxNavigationRows = this.chapters.length > 1 ? 4 : 5;
            if (buttons.length > maxNavigationRows * 5) {
                throw new Error(`[Paginator] Navigation cannot contain more than ${maxNavigationRows * 5} buttons`);
            }

            for (let index = 0; index < buttons.length; index += 5) {
                rows.push(
                    new ActionRowBuilder<MessageActionRowComponentBuilder>().setComponents(buttons.slice(index, index + 5))
                );
            }
        }

        return rows;
    }

    private hasComponentControls(): boolean {
        return Boolean(this.buildRows().length);
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
        } else if (page instanceof BetterContainer || page instanceof ContainerBuilder) {
            components.push(page instanceof BetterContainer ? page.toBuilder() : page);
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
        const hasComponentControls = this.hasComponentControls();

        switch (this.options.onTimeout) {
            case PaginationTimeout.DisableComponents:
                if (!hasComponentControls) break;
                this.state.controlsDisabled = true;
                await this.refresh().catch(Boolean);
                break;
            case PaginationTimeout.ClearComponents:
                if (!hasComponentControls) break;
                this.state.controlsHidden = true;
                await this.refresh().catch(Boolean);
                break;
            case PaginationTimeout.DeleteMessage:
                if (message.deletable) await message.delete().catch(Boolean);
                break;
            case PaginationTimeout.DoNothing:
                break;
        }

        await this.emit("postTimeout", message);
    }

    private collectComponents(): void {
        const message = this.state.message;
        if (!message || !this.hasComponentControls()) return;

        if (this.collector) {
            this.ignoreNextCollectorEnd = true;
            this.collector.stop("refresh");
        }

        const collector = new BetterCollector(message, {
            type: null,
            participants: this.options.participants,
            ...createPaginatorCollectorTiming(this.options),
            mode: CollectorMode.Sequential,
            onResolve: ResolveAction.DoNothing,
            notAParticipantMessage: getGlobalUxConfig().paginator.notAParticipantMessage
        });

        this.collector = collector;

        collector.on(async interaction => {
            // Built-in controls update the paginator message. Custom handlers receive the original interaction by default.
            if (isBuiltInNavigationControl(interaction.customId) && interaction.customId !== NAV_CUSTOM_IDS.jump) {
                await interaction.deferUpdate().catch(Boolean);
            }
            await this.emit("collect", interaction, this.getCurrentPage(), { ...this.state.index });
        });

        for (const listener of this.componentListeners) {
            this.registerComponentListener(collector, listener);
        }

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

        collector.on(NAV_CUSTOM_IDS.skipBack, async () => {
            await this.navigate("skipBack", this.state.index.nested - this.options.skipSize);
        });

        collector.on(NAV_CUSTOM_IDS.back, async () => {
            await this.navigate("back", this.state.index.nested - 1);
        });

        collector.on(NAV_CUSTOM_IDS.jump, async interaction => {
            await this.showJumpModal(interaction);
        });

        collector.on(NAV_CUSTOM_IDS.next, async () => {
            await this.navigate("next", this.state.index.nested + 1);
        });

        collector.on(NAV_CUSTOM_IDS.skipNext, async () => {
            await this.navigate("skipNext", this.state.index.nested + this.options.skipSize);
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

    private async showJumpModal(interaction: MessageComponentInteraction): Promise<void> {
        const config = getGlobalUxConfig().paginator.jumpModal;
        const pageCount = this.getCurrentChapter().pages.length;
        const currentPage = this.state.index.nested + 1;
        const formatText = (text: string): string =>
            text.replaceAll("$CURRENT_PAGE", currentPage.toString()).replaceAll("$MAX_PAGE", pageCount.toString());
        const modal = new BetterModal({ title: formatText(config.title) }).addTextInput({
            customId: JUMP_PAGE_CUSTOM_ID,
            label: formatText(config.label),
            description: formatText(config.description),
            placeholder: formatText(config.placeholder),
            style: TextInputStyle.Short,
            minLength: 1,
            maxLength: pageCount.toString().length,
            required: true
        });
        const result = await modal.showAndAwait(interaction, { timeout: config.timeout });
        if (!result) return;

        const submittedPage = Number(result.getField<string>(JUMP_PAGE_CUSTOM_ID, true).trim());
        if (!Number.isInteger(submittedPage) || submittedPage < 1 || submittedPage > pageCount) {
            await result.reply({
                content: formatText(config.invalidPageMessage),
                flags: "Ephemeral"
            });
            return;
        }

        await result.deferUpdate();
        await this.navigate("jump", submittedPage - 1);
    }

    private registerComponentListener(collector: BetterCollector, listener: PaginatorComponentListener): void {
        collector.on(listener.customId, listener.fn, {
            defer: listener.deferUpdate ? { update: true } : false
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
    on<K extends keyof PaginationEventMap>(event: K, listener: (...args: PaginationEventMap[K]) => unknown): this;

    /**
     * Registers a handler for a custom paginator component.
     * Custom handlers receive an unacknowledged interaction and must acknowledge it within Discord's response window.
     * @param customId Custom component ID to listen for
     * @param listener Handler to run when the component is interacted with
     * @param options Handler configuration
     */
    on(
        customId: string,
        listener: (interaction: MessageComponentInteraction) => unknown,
        options?: PaginatorComponentHandlerOptions
    ): this;

    on<K extends keyof PaginationEventMap>(
        event: K | string,
        listener: ((...args: PaginationEventMap[K]) => unknown) | ((interaction: MessageComponentInteraction) => unknown),
        options?: PaginatorComponentHandlerOptions
    ): this {
        if (Object.hasOwn(this.listeners, event)) {
            const paginationEvent = event as K;
            this.listeners[paginationEvent].push({
                fn: listener as (...args: PaginationEventMap[K]) => unknown,
                once: false
            });
            return this;
        }

        const componentListener = {
            customId: event,
            fn: listener as (interaction: MessageComponentInteraction) => unknown,
            deferUpdate: options?.deferUpdate ?? false
        };

        this.componentListeners.push(componentListener);
        if (this.collector) this.registerComponentListener(this.collector, componentListener);
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

        return this.state.message;
    }

    /**
     * Stops the active component collector.
     * @param reason Reason to pass to the collector
     */
    stop(reason = "manual"): void {
        this.collector?.stop(reason);
    }
}
