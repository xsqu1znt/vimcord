import type {
    BaseMessageOptions,
    MessageActionRowComponentBuilder,
    MessageComponentInteraction,
    ModalSubmitInteraction,
    SelectMenuComponentOptionData
} from "discord.js";
import type { DynaSendOptions, EmbedResolvable, RequiredDynaSendOptions, SendHandler } from "./dynaSend.js";
import type { Participant, TimingOptions } from "./shared.js";

import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    ContainerBuilder,
    Message,
    MessageFlags,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    TextInputStyle
} from "discord.js";
import { BetterCollector } from "./betterCollector.js";
import { BetterContainer } from "./BetterContainer.js";
import { BetterEmbed } from "./betterEmbed.js";
import { BetterModal } from "./betterModal.js";
import { addMessageFlag, dynaSend, SendMethod } from "./dynaSend.js";
import { handleResolveAction, ResolveAction, resolveTiming } from "./shared.js";
import { getGlobalUxConfig } from "./uxConfig.js";

type NavButtonId = "first" | "skipBack" | "back" | "jump" | "next" | "skipNext" | "last";
type PageFormat = "ordinary" | "componentsV2";
type PaginatorResponseInteraction = MessageComponentInteraction | ModalSubmitInteraction;
type PageFile = NonNullable<BaseMessageOptions["files"]>[number];
type SinglePageResolvable = string | EmbedResolvable | BetterEmbed | BetterContainer | ContainerBuilder | AttachmentBuilder;

export type PaginatorTimingOptions = TimingOptions;
export type PaginatorAction = NavButtonId | "chapter" | "set";

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
export type PaginatorPageLoader = (pageIndex: number) => PageResolvable | Promise<PageResolvable>;
export type PaginatorLoadingHook = (
    destination: PageIndex
) => PageResolvable | null | undefined | Promise<PageResolvable | null | undefined>;

export interface PaginatorBaseOptions {
    type?: PaginationType;
    participants?: Participant[];
    pages?: PageResolvable[];
    onTimeout?: ResolveAction;
    skipSize?: number;
    /** Adds Jump to the selected navigation layout. */
    jump?: boolean;
    /** Returns a placeholder only while a lazy destination loads. */
    onLoading?: PaginatorLoadingHook;
}

export type PaginatorOptions = PaginatorBaseOptions & PaginatorTimingOptions;

/** Explicit navigation layouts. Jump is selected separately with `jump: true`. */
export enum PaginationType {
    Short = 0,
    ShortSkip = 1,
    Long = 2,
    LongSkip = 3
}

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

