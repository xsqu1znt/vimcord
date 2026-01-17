import { globalVimcordToolsConfig, VimcordToolsConfig } from "@/configs/tools.config";
import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ComponentType,
    ContainerBuilder,
    EmbedBuilder,
    InteractionCollector,
    Message,
    MessageReaction,
    ReactionCollector,
    SelectMenuComponentOptionData,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
    StringSelectMenuOptionBuilder,
    User,
    UserResolvable
} from "discord.js";
import EventEmitter from "node:events";
import { BetterContainer } from "./BetterContainer";
import { BetterEmbed } from "./BetterEmbed";
import { dynaSend, DynaSendOptions, RequiredDynaSendOptions } from "./dynaSend";
import { EmbedResolvable, SendHandler, SendMethod } from "./types";

/* NOTE: SinglePageResolvable now supports AttachmentBuilder for image-only pages */
export type SinglePageResolvable = string | EmbedResolvable | ContainerBuilder | BetterContainer | AttachmentBuilder;
/* NOTE: A PageResolvable can now be a single item OR an array of embeds (which counts as 1 page) */
export type PageResolvable = SinglePageResolvable | EmbedResolvable[];
export type Chapter = PageResolvable[];

export interface PageIndex {
    chapter: number;
    nested: number;
}

export interface ChapterData extends Omit<SelectMenuComponentOptionData, "value"> {
    value?: string;
    /** Optional attachments mapped to each nested page index */
    files?: (AttachmentBuilder | undefined)[];
}

export interface PaginationEvent {
    beforeChapterChange: [chapterIndex: number];
    chapterChange: [option: StringSelectMenuOptionBuilder, page: PageResolvable, index: PageIndex];
    beforePageChange: [nestedIndex: number];
    pageChange: [page: PageResolvable, index: PageIndex];
    first: [page: PageResolvable, index: PageIndex];
    back: [page: PageResolvable, index: PageIndex];
    jump: [page: PageResolvable, index: PageIndex];
    next: [page: PageResolvable, index: PageIndex];
    last: [page: PageResolvable, index: PageIndex];
    collect: [interaction: StringSelectMenuInteraction | ButtonInteraction, page: PageResolvable, index: PageIndex];
    react: [reaction: MessageReaction, user: User, page: PageResolvable, index: PageIndex];
    preTimeout: [message: Message];
    postTimeout: [message: Message];
}

export interface PaginatorOptions {
    /** @default {@link PaginationType.Short} */
    type?: PaginationType;
    participants?: UserResolvable[];
    /** Shorthand to create the Paginator with only 1 chapter */
    pages?: PageResolvable[];
    /** @default false */
    useReactions?: boolean;
    /** @default false */
    dynamic?: boolean;
    timeout?: number;
    onTimeout?: PaginationTimeoutType;
    config?: VimcordToolsConfig;
}

export interface PaginatorData {
    message: Message | null;
    messageActionRows: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[];
    messageSendOptions: DynaSendOptions | undefined;
    extraButtons: { index: number; component: ButtonBuilder }[];

    page: {
        current: PageResolvable | null;
        index: PageIndex;
    };

    navigation: {
        reactions: { name: string; id: string }[];
        isRequired: boolean;
        isLong: boolean;
        canJump: boolean;
    };

    collectors: {
        component: InteractionCollector<StringSelectMenuInteraction | ButtonInteraction> | null;
        reaction: ReactionCollector | null;
    };

    components: {
        chapterSelect: StringSelectMenuBuilder;
        navigation: Record<keyof VimcordToolsConfig["paginator"]["buttons"], ButtonBuilder>;

        actionRows: {
            chapterSelect: ActionRowBuilder<StringSelectMenuBuilder>;
            navigation: ActionRowBuilder<ButtonBuilder>;
        };
    };
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

function wrapPositive(num: number, max: number) {
    return ((num % (max + 1)) + (max + 1)) % (max + 1);
}

function createNavButton(id: keyof VimcordToolsConfig["paginator"]["buttons"], config: VimcordToolsConfig): ButtonBuilder {
    const data = config.paginator.buttons[id];
    const btn = new ButtonBuilder({ customId: `btn_${id}`, style: ButtonStyle.Secondary });

    if (data.label) {
        btn.setLabel(data.label);
    } else {
        btn.setEmoji(data.emoji.name);
    }

    return btn;
}

function isEmbed(item: any): item is EmbedResolvable {
    return item instanceof EmbedBuilder || item instanceof BetterEmbed;
}

// Helper to normalize pages input
// [Embed1, Embed2] -> treated as 2 pages
// [[Embed1, Embed2]] -> treated as 1 page (group)
function resolvePages(pages: PageResolvable | PageResolvable[]): PageResolvable[] {
    if (Array.isArray(pages)) {
        if (pages.length === 0) return [];
        // If the first item is an Array, it is a list of Groups [[E1, E2], [E3]]
        if (Array.isArray(pages[0])) return pages as PageResolvable[];
        // If the first item is an Embed/String, it is a list of Single Pages [E1, E2]
        // This means we treat top-level arrays of embeds as MULTIPLE pages
        return pages as PageResolvable[];
    }
    // Single item passed (String, Embed, or Group if manually typed but unlikely here)
    return [pages];
}

export class Paginator {
    chapters: { id: string; pages: Chapter; files?: (AttachmentBuilder | undefined)[] }[] = [];

