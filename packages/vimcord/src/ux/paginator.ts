import type {
    BaseMessageOptions,
    MessageActionRowComponentBuilder,
    MessageComponentInteraction,
    ModalSubmitInteraction,
    SelectMenuComponentOptionData
} from "discord.js";
import type {
    DynaSendOptions,
    EmbedResolvable,
    InteractionBasedSendHandler,
    RequiredDynaSendOptions,
    SendHandler,
    TriggeredMessage
} from "./dynaSend.js";
import type { InferredSendOptions, OnResolve, ParticipantSendArgs, ParticipantsOption, TimingOptions } from "./shared.js";

import {
    ActionRowBuilder,
    AttachmentBuilder,
    BaseInteraction,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    EmbedBuilder,
    Message,
    MessageFlags,
    MessageFlagsBitField,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    TextInputStyle
} from "discord.js";
import { BetterCollector } from "./betterCollector.js";
import { BetterContainer } from "./BetterContainer.js";
import { BetterEmbed } from "./betterEmbed.js";
import { BetterModal } from "./betterModal.js";
import { addMessageFlag, dynaSend } from "./dynaSend.js";
import { assertTargetHasTrigger, handleResolveAction, isMessageGone, resolveTiming } from "./shared.js";
import { getGlobalUxConfig } from "./uxConfig.js";

type NavButtonId = "first" | "back" | "jump" | "next" | "last";
type PageFormat = "ordinary" | "componentsV2";
type PaginatorResponseInteraction = MessageComponentInteraction | ModalSubmitInteraction;
type PageFile = NonNullable<BaseMessageOptions["files"]>[number];
type SinglePageResolvable = string | EmbedResolvable | BetterEmbed | BetterContainer | ContainerBuilder | AttachmentBuilder;

export type PaginatorTimingOptions = TimingOptions;
export type PaginatorAction = NavButtonId | "chapter" | "set";
export type PaginatorNav = "short" | "long";

export interface OrdinaryPaginatorPage {
    content?: string;
    embeds?: (EmbedResolvable | BetterEmbed)[];
    files?: PageFile[];
    containers?: never;
}

export interface ComponentsV2PaginatorPage {
    containers: (BetterContainer | ContainerBuilder)[];
    files?: PageFile[];
    content?: never;
    embeds?: never;
}

export type PageResolvable =
    SinglePageResolvable | (EmbedResolvable | BetterEmbed)[] | OrdinaryPaginatorPage | ComponentsV2PaginatorPage;
export type Chapter = PageResolvable[];

export interface PageIndex {
    chapter: number;
    nested: number;
}
export interface ChapterData extends Omit<SelectMenuComponentOptionData, "value"> {
    value?: string;
}
/** Static chapter; value preserves selection across reordering in replaceChapters. */
export interface PaginatorStaticChapter extends ChapterData {
    pages: Chapter;
    load?: never;
    pageCount?: never;
    page?: never;
}
/** Chapter loaded once, the first time it's opened. */
export interface PaginatorLoadedChapter extends ChapterData {
    load: PaginatorChapterLoader;
    pages?: never;
    pageCount?: never;
    page?: never;
}
/** Chapter that loads each page as it's opened. */
export interface PaginatorPagedChapter extends ChapterData {
    pageCount: number;
    page: PaginatorPageLoader;
    pages?: never;
    load?: never;
}
export type PaginatorChapterInput = PaginatorStaticChapter | PaginatorLoadedChapter | PaginatorPagedChapter;
export interface PaginateEvent {
    previous: PageIndex;
    destination: PageIndex;
    action: PaginatorAction;
    page: PageResolvable;
}

export interface PaginationEventMap {
    paginate: [event: PaginateEvent];
    collect: [interaction: MessageComponentInteraction, page: PageResolvable, index: PageIndex];
    preTimeout: [message: Message];
    postTimeout: [message: Message];
}

export type PaginatorChapterLoader = () => Chapter | Promise<Chapter>;
/** Passed to a page loader so it can correct its chapter's page count from the data it just read. */
export interface PaginatorPageLoaderContext {
    /** Updates the page count. If the requested page no longer exists, the new last page loads instead. */
    setPageCount(count: number): void;
}
export type PaginatorPageLoader = (
    pageIndex: number,
    context: PaginatorPageLoaderContext
) => PageResolvable | Promise<PageResolvable>;
export type PaginatorLoadingHook = (
    destination: PageIndex
) => PageResolvable | null | undefined | Promise<PageResolvable | null | undefined>;

/** Paginator completion passed to onResolve after pending navigation finishes. */
export interface PaginatorResolveContext {
    message: Message;
    reason: string;
}