function getNavButtonIds(type: PaginationType, jump: boolean): NavButtonId[] {
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
        skipBack: createNavButton("skipBack"),
        back: createNavButton("back"),
        jump: createNavButton("jump"),
        next: createNavButton("next"),
        skipNext: createNavButton("skipNext"),
        last: createNavButton("last")
    };
    private collector: BetterCollector | null = null;
    private format: PageFormat | null = null;
    private navigationBusy = false;
    private navigationPromise: Promise<void> | null = null;
    private nextChapterId = 0;
    private state: PaginatorState = {
        message: null,
        sendOptions: undefined,
        currentPage: null,
        index: { chapter: 0, nested: 0 },
        active: false
    };

    constructor(options: PaginatorOptions) {
        const config = getGlobalUxConfig().paginator;
        const timing = resolveTiming(options);
        this.options = {
            type: options.type ?? PaginationType.Short,
            participants: options.participants ?? [],
            pages: options.pages ?? [],
            timeout: timing.timeout,
            idle: timing.idle,
            onTimeout: options.onTimeout ?? config.onTimeout,
            skipSize: options.skipSize ?? config.skipSize,
            jump: options.jump ?? false,
            onLoading: options.onLoading
        };
        if (this.options.pages.length) this.addChapter(this.options.pages, { label: "Default" });
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

    private async loadPage(index: PageIndex): Promise<PageResolvable> {
        const chapter = this.getChapter(index.chapter);
        const page =
            chapter.source.kind === "pageLoader"
                ? await chapter.source.loader(index.nested)
                : (await this.loadChapter(chapter))[index.nested];
        if (!page) throw new Error(`[Paginator] Could not find page at index ${index.nested}`);
        this.validatePageFormat(page);
        return page;
    }

    private isLazyDestination(index: PageIndex): boolean {
        const source = this.getChapter(index.chapter).source;
        return source.kind === "pageLoader" || (source.kind === "chapterLoader" && source.pages === null);
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
                ? getNavButtonIds(this.options.type, this.options.jump).map(id => cloneButton(this.navButtons[id], disabled))
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
        } else if (options.components?.some(c => c instanceof ContainerBuilder)) {
            throw new Error("[Paginator] Ordinary pages cannot be combined with Components V2 containers");
        }
        const components = [...(options.components ?? [])];
        const embeds = [...(options.embeds ?? [])];
        const files = [...(options.files ?? [])];
        if (Array.isArray(page)) embeds.push(...page);
        else if (typeof page === "string") data.content = page;
        else if (page instanceof AttachmentBuilder) files.push(page);
        else if (page instanceof BetterContainer || page instanceof ContainerBuilder)
            components.push(page instanceof BetterContainer ? page.toBuilder() : page);
        else if (isPageObject(page)) {
            if ("content" in page && page.content !== undefined) data.content = page.content;
            if ("embeds" in page && page.embeds) embeds.push(...page.embeds);
            if ("containers" in page && page.containers)
                components.push(...page.containers.map(c => (c instanceof BetterContainer ? c.toBuilder() : c)));
            if (page.files) files.push(...page.files);
        } else embeds.push(page);
        components.push(...this.buildRows(false, index));
        return { ...data, embeds, files, components };
    }

    private async editPage(page: PageResolvable, index: PageIndex = this.state.index): Promise<Message | null> {
        const message = this.state.message;
        if (!message?.editable) throw new Error("[Paginator] Cannot refresh because the message is not editable");
        // Keep the returned snapshot even after timeout so cleanup edits the latest component data.
        this.state.message = await dynaSend(message, {
            ...this.buildSendOptions(page, this.state.sendOptions, index),
            sendMethod: SendMethod.MessageEdit
        });
        return this.state.message;
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
        if (interaction && !hasResponded(interaction)) await interaction.deferUpdate().catch(() => {});
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
            if (this.isLazyDestination(requested) && this.options.onLoading) {
                const placeholder = await this.options.onLoading(requested);
                if (placeholder && this.state.active) {
                    this.validatePageFormat(placeholder);
                    await this.editPage(placeholder);
                    placeholderShown = true;
                }
            }

            const destination = await resolveDestination();
            if (previous.chapter === destination.chapter && previous.nested === destination.nested) {
                if (placeholderShown && this.state.active) await this.editPage(previousPage);
                return;
            }
            const page = await this.loadPage(destination);
            if (!this.state.active) return;
            await this.editPage(page, destination);
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

    private registerComponentListener(collector: BetterCollector, listener: PaginatorComponentListener): void {
        collector.on(listener.customId, listener.fn, { defer: listener.deferUpdate ? { update: true } : false });
    }

    private collectComponents(): void {
        const message = this.state.message;
        if (!message) return;
        this.collector?.stop("refresh");
        const collector = new BetterCollector(message, {
            type: null,
            participants: this.options.participants,
            ...createCollectorTiming(this.options),
            onResolve: ResolveAction.DoNothing,
            notAParticipantMessage: getGlobalUxConfig().paginator.notAParticipantMessage
        });
        this.collector = collector;
        collector.on(async i => {
            if (isNavigationInteraction(i.customId) && !hasResponded(i)) await i.deferUpdate().catch(() => {});
            await this.emit("collect", i, this.getCurrentPage(), { ...this.state.index });
        });
        for (const listener of this.componentListeners) this.registerComponentListener(collector, listener);
        collector.on(NAV_CUSTOM_IDS.chapterSelect, async i => {
            if (!i.isStringSelectMenu()) return;
            const chapter = this.chapters.findIndex(c => c.id === i.values[0]);
            if (chapter >= 0) await this.navigate("chapter", chapter, 0, i);
        });
        collector.on(NAV_CUSTOM_IDS.first, i => this.navigate("first", this.state.index.chapter, 0, i));
        collector.on(NAV_CUSTOM_IDS.skipBack, i =>
            this.navigate("skipBack", this.state.index.chapter, this.state.index.nested - this.options.skipSize, i)
        );
        collector.on(NAV_CUSTOM_IDS.back, i =>
            this.navigate("back", this.state.index.chapter, this.state.index.nested - 1, i)
        );
        collector.on(NAV_CUSTOM_IDS.jump, i => this.showJumpModal(i));
        collector.on(NAV_CUSTOM_IDS.next, i =>
            this.navigate("next", this.state.index.chapter, this.state.index.nested + 1, i)
        );
        collector.on(NAV_CUSTOM_IDS.skipNext, i =>
            this.navigate("skipNext", this.state.index.chapter, this.state.index.nested + this.options.skipSize, i)
        );
        collector.on(NAV_CUSTOM_IDS.last, async i => {
            if (!hasResponded(i)) await i.deferUpdate().catch(() => {});
            const chapter = this.state.index.chapter;
            const requested = { chapter, nested: this.getPageCount(this.getChapter()) ?? 0 };
            await this.runNavigationRequest(
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
        });
        collector.onEnd(async (_collected, reason) => {
            if (reason === "refresh") return;
            this.collector = null;
            await this.handleTimeout();
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
        const submitted = Number(result.getField(JUMP_PAGE_CUSTOM_ID, ComponentType.TextInput, true).trim());
        const currentCount = this.getPageCount(this.getChapter());
        if (!Number.isInteger(submitted) || !currentCount || submitted < 1 || submitted > currentCount) {
            await result.reply({ content: formatText(config.invalidPageMessage), flags: "Ephemeral" });
            return;
        }
        await this.navigate("jump", openedChapter, submitted - 1, result.interaction);
    }

    private async handleTimeout(): Promise<void> {
        const message = this.state.message;
        if (!message || !this.state.active) return;
        this.state.active = false;
        await this.emit("preTimeout", message);
        await this.navigationPromise?.catch(error => {
            console.error("[Paginator] Pending edit failed during timeout:", error);
        });
        await handleResolveAction(this.state.message, this.options.onTimeout);
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
        const component = { customId, fn: listener, deferUpdate: options?.deferUpdate ?? false };
        this.componentListeners.push(component);
        if (this.collector) this.registerComponentListener(this.collector, component);
        return this;
    }

    addChapter(pages: PageResolvable[], data: ChapterData): this {
        return this.addChapterSource({ kind: "static", pages }, data);
    }
    addLazyChapter(loader: PaginatorChapterLoader, data: ChapterData): this {
        return this.addChapterSource({ kind: "chapterLoader", loader, pages: null }, data);
    }
    addPageLoader(pageCount: number, loader: PaginatorPageLoader, data: ChapterData): this {
        if (pageCount < 1 || !Number.isInteger(pageCount))
            throw new Error("[Paginator] Page-loader page count must be a positive integer");
        return this.addChapterSource({ kind: "pageLoader", loader, pageCount }, data);
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

    setPaginationType(type: PaginationType): this {
        this.options.type = type;
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
            const destination = await this.resolveDestination(chapterIndex, nestedIndex);
            const page = await this.loadPage(destination);
            this.state.index = destination;
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
                if (this.isLazyDestination(this.state.index) && this.options.onLoading) {
                    const placeholder = await this.options.onLoading(this.state.index);
                    if (placeholder && this.state.active) {
                        this.validatePageFormat(placeholder);
                        await this.editPage(placeholder);
                        placeholderShown = true;
                    }
                }
                const page = await this.loadPage(this.state.index);
                if (!this.state.active) return;
                await this.editPage(page);
                if (!this.state.active) return;
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

    async send(handler: SendHandler, options?: DynaSendOptions): Promise<Message | null> {
        if (!this.chapters.length) throw new Error("[Paginator] Cannot send without any chapters");
        this.validateStaticFormats();
        this.state.sendOptions = options;
        this.state.active = true;
        try {
            const destination = await this.resolveDestination(this.state.index.chapter, this.state.index.nested);
            const page = await this.loadPage(destination);
            this.state.index = destination;
            this.state.currentPage = page;
            this.state.message = await dynaSend(handler, this.buildSendOptions(page, options));
        } catch (error) {
            this.state.active = false;
            console.error("[Paginator] Initial load failed:", error);
            throw error;
        }
        if (this.state.message) this.collectComponents();
        else this.state.active = false;
        return this.state.message;
    }

    stop(reason = "manual"): void {
        this.collector?.stop(reason);
    }
}