    private options: Required<Omit<PaginatorOptions, "config">>;
    private config: VimcordToolsConfig;
    private data: PaginatorData;
    private events: Record<keyof PaginationEvent, { listener: (...args: any[]) => any; once: boolean }[]>;

    eventEmitter = new EventEmitter<PaginationEvent>();

    constructor(options: PaginatorOptions = {}) {
        this.config = options.config || globalVimcordToolsConfig;

        this.options = {
            type: options.type ?? PaginationType.Short,
            participants: options.participants ?? [],
            pages: options.pages ?? [],
            useReactions: options.useReactions ?? false,
            dynamic: options.dynamic ?? false,
            timeout: options.timeout ?? this.config.timeouts.pagination,
            onTimeout: options.onTimeout ?? PaginationTimeoutType.ClearComponents
        };

        this.data = {
            message: null,
            messageActionRows: [],
            messageSendOptions: undefined,
            extraButtons: [],

            page: { current: null, index: { chapter: 0, nested: 0 } },

            navigation: { reactions: [], isRequired: false, isLong: false, canJump: false },
            collectors: { component: null, reaction: null },

            components: {
                chapterSelect: new StringSelectMenuBuilder({ customId: "ssm_chapterSelect" }),
                navigation: {
                    first: createNavButton("first", this.config),
                    back: createNavButton("back", this.config),
                    jump: createNavButton("jump", this.config),
                    next: createNavButton("next", this.config),
                    last: createNavButton("last", this.config)
                },

                actionRows: {
                    chapterSelect: new ActionRowBuilder<StringSelectMenuBuilder>(),
                    navigation: new ActionRowBuilder<ButtonBuilder>()
                }
            }
        };

        this.data.components.actionRows.chapterSelect.setComponents(this.data.components.chapterSelect);

        this.events = {
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

        /* Error Checking */
        for (const [key, val] of Object.entries(this.config.paginator.buttons)) {
            if (!val.emoji.id) throw new Error(`[Paginator] Button '${key}.id' is not defined`);
            if (!val.emoji.name) throw new Error(`[Paginator] Button '${key}.name' is not defined`);
        }
    }

    private async build(): Promise<void> {
        await this.setPage();

        this.data.components.actionRows.navigation.setComponents([]);
        this.data.navigation.reactions = [];
        this.data.messageActionRows = [];

        if (this.data.navigation.isRequired) {
            let navTypes: (keyof VimcordToolsConfig["paginator"]["buttons"])[] = [];

            if (this.options.dynamic) {
                const isLong = this.data.navigation.isLong;
                const isJump =
                    this.options.type === PaginationType.ShortJump || this.options.type === PaginationType.LongJump;

                if (isLong) {
                    this.options.type = isJump ? PaginationType.LongJump : PaginationType.Long;
                } else {
                    this.options.type = isJump ? PaginationType.ShortJump : PaginationType.Short;
                }
            }

            switch (this.options.type) {
                case PaginationType.Short:
                    navTypes = ["back", "next"];
                    break;
                case PaginationType.ShortJump:
                    navTypes = ["back", "jump", "next"];
                    break;
                case PaginationType.Long:
                    navTypes = ["first", "back", "next", "last"];
                    break;
                case PaginationType.LongJump:
                    navTypes = ["first", "back", "jump", "next", "last"];
                    break;
            }

            if (this.options.useReactions) {
                this.data.navigation.reactions = navTypes.map(type => {
                    const data = this.config.paginator.buttons[type]!;
                    return { name: data.emoji.name, id: data.emoji.id };
                });
            } else {
                this.data.components.actionRows.navigation.setComponents(
                    navTypes.map(type => this.data.components.navigation[type])
                );
            }
        }

        if (this.chapters.length > 1) {
            this.data.messageActionRows.push(this.data.components.actionRows.chapterSelect);
        }

        if ((this.data.navigation.isRequired && !this.options.useReactions) || this.data.extraButtons.length) {
            for (const btn of this.data.extraButtons) {
                this.data.components.actionRows.navigation.components.splice(btn.index, 0, btn.component);
            }
            this.data.messageActionRows.push(this.data.components.actionRows.navigation);
        }
    }

    private buildSendOptions(options: DynaSendOptions = {}): RequiredDynaSendOptions {
        const sendOptions: RequiredDynaSendOptions = {
            content: "",
            embeds: [],
            components: [],
            flags: [],
            files: [], // Explicitly empty to clear previous files on page switch
            ...options,
            withResponse: true
        };

        const page = this.data.page.current;

        /* Logic for AttachmentBuilder augmentation via ChapterData */
        const currentChapter = this.chapters[this.data.page.index.chapter];
        const chapterFile = currentChapter?.files?.[this.data.page.index.nested];
        if (chapterFile) sendOptions.files!.push(chapterFile);

        if (Array.isArray(page)) {
            // Handle array of embeds (Group of Embeds per page)
            sendOptions.embeds!.push(...page);
        } else if (typeof page === "string") {
            sendOptions.content = page;
        } else if (isEmbed(page)) {
            sendOptions.embeds!.push(page);
        } else if (page instanceof AttachmentBuilder) {
            /* Logic for Image-only pages */
            sendOptions.files!.push(page);
        } else if (page instanceof ContainerBuilder || page instanceof BetterContainer) {
            sendOptions.components!.push(page);

            if (!(sendOptions.flags as string[]).includes("IsComponentsV2")) {
                (sendOptions.flags as string[]).push("IsComponentsV2");
            }
        }

        sendOptions.components!.push(...this.data.messageActionRows);
        return sendOptions;
    }

    private async handlePostTimeout(): Promise<void> {
        if (!this.data.message) return;

        this.callEventStack("preTimeout", this.data.message);

        // Stop component and reaction collectors
        this.data.collectors.component?.stop();
        this.data.collectors.reaction?.stop();

        // Handle the configured timeout action
        switch (this.options.onTimeout) {
            case PaginationTimeoutType.DisableComponents:
                if (!this.data.message.editable) break;

                const disabledNavComponents = this.data.components.actionRows.navigation.components.map(component => {
                    if ("setDisabled" in component) {
                        return component.setDisabled(true);
                    }
                    return component;
                });

                const disabledNavRow = ActionRowBuilder.from(this.data.components.actionRows.navigation).setComponents(
                    disabledNavComponents
                );

                const newComponents: ActionRowBuilder<any>[] = [];

                const currentPage = this.data.page.current;
                if (currentPage instanceof ContainerBuilder || currentPage instanceof BetterContainer) {
                    // To maintain the message appearance, add the container back at the end
                    // Note: The components *inside* this container are NOT being disabled,
                    // as that was the source of the type error.
                    newComponents.push(currentPage as unknown as ActionRowBuilder<any>);
                }

                if (this.chapters.length > 1) {
                    // Ensure the chapter select is also disabled if required
                    const disabledSelect = StringSelectMenuBuilder.from(this.data.components.chapterSelect).setDisabled(
                        true
                    );
                    newComponents.push(
                        ActionRowBuilder.from(this.data.components.actionRows.chapterSelect).setComponents(disabledSelect)
                    );
                }

                if (disabledNavRow.components.length > 0) {
                    newComponents.push(disabledNavRow);
                }

                await this.data.message.edit({ components: newComponents }).catch(Boolean);

                // If using reactions, remove them
                if (this.options.useReactions) {
                    await this.nav_removeFromMessage();
                }
                break;

            case PaginationTimeoutType.ClearComponents:
                if (this.data.message.editable) {
                    // nav_removeFromMessage handles removing both components and reactions
                    await this.nav_removeFromMessage();
                }
                break;

            case PaginationTimeoutType.DeleteMessage:
                await this.data.message.delete().catch(Boolean);
                break;

            case PaginationTimeoutType.DoNothing:
                break;
        }

        this.callEventStack("postTimeout", this.data.message);
    }

    private async nav_removeFromMessage(): Promise<void> {
        if (!this.data.message?.editable) return;

        if (this.options.useReactions) {
            await this.data.message.reactions.removeAll().catch(Boolean);
        } else {
            const newComponents = this.data.message.components.filter(c => c.type !== ComponentType.Container);
            await this.data.message.edit({ components: newComponents }).catch(Boolean);
        }
    }

    private async nav_addReactions(): Promise<void> {
        if (!this.data.message || !this.options.useReactions || !this.data.navigation.reactions.length) return;
        for (const r of this.data.navigation.reactions) {
            await this.data.message.react(r.id).catch(Boolean);
        }
    }

    private async collect_components(): Promise<void> {
        if (!this.data.message || !this.data.messageActionRows.length) return;
        if (this.data.collectors.component) {
            this.data.collectors.component.resetTimer();
            return;
        }

        const participantIds = this.options.participants.map(p => (typeof p === "string" ? p : p.id));

        const collector = this.data.message.createMessageComponentCollector({
            filter: async i => {
                if (!participantIds.length) return true;

                if (participantIds.includes(i.user.id)) {
                    return true;
                } else {
                    await i.reply({ content: this.config.paginator.notAParticipantMessage, flags: "Ephemeral" });
                    return false;
                }
            },
            ...(this.options.timeout ? { idle: this.options.timeout } : {})
        }) as InteractionCollector<StringSelectMenuInteraction | ButtonInteraction>;

        this.data.collectors.component = collector;

        collector.on("collect", async i => {
            if (!i.isStringSelectMenu() && !i.isButton()) return;
            collector.resetTimer();

            this.callEventStack("collect", i, this.data.page.current!, this.data.page.index);

            try {
                if (i.customId === "btn_jump") {
                    this.callEventStack("jump", this.data.page.current!, this.data.page.index);
                    await i.reply({ content: "Jump not implemented yet.", flags: "Ephemeral" });
                    return;
                }

                switch (i.customId) {
                    case "ssm_chapterSelect":
                        await i.deferUpdate().catch(Boolean);
                        const chapterIndex = this.chapters.findIndex(
                            c => c.id === (i as StringSelectMenuInteraction).values[0]
                        );
                        await this.setPage(chapterIndex, 0);
                        await this.refresh();
                        break;

                    case "btn_first":
                        await i.deferUpdate().catch(Boolean);
                        this.callEventStack("first", this.data.page.current!, this.data.page.index);
                        await this.setPage(this.data.page.index.chapter, 0);
                        await this.refresh();
                        break;

                    case "btn_back":
                        await i.deferUpdate().catch(Boolean);
                        this.callEventStack("back", this.data.page.current!, this.data.page.index);
                        await this.setPage(this.data.page.index.chapter, this.data.page.index.nested - 1);
                        await this.refresh();
                        break;

                    case "btn_next":
                        await i.deferUpdate().catch(Boolean);
                        this.callEventStack("next", this.data.page.current!, this.data.page.index);
                        await this.setPage(this.data.page.index.chapter, this.data.page.index.nested + 1);
                        await this.refresh();
                        break;

                    case "btn_last":
                        await i.deferUpdate().catch(Boolean);
                        this.callEventStack("last", this.data.page.current!, this.data.page.index);
                        await this.setPage(
                            this.data.page.index.chapter,
                            this.chapters[this.data.page.index.chapter]!.pages.length - 1
                        );
                        await this.refresh();
                        break;
                }
            } catch (err) {
                console.error("[Paginator] Component navigation error", err);
            }
        });

        collector.on("end", async () => {
            this.data.collectors.component = null;
            this.handlePostTimeout();
        });
    }

    private async callEventStack<T extends keyof PaginationEvent>(event: T, ...args: PaginationEvent[T]): Promise<void> {
        if (!this.events[event].length) return;
        const listeners = [...this.events[event]];
        for (const _event of listeners) {
            await _event.listener(...args);
            if (_event.once) {
                const originalIndex = this.events[event].indexOf(_event);
                if (originalIndex > -1) this.events[event].splice(originalIndex, 1);
            }
        }
    }

    on<T extends keyof PaginationEvent>(event: T, listener: (...args: PaginationEvent[T]) => void, once = false): this {
        this.events[event].push({ listener, once });
        return this;
    }

    /** Adds a chapter to the paginator.
     * @param pages The pages for this chapter.
     * Note: `[Embed1, Embed2]` = 2 Pages. `[[Embed1, Embed2]]` = 1 Page (Group of 2).
     * @param data Metadata for the chapter select menu. */
    addChapter(pages: PageResolvable | PageResolvable[], data: ChapterData): this {
        if (data.default === undefined && !this.chapters.length) {
            data.default = true;
        }

        if (data.default) {
            this.data.components.chapterSelect.options.forEach(opt => opt.setDefault(false));
        }

        if (!data.value) {
            data.value = `ssm_c:${this.chapters.length}`;
        }

        // Normalize pages to standard array
        const normalizedPages = resolvePages(pages);

        this.chapters.push({ id: data.value, pages: normalizedPages, files: data.files });
        this.data.components.chapterSelect.addOptions(data as SelectMenuComponentOptionData);
        return this;
    }

    spliceChapters(index: number, deleteCount: number): this {
        this.chapters.splice(index, deleteCount);
        this.data.components.chapterSelect.spliceOptions(index, deleteCount);
        return this;
    }

    hydrateChapter(index: number, pages: PageResolvable | PageResolvable[], set?: boolean): this {
        if (!this.chapters[index]) {
            throw new Error(`[Paginator] Could not find chapter at index ${index}`);
        }

        const normalizedPages = resolvePages(pages);

        if (set) {
            this.chapters[index].pages = normalizedPages;
        } else {
            this.chapters[index].pages.push(...normalizedPages);
        }

        return this;
    }

    setPaginationType(type: PaginationType): this {
        this.options.type = type;
        return this;
    }

    insertButtonAt(index: number, component: ButtonBuilder): this {
        if (this.data.components.actionRows.navigation.components.length >= 5) {
            throw new Error("[Paginator] You cannot have more than 5 components in 1 action row. Use a separate ActionRow");
        }
        this.data.extraButtons.push({ index, component });
        return this;
    }

    removeButtonAt(...index: number[]): this {
        index.forEach(i => this.data.extraButtons.splice(i, 1));
        return this;
    }

    async setPage(
        chapterIndex: number = this.data.page.index.chapter,
        nestedIndex: number = this.data.page.index.nested
    ): Promise<void> {
        const _oldChapterIndex = this.data.page.index.chapter;
        this.data.page.index.chapter = wrapPositive(chapterIndex, this.chapters.length - 1);

        const currentChapter = this.chapters[this.data.page.index.chapter];
        if (!currentChapter) {
            throw new Error(`[Paginator] Could not find chapter at index ${this.data.page.index.chapter}`);
        }

        await this.callEventStack("beforeChapterChange", this.data.page.index.chapter);
        await this.callEventStack("beforePageChange", nestedIndex);

        const _oldNestedIndex = this.data.page.index.nested;
        this.data.page.index.nested =
            this.data.page.index.chapter !== _oldChapterIndex
                ? 0
                : wrapPositive(nestedIndex, currentChapter.pages.length - 1);

        const currentPage = currentChapter.pages[this.data.page.index.nested];
        if (!currentPage) {
            throw new Error(`[Paginator] Could not find page at index ${this.data.page.index.nested}`);
        }

        this.data.page.current = currentPage;

        this.data.components.chapterSelect.options.forEach(opt => opt.setDefault(false));
        this.data.components.chapterSelect.options.at(this.data.page.index.chapter)?.setDefault(true);

        const { jumpableThreshold, longThreshold } = this.config.paginator;
        this.data.navigation.isRequired = currentChapter.pages.length >= 2;
        this.data.navigation.canJump = currentChapter.pages.length >= jumpableThreshold;
        this.data.navigation.isLong = currentChapter.pages.length >= longThreshold;

        if (this.data.page.index.chapter !== _oldChapterIndex) {
            this.callEventStack(
                "chapterChange",
                this.data.components.chapterSelect.options.at(this.data.page.index.chapter)!,
                this.data.page.current,
                this.data.page.index
            );
            this.callEventStack("pageChange", this.data.page.current, this.data.page.index);
        } else if (this.data.page.index.nested !== _oldNestedIndex) {
            this.callEventStack("pageChange", this.data.page.current, this.data.page.index);
        }
    }

    async refresh(): Promise<Message | null> {
        if (!this.data.message) {
            throw new Error("[Paginator] Cannot refresh, message not sent");
        }

        if (!this.data.message.editable) {
            throw new Error("[Paginator] Cannot refresh, message is not editable");
        }

        await this.build();

        this.data.message = await dynaSend(this.data.message, {
            sendMethod: SendMethod.MessageEdit,
            ...this.buildSendOptions(this.data.messageSendOptions)
        });

        return this.data.message;
    }

    async send(handler: SendHandler, options?: DynaSendOptions): Promise<Message | null> {
        this.data.messageSendOptions = options;
        await this.build();

        this.data.message = await dynaSend(handler, this.buildSendOptions(options));
        if (!this.data.message) return null;

        this.collect_components();
        return this.data.message;
    }
}