export interface PaginatorBaseOptions {
    /** Navigation layout. `"long"` adds first and last buttons. @default "short" */
    nav?: PaginatorNav;
    pages?: PageResolvable[];
    /** Cleanup action or awaited final payload, applied once after the paginator ends. @default "disable" */
    onResolve?: OnResolve<PaginatorResolveContext>;
    /** Adds Jump to the selected navigation layout. */
    jump?: boolean;
    /** Places the chapter select before or after send components. Defaults to `afterComponents`; navigation stays last. */
    chapterSelectPosition?: "beforeComponents" | "afterComponents";
    /** Returns a placeholder only while a lazy destination loads. */
    onLoading?: PaginatorLoadingHook;
}

export type PaginatorOptions = PaginatorBaseOptions & PaginatorTimingOptions;

interface StaticChapterSource {
    kind: "static";
    pages: Chapter;
}
interface ChapterLoaderSource {
    kind: "chapterLoader";
    loader: PaginatorChapterLoader;
    pages: Chapter | null;
}
interface PageLoaderSource {
    kind: "pageLoader";
    loader: PaginatorPageLoader;
    pageCount: number;
}
type ChapterSource = StaticChapterSource | ChapterLoaderSource | PageLoaderSource;

export interface PaginatorChapter {
    id: string;
    option: Omit<ChapterData, "value">;
    source: ChapterSource;
}

interface PaginatorState {
    message: Message | null;
    interaction: InteractionBasedSendHandler | undefined;
    sendOptions: DynaSendOptions | undefined;
    currentPage: PageResolvable | null;
    index: PageIndex;
    active: boolean;
}

interface ResolvedPaginatorOptions extends Required<Omit<PaginatorBaseOptions, "onLoading">> {
    timeout: number | null;
    idle: number | null;
    onLoading?: PaginatorLoadingHook;
}

interface ExtraButton {
    index: number;
    component: ButtonBuilder;
}
export interface PaginatorComponentHandlerOptions {
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

const LOADING_DELAY_MS = 150;

const NAV_CUSTOM_IDS = {
    first: "paginator:first",
    back: "paginator:back",
    jump: "paginator:jump",
    next: "paginator:next",
    last: "paginator:last",
    chapterSelect: "paginator:chapter"
} as const;
const JUMP_PAGE_CUSTOM_ID = "paginator:jump:page";

function wrapIndex(value: number, max: number): number {
    if (max < 0) return 0;
    return ((value % (max + 1)) + (max + 1)) % (max + 1);
}

function assertPageLoaderCount(count: number): void {
    if (count < 1 || !Number.isInteger(count))
        throw new Error("[Paginator] Page-loader page count must be a positive integer");
}

function cloneButton(button: ButtonBuilder, disabled = false): ButtonBuilder {
    return new ButtonBuilder(button.data).setDisabled(disabled || Boolean(button.data.disabled));
}

function createNavButton(id: NavButtonId): ButtonBuilder {
    const data = getGlobalUxConfig().paginator.buttons[id];
    const button = new ButtonBuilder({ customId: NAV_CUSTOM_IDS[id], style: ButtonStyle.Secondary });
    if (data.label) button.setLabel(data.label);
    if (data.emoji) button.setEmoji(data.emoji);
    return button;
}

function getNavButtonIds(nav: PaginatorNav, jump: boolean): NavButtonId[] {
    const ids: NavButtonId[] = nav === "long" ? ["first", "back", "next", "last"] : ["back", "next"];
    if (jump) ids.splice(ids.indexOf("next"), 0, "jump");
    return ids;
}

function isPageObject(page: PageResolvable): page is OrdinaryPaginatorPage | ComponentsV2PaginatorPage {
    return (
        Boolean(page) &&
        typeof page === "object" &&
        !Array.isArray(page) &&
        ("content" in page || "embeds" in page || "containers" in page || "files" in page)
    );
}

function getPageFormat(page: PageResolvable): PageFormat {
    if (page instanceof BetterContainer || page instanceof ContainerBuilder) return "componentsV2";
    if (isPageObject(page) && "containers" in page && page.containers) return "componentsV2";
    return "ordinary";
}

function createCollectorTiming(options: ResolvedPaginatorOptions): { idle: number } | { timeout: number } {
    if (options.idle !== null) return { idle: options.idle };
    if (options.timeout !== null) return { timeout: options.timeout };
    throw new Error("[Paginator] Either idle or timeout must be provided");
}

function hasResponded(interaction: PaginatorResponseInteraction): boolean {
    return interaction.replied || interaction.deferred;
}

function isNavigationInteraction(customId: string): boolean {
    return customId !== NAV_CUSTOM_IDS.jump && Object.values(NAV_CUSTOM_IDS).some(id => id === customId);
}

export class Paginator {
    chapters: PaginatorChapter[] = [];
    private readonly options: ResolvedPaginatorOptions;
    private readonly extraButtons: ExtraButton[] = [];
    private readonly listeners: { [K in keyof PaginationEventMap]: PaginatorListener<K>[] } = {
        paginate: [],
        collect: [],
        preTimeout: [],
        postTimeout: []
    };
    private readonly componentListeners: PaginatorComponentListener[] = [];
    private readonly navButtons: Record<NavButtonId, ButtonBuilder> = {
        first: createNavButton("first"),
        back: createNavButton("back"),
        jump: createNavButton("jump"),
        next: createNavButton("next"),
        last: createNavButton("last")
    };
    private readonly navHandlers: Record<string, (i: MessageComponentInteraction) => Promise<void>> = {
        [NAV_CUSTOM_IDS.chapterSelect]: async i => {
            if (!i.isStringSelectMenu()) return;
            const chapter = this.chapters.findIndex(c => c.id === i.values[0]);
            if (chapter >= 0) await this.navigate("chapter", chapter, 0, i);
        },
        [NAV_CUSTOM_IDS.first]: i => this.navigate("first", this.state.index.chapter, 0, i),
        [NAV_CUSTOM_IDS.back]: i => this.navigate("back", this.state.index.chapter, this.state.index.nested - 1, i),
        [NAV_CUSTOM_IDS.jump]: i => this.showJumpModal(i),
        [NAV_CUSTOM_IDS.next]: i => this.navigate("next", this.state.index.chapter, this.state.index.nested + 1, i),
        [NAV_CUSTOM_IDS.last]: i => {
            const chapter = this.state.index.chapter;
            const requested = { chapter, nested: (this.getPageCount(this.getChapter()) ?? 1) - 1 };
            return this.runNavigationRequest(
                "last",
                async () => {
                    const count =
                        this.getPageCount(this.getChapter(chapter)) ??
                        (await this.loadChapter(this.getChapter(chapter))).length;
                    return { chapter, nested: count - 1 };
                },
                requested,
                i
            );
        }
    };
    private collector: BetterCollector | null = null;
    private participants: ParticipantsOption | undefined;
    private format: PageFormat | null = null;
    private navigationBusy = false;
    private navigationPromise: Promise<void> | null = null;
    private nextChapterId = 0;
    private state: PaginatorState = {
        message: null,
        interaction: undefined,
        sendOptions: undefined,
        currentPage: null,
        index: { chapter: 0, nested: 0 },
        active: false
    };

    constructor(options: PaginatorOptions = {}) {
        const config = getGlobalUxConfig().paginator;
        const timing = resolveTiming(options);
        this.options = {
            nav: options.nav ?? "short",
            pages: options.pages ?? [],
            timeout: timing.timeout,
            idle: timing.idle,
            onResolve: options.onResolve ?? config.onResolve,
            jump: options.jump ?? false,
            chapterSelectPosition: options.chapterSelectPosition ?? "afterComponents",
            onLoading: options.onLoading
        };
        if (this.options.pages.length) this.addChapter({ label: "Default", pages: this.options.pages });
    }

    private getChapter(index = this.state.index.chapter): PaginatorChapter {
        const chapter = this.chapters[index];
        if (!chapter) throw new Error(`[Paginator] Could not find chapter at index ${index}`);
        return chapter;
    }

    private getPageCount(chapter: PaginatorChapter): number | null {
        if (chapter.source.kind === "static") return chapter.source.pages.length;
        if (chapter.source.kind === "pageLoader") return chapter.source.pageCount;
        return chapter.source.pages?.length ?? null;
    }

    private getCurrentPage(): PageResolvable {
        if (!this.state.currentPage) throw new Error("[Paginator] Could not find the current page");
        return this.state.currentPage;
    }

    private validatePageFormat(page: PageResolvable): void {
        if (isPageObject(page)) {
            const data = page as unknown as { content?: unknown; embeds?: unknown[]; containers?: unknown[] };
            if (data.containers && (data.content || data.embeds?.length)) {
                throw new Error("[Paginator] A page cannot contain both ordinary content and Components V2 containers");
            }
        }
        const format = getPageFormat(page);
        if (this.format && this.format !== format)
            throw new Error("[Paginator] A paginator cannot mix ordinary pages with Components V2 pages");
        this.format = format;
    }

    private validateStaticFormats(): void {
        for (const chapter of this.chapters) {
            if (chapter.source.kind === "static") for (const page of chapter.source.pages) this.validatePageFormat(page);
        }
    }

    private async loadChapter(chapter: PaginatorChapter): Promise<Chapter> {
        if (chapter.source.kind === "static") return chapter.source.pages;
        if (chapter.source.kind === "pageLoader") throw new Error("[Paginator] Page-loader chapters do not load as a unit");
        if (chapter.source.pages) return chapter.source.pages;
        const pages = await chapter.source.loader();
        if (!pages.length) throw new Error(`[Paginator] Chapter '${chapter.id}' does not have any pages`);
        for (const page of pages) this.validatePageFormat(page);
        chapter.source.pages = pages;
        return pages;
    }

    /** Loads a page and returns the index it landed on, which moves back when a page loader shrinks its chapter. */
    private async loadPage(index: PageIndex): Promise<{ page: PageResolvable; index: PageIndex }> {
        const chapter = this.getChapter(index.chapter);
        const { source } = chapter;
        let page: PageResolvable | undefined;
        if (source.kind === "pageLoader") {
            const context: PaginatorPageLoaderContext = {
                setPageCount: count => {
                    assertPageLoaderCount(count);
                    source.pageCount = count;
                }
            };
            page = await source.loader(index.nested, context);
            if (index.nested >= source.pageCount) {
                index = { chapter: index.chapter, nested: source.pageCount - 1 };
                page = await source.loader(index.nested, context);
            }
        } else page = (await this.loadChapter(chapter))[index.nested];
        if (!page) throw new Error(`[Paginator] Could not find page at index ${index.nested}`);
        this.validatePageFormat(page);
        return { page, index };
    }

    private isLazyDestination(index: PageIndex): boolean {
        const source = this.getChapter(index.chapter).source;
        return source.kind === "pageLoader" || (source.kind === "chapterLoader" && source.pages === null);
    }

    // Built-in prepared pages need no user code or upload before their update can acknowledge the click.
    private canUpdateImmediately(index: PageIndex): boolean {
        if (this.state.sendOptions?.files?.length) return false;
        const source = this.getChapter(index.chapter).source;
        if (source.kind === "pageLoader" || !source.pages) return false;
        const page = source.pages[index.nested];
        return (
            typeof page === "string" ||
            page instanceof EmbedBuilder ||
            page instanceof BetterEmbed ||
            page instanceof ContainerBuilder ||
            page instanceof BetterContainer
        );
    }

    private async resolveDestination(chapterIndex: number, nestedIndex: number): Promise<PageIndex> {
        if (!this.chapters.length) throw new Error("[Paginator] Cannot set a page without any chapters");
        const chapter = wrapIndex(chapterIndex, this.chapters.length - 1);
        const target = this.getChapter(chapter);
        let count = this.getPageCount(target);
        if (count === null) count = (await this.loadChapter(target)).length;
        if (!count) throw new Error(`[Paginator] Chapter at index ${chapter} does not have any pages`);
        return { chapter, nested: wrapIndex(nestedIndex, count - 1) };
    }

    private buildRows(
        disabled = false,
        targetIndex: PageIndex = this.state.index
    ): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
        const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
        const count = this.getPageCount(this.getChapter(targetIndex.chapter)) ?? 1;
        if (this.chapters.length > 1) {
            const select = new StringSelectMenuBuilder({ customId: NAV_CUSTOM_IDS.chapterSelect, disabled }).setOptions(
                this.chapters.map(
                    (c, index) =>
                        new StringSelectMenuOptionBuilder({
                            ...c.option,
                            value: c.id,
                            default: index === targetIndex.chapter
                        })
                )
            );
            rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().setComponents(select));
        }
        const buttons =
            count > 1
                ? getNavButtonIds(this.options.nav, this.options.jump).map(id => cloneButton(this.navButtons[id], disabled))
                : [];
        for (const extra of this.extraButtons) buttons.splice(extra.index, 0, cloneButton(extra.component, disabled));
        const maxRows = this.chapters.length > 1 ? 4 : 5;
        if (buttons.length > maxRows * 5)
            throw new Error(`[Paginator] Navigation cannot contain more than ${maxRows * 5} buttons`);
        for (let index = 0; index < buttons.length; index += 5)
            rows.push(
                new ActionRowBuilder<MessageActionRowComponentBuilder>().setComponents(buttons.slice(index, index + 5))
            );
        return rows;
    }

    private buildSendOptions(
        page: PageResolvable,
        options: DynaSendOptions = {},
        index: PageIndex = this.state.index
    ): RequiredDynaSendOptions {
        const data: DynaSendOptions = {
            ...options,
            content: "",
            embeds: [],
            files: [],
            components: [],
            withResponse: true
        };
        if (this.format === "componentsV2") {
            if (options.content || options.embeds?.length)
                throw new Error("[Paginator] Components V2 pages cannot be combined with ordinary message content");
            data.flags = addMessageFlag(options.flags, MessageFlags.IsComponentsV2);
        } else if (options.components?.some(c => c instanceof BetterContainer || c instanceof ContainerBuilder)) {
            throw new Error("[Paginator] Ordinary pages cannot be combined with Components V2 containers");
        }
        const components = [...(options.components ?? [])];
        const embeds = [...(options.embeds ?? [])];
        const files = [...(options.files ?? [])];
        if (Array.isArray(page)) embeds.push(...page);
        else if (typeof page === "string") data.content = page;
        else if (page instanceof AttachmentBuilder) files.push(page);
        else if (page instanceof BetterContainer || page instanceof ContainerBuilder) components.push(page);
        else if (isPageObject(page)) {
            if ("content" in page && page.content !== undefined) data.content = page.content;
            if ("embeds" in page && page.embeds) embeds.push(...page.embeds);
            if ("containers" in page && page.containers) components.push(...page.containers);
            if (page.files) files.push(...page.files);
        } else embeds.push(page);
        const rows = this.buildRows(false, index);
        if (this.options.chapterSelectPosition === "beforeComponents" && this.chapters.length > 1)
            components.unshift(...rows.splice(0, 1));
        components.push(...rows);
        return { ...data, embeds, files, components };
    }

    private async editPage(
        page: PageResolvable,
        index: PageIndex = this.state.index,
        interaction?: PaginatorResponseInteraction
    ): Promise<Message | null> {
        const message = this.state.message;
        if (!message || (!this.state.interaction && !message.editable))
            throw new Error("[Paginator] Cannot refresh because the message is not editable");
        // Keep the returned snapshot even after timeout so cleanup edits the latest component data.
        const data = this.buildSendOptions(page, this.state.sendOptions, index);
        const editOptions = {
            content: data.content,
            embeds: data.embeds,
            components: data.components,
            files: data.files,
            allowedMentions: data.allowedMentions,
            flags:
                data.flags === undefined
                    ? undefined
                    : new MessageFlagsBitField(data.flags as never).remove(
                          MessageFlags.Ephemeral,
                          MessageFlags.SuppressNotifications
                      ).bitfield
        };
        if (interaction && !hasResponded(interaction) && interaction.isMessageComponent()) {
            const response = await interaction.update({ ...editOptions, withResponse: true });
            this.state.message = response.resource?.message ?? message;
            return this.state.message;
        }
        this.state.message = this.state.interaction
            ? await this.state.interaction.webhook.editMessage(message.id, editOptions)
            : await dynaSend(message, {
                  ...data,
                  sendMethod: "edit"
              });
        return this.state.message;
    }

    // Only slow loads need a placeholder. The load starts immediately, and errors remain observable by the caller.
    private async showLoading(pending: Promise<unknown>, index: PageIndex): Promise<boolean> {
        if (!this.isLazyDestination(index) || !this.options.onLoading) return false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const slow = await Promise.race([
                pending.then(() => false),
                new Promise<boolean>(r => {
                    timer = setTimeout(() => r(true), LOADING_DELAY_MS);
                })
            ]);
            if (!slow || !this.state.active) return false;
            const placeholder = await this.options.onLoading(index);
            if (!placeholder || !this.state.active) return false;
            this.validatePageFormat(placeholder);
            await this.editPage(placeholder);
            return true;
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    private async emit<K extends keyof PaginationEventMap>(event: K, ...args: PaginationEventMap[K]): Promise<void> {
        for (const listener of [...this.listeners[event]]) {
            try {
                await listener.fn(...args);
            } catch (error) {
                console.error(`[Paginator] ${String(event)} listener error:`, error);
            }
            if (listener.once) this.listeners[event].splice(this.listeners[event].indexOf(listener), 1);
        }
    }

    private async respond(interaction: PaginatorResponseInteraction, message: string | null): Promise<void> {
        if (!message) {
            if (!hasResponded(interaction)) await interaction.deferUpdate().catch(() => {});
            return;
        }
        const options = { content: message, flags: "Ephemeral" as const };
        if (hasResponded(interaction)) await interaction.followUp(options).catch(() => {});
        else await interaction.reply(options).catch(async () => interaction.deferUpdate().catch(() => {}));
    }

    private async runNavigationRequest(
        action: PaginatorAction,
        resolveDestination: () => Promise<PageIndex>,
        requested: PageIndex,
        interaction?: PaginatorResponseInteraction
    ): Promise<void> {
        if (
            interaction &&
            !hasResponded(interaction) &&
            (!this.state.active ||
                this.navigationBusy ||
                !interaction.isMessageComponent() ||
                !this.canUpdateImmediately(requested))
        ) {
            await interaction.deferUpdate().catch(() => {});
        }
        if (!this.state.active || this.navigationBusy) return;

        const previous = { ...this.state.index };
        this.navigationBusy = true;
        const operation = this.performNavigation(previous, resolveDestination, requested, action, interaction);
        this.navigationPromise = operation;
        try {
            await operation;
        } finally {
            this.navigationBusy = false;
            if (this.navigationPromise === operation) this.navigationPromise = null;
        }
    }

    private async performNavigation(
        previous: PageIndex,
        resolveDestination: () => Promise<PageIndex>,
        requested: PageIndex,
        action: PaginatorAction,
        interaction?: PaginatorResponseInteraction
    ): Promise<void> {
        const previousPage = this.getCurrentPage();
        let placeholderShown = false;
        try {
            const pending = resolveDestination().then(async destination =>
                previous.chapter === destination.chapter && previous.nested === destination.nested
                    ? null
                    : await this.loadPage(destination)
            );
            placeholderShown = await this.showLoading(pending, requested);
            const loaded = await pending;
            if (!loaded) {
                if (placeholderShown && this.state.active) await this.editPage(previousPage);
                if (interaction && !hasResponded(interaction)) await interaction.deferUpdate().catch(() => {});
                return;
            }
            if (!this.state.active) {
                if (interaction && !hasResponded(interaction)) await interaction.deferUpdate().catch(() => {});
                return;
            }
            const { page, index: destination } = loaded;
            await this.editPage(page, destination, interaction);
            if (!this.state.active) return;
            this.state.currentPage = page;
            this.state.index = destination;
            await this.emit("paginate", { previous, destination: { ...destination }, action, page });
        } catch (error) {
            console.error("[Paginator] Navigation failed:", error);
            if (placeholderShown && this.state.active) await this.editPage(previousPage).catch(() => {});
            if (interaction) await this.respond(interaction, getGlobalUxConfig().paginator.messages.loadFailed);
        }
    }

    private async navigate(
        action: PaginatorAction,
        chapter: number,
        nested: number,
        interaction?: PaginatorResponseInteraction
    ): Promise<void> {
        const chapterIndex = wrapIndex(chapter, this.chapters.length - 1);
        const count = this.getPageCount(this.getChapter(chapterIndex));
        const requested = { chapter: chapterIndex, nested: count ? wrapIndex(nested, count - 1) : nested };
        if (requested.chapter === this.state.index.chapter && requested.nested === this.state.index.nested) {
            if (interaction && !hasResponded(interaction)) await interaction.deferUpdate().catch(() => {});
            return;
        }
        await this.runNavigationRequest(action, () => this.resolveDestination(chapter, nested), requested, interaction);
    }

    private async runExclusive(operation: () => Promise<void>): Promise<boolean> {
        if (!this.state.active || this.navigationBusy) return false;
        this.navigationBusy = true;
        const promise = operation();
        this.navigationPromise = promise;
        try {
            await promise;
            return true;
        } finally {
            this.navigationBusy = false;
            if (this.navigationPromise === promise) this.navigationPromise = null;
        }
    }

    /** Runs on every click: `collect` observers, then `onComponent` listeners for the ID, then built-in navigation. */
    private async handleClick(i: MessageComponentInteraction): Promise<void> {
        const listeners = this.componentListeners.filter(l => l.customId === i.customId);
        const navigation = this.navHandlers[i.customId];

        // Other code runs before navigation can update the message, so a navigation click is acknowledged first.
        const observed = this.listeners.collect.length > 0 || listeners.length > 0;
        const acknowledge = listeners.some(l => l.deferUpdate) || (isNavigationInteraction(i.customId) && observed);
        if (acknowledge && !hasResponded(i)) await i.deferUpdate().catch(() => {});

        await this.emit("collect", i, this.getCurrentPage(), { ...this.state.index });
        for (const listener of listeners) {
            try {
                await listener.fn(i);
            } catch (error) {
                console.error("[Paginator] Component listener error:", error);
            }
        }
        await navigation?.(i);
    }

    private collectComponents(): void {
        const message = this.state.message;
        if (!message) return;
        this.collector?.stop("refresh");
        // `send`'s signature already required `participants` for targets with no trigger.
        const collector = new BetterCollector(message as TriggeredMessage, {
            participants: this.participants,
            interaction: this.state.interaction,
            ...createCollectorTiming(this.options),
            onResolve: "keep",
            notAParticipantMessage: getGlobalUxConfig().paginator.notAParticipantMessage
        });
        this.collector = collector;
        collector.on(i => this.handleClick(i));
        collector.onEnd(async reason => {
            if (reason === "refresh") return;
            this.collector = null;
            await this.handleTimeout(reason);
        });
    }

    private async showJumpModal(interaction: MessageComponentInteraction): Promise<void> {
        const openedChapter = this.state.index.chapter;
        const pageCount = this.getPageCount(this.getChapter()) ?? (await this.loadChapter(this.getChapter())).length;
        const config = getGlobalUxConfig().paginator.jumpModal;
        const formatText = (text: string): string =>
            text.replaceAll("$CURRENT_PAGE", String(this.state.index.nested + 1)).replaceAll("$MAX_PAGE", String(pageCount));
        const modal = new BetterModal({ title: formatText(config.title) }).addTextInput({
            customId: JUMP_PAGE_CUSTOM_ID,
            label: formatText(config.label),
            description: formatText(config.description),
            placeholder: formatText(config.placeholder),
            style: TextInputStyle.Short,
            minLength: 1,
            maxLength: String(pageCount).length,
            required: true
        });
        const result = await modal.showAndAwait(interaction, { timeout: config.timeout });
        if (!result) return;
        if (!this.state.active) {
            await this.respond(result.interaction, getGlobalUxConfig().paginator.messages.expired);
            return;
        }
        if (this.state.index.chapter !== openedChapter) {
            await this.respond(result.interaction, getGlobalUxConfig().paginator.messages.chapterChanged);
            return;
        }
        const submitted = Number(result.fields[JUMP_PAGE_CUSTOM_ID].trim());
        const currentCount = this.getPageCount(this.getChapter());
        if (!Number.isInteger(submitted) || !currentCount || submitted < 1 || submitted > currentCount) {
            await result.reply({ content: formatText(config.invalidPageMessage), flags: "Ephemeral" });
            return;
        }
        await this.navigate("jump", openedChapter, submitted - 1, result.interaction);
    }

    private async handleTimeout(reason: string): Promise<void> {
        const message = this.state.message;
        if (!message || !this.state.active) return;
        this.state.active = false;
        await this.emit("preTimeout", message);
        await this.navigationPromise?.catch(error => {
            console.error("[Paginator] Pending edit failed during timeout:", error);
        });
        const latestMessage = this.state.message ?? message;
        const result =
            typeof this.options.onResolve === "function"
                ? await this.options.onResolve({ message: latestMessage, reason })
                : this.options.onResolve;
        if (!isMessageGone(reason)) {
            this.state.message =
                (await handleResolveAction(
                    latestMessage,
                    result,
                    this.state.sendOptions?.allowedMentions,
                    this.state.interaction
                )) ?? latestMessage;
        }
        await this.emit("postTimeout", this.state.message ?? message);
    }

    on<K extends keyof PaginationEventMap>(event: K, listener: (...args: PaginationEventMap[K]) => unknown): this {
        this.listeners[event].push({ fn: listener, once: false });
        return this;
    }

    once<K extends keyof PaginationEventMap>(event: K, listener: (...args: PaginationEventMap[K]) => unknown): this {
        this.listeners[event].push({ fn: listener, once: true });
        return this;
    }

    onComponent(
        customId: string,
        listener: (interaction: MessageComponentInteraction) => unknown,
        options?: PaginatorComponentHandlerOptions
    ): this {
        this.componentListeners.push({ customId, fn: listener, deferUpdate: options?.deferUpdate ?? false });
        return this;
    }

    /**
     * Adds a chapter from static `pages`, a `load` function that runs once when it's first opened,
     * or a `page` function that runs per page with a known `pageCount`.
     * @param chapter The chapter's source and its select menu data
     */
    addChapter(chapter: PaginatorChapterInput): this {
        const { pages, load, pageCount, page, ...data } = chapter;
        if (pages) return this.addChapterSource({ kind: "static", pages }, data);
        if (load) return this.addChapterSource({ kind: "chapterLoader", loader: load, pages: null }, data);
        assertPageLoaderCount(pageCount!);
        return this.addChapterSource({ kind: "pageLoader", loader: page!, pageCount: pageCount! }, data);
    }

    private addChapterSource(source: ChapterSource, data: ChapterData): this {
        if (this.chapters.length >= 25) throw new Error("[Paginator] Chapter select menus can only contain 25 chapters");
        const id = data.value ?? `paginator:chapter:${this.nextChapterId++}`;
        if (this.chapters.some(c => c.id === id)) throw new Error(`[Paginator] Chapter ID '${id}' is already in use`);
        const { value: _value, ...option } = data;
        this.chapters.push({ id, source, option });
        return this;
    }

    spliceChapters(index: number, deleteCount: number): this {
        this.chapters.splice(index, deleteCount);
        this.state.index.chapter = wrapIndex(this.state.index.chapter, this.chapters.length - 1);
        this.state.index.nested = 0;
        return this;
    }

    /**
     * Replaces static chapters and re-renders, preserving the chapter value and clamping its page.
     * Chapters without values preserve their position; a removed chapter returns to the first page.
     * @param chapters Replacement pages and chapter menu data
     */
    async replaceChapters(chapters: PaginatorStaticChapter[]): Promise<void> {
        if (!chapters.length) throw new Error("[Paginator] Cannot replace chapters with an empty list");
        if (chapters.length > 25) throw new Error("[Paginator] Chapter select menus can only contain 25 chapters");
        const ids = new Set<string>();
        const replacement = chapters.map(
            ({ pages, value, load: _load, pageCount: _count, page: _page, ...option }, i): PaginatorChapter => {
                if (!pages.length) throw new Error(`[Paginator] Chapter at index ${i} does not have any pages`);
                const id = value ?? this.chapters[i]?.id ?? `paginator:chapter:${this.nextChapterId++}`;
                if (ids.has(id)) throw new Error(`[Paginator] Chapter ID '${id}' is already in use`);
                ids.add(id);
                for (const page of pages) this.validatePageFormat(page);
                return { id, option, source: { kind: "static", pages } };
            }
        );
        await this.navigationPromise;
        const replace = async () => {
            const id = this.chapters[this.state.index.chapter]?.id;
            const found = replacement.findIndex(c => c.id === id);
            const chapter = found < 0 ? 0 : found;
            const nested = found < 0 ? 0 : Math.min(this.state.index.nested, chapters[chapter]!.pages.length - 1);
            const index = { chapter, nested };
            this.chapters = replacement;
            const { page } = await this.loadPage(index);
            if (this.state.message) await this.editPage(page, index);
            this.state.index = index;
            this.state.currentPage = page;
        };
        if (!this.state.message) await replace();
        else await this.runExclusive(replace);
    }

    setNav(nav: PaginatorNav): this {
        this.options.nav = nav;
        return this;
    }
    /** Inserts a custom button at a zero-based position among rendered navigation buttons. */
    insertButtonAt(index: number, component: ButtonBuilder): this {
        this.extraButtons.push({ index, component });
        return this;
    }
    /** Removes custom buttons by the insertion positions passed to `insertButtonAt`. */
    removeButtonAt(...indexes: number[]): this {
        const positions = new Set(indexes);
        const remaining = this.extraButtons.filter(b => !positions.has(b.index));
        this.extraButtons.length = 0;
        this.extraButtons.push(...remaining);
        return this;
    }

    async setPage(chapterIndex = this.state.index.chapter, nestedIndex = this.state.index.nested): Promise<void> {
        if (!this.state.message) {
            const { page, index } = await this.loadPage(await this.resolveDestination(chapterIndex, nestedIndex));
            this.state.index = index;
            this.state.currentPage = page;
            return;
        }
        await this.navigate("set", chapterIndex, nestedIndex);
    }

    /** Reloads a lazy chapter. Page loaders always load each requested page. */
    async reloadChapter(index = this.state.index.chapter): Promise<void> {
        const chapter = this.getChapter(index);
        if (!this.state.message) {
            if (chapter.source.kind === "chapterLoader") chapter.source.pages = null;
            return;
        }
        await this.runExclusive(async () => {
            if (index !== this.state.index.chapter) {
                if (chapter.source.kind === "chapterLoader") chapter.source.pages = null;
                return;
            }
            const previousPage = this.getCurrentPage();
            const previousPages = chapter.source.kind === "chapterLoader" ? chapter.source.pages : null;
            let placeholderShown = false;
            try {
                if (chapter.source.kind === "chapterLoader") chapter.source.pages = null;
                const pending = this.loadPage(this.state.index);
                placeholderShown = await this.showLoading(pending, this.state.index);
                const { page, index } = await pending;
                if (!this.state.active) return;
                await this.editPage(page, index);
                if (!this.state.active) return;
                this.state.index = index;
                this.state.currentPage = page;
            } catch (error) {
                if (chapter.source.kind === "chapterLoader") chapter.source.pages = previousPages;
                console.error("[Paginator] Reload failed:", error);
                if (placeholderShown && this.state.active) await this.editPage(previousPage).catch(() => {});
            }
        });
    }

    /** Re-renders the loaded current page without loading or emitting `paginate`. */
    async refresh(): Promise<Message | null> {
        await this.runExclusive(async () => {
            await this.editPage(this.getCurrentPage());
        });
        return this.state.message;
    }

    /**
     * Sends the paginator and starts collecting navigation clicks.
     * @param handler Discord target to send through
     * @param options dynaSend options, plus `participants`: who may navigate. Defaults to whoever triggered the
     * paginator, and required for guild channels, message edits, and replies to a bot's message, where nothing
     * says who that is. An empty list lets nobody navigate; `"anyone"` opts out.
     * @throws Before sending, when replying to a bot's message outside of a DM without `participants`
     */
    send<T extends SendHandler>(
        handler: T,
        ...args: ParticipantSendArgs<
            T,
            [options?: InferredSendOptions<T> & { participants?: ParticipantsOption }],
            [options: DynaSendOptions & { participants: ParticipantsOption }]
        >
    ): Promise<Message>;
    async send(
        handler: SendHandler,
        { participants, ...options }: DynaSendOptions & { participants?: ParticipantsOption } = {}
    ): Promise<Message> {
        assertTargetHasTrigger(handler, participants, options.sendMethod);
        if (!this.chapters.length) throw new Error("[Paginator] Cannot send without any chapters");
        this.validateStaticFormats();
        this.state.sendOptions = options;
        this.state.interaction = handler instanceof BaseInteraction ? handler : undefined;
        this.participants = participants;
        this.state.active = true;
        try {
            const { page, index } = await this.loadPage(
                await this.resolveDestination(this.state.index.chapter, this.state.index.nested)
            );
            this.state.index = index;
            this.state.currentPage = page;
            const message = await dynaSend(handler, { ...this.buildSendOptions(page, options), withResponse: true });
            this.state.message = message;
            this.collectComponents();
            return message;
        } catch (error) {
            this.state.active = false;
            console.error("[Paginator] Initial send failed:", error);
            throw error;
        }
    }

    stop(reason = "manual"): void {
        this.collector?.stop(reason);
    }
}
