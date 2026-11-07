import type {
    APIContainerComponent,
    APIThumbnailComponent,
    ButtonComponentData,
    ColorResolvable,
    Message,
    MessageActionRowComponentBuilder
} from "discord.js";
import type { BetterEmbedDescriptionLine } from "./betterEmbed.js";
import type {
    DynaSendOptions,
    InteractionBasedSendHandler,
    MessageReturningSendOptions,
    MessageSendHandler,
    RequiredDynaSendOptions,
    SendHandler,
    SentMessage,
    TriggeredMessage
} from "./dynaSend.js";

import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    ContainerBuilder,
    MessageFlags,
    resolveColor,
    ThumbnailBuilder
} from "discord.js";
import { addMessageFlag, dynaSend } from "./dynaSend.js";
import { resolveGlobalEmbedColor, resolveUxColor } from "./uxConfig.js";

export interface BetterContainerOptions {
    /** Accent color, random color choices, or null to clear it. */
    color?: ColorResolvable | ColorResolvable[] | null;
}

export interface BetterContainerMediaItem {
    /** Media URL or URLs to add. */
    url: string | string[];
    /** Whether the media should be marked as a spoiler. */
    spoiler?: boolean;
    /** Media description. */
    description?: string;
}

export interface BetterContainerSectionOptions {
    /** Text content or lines for the section body. */
    text?: BetterEmbedDescriptionLine | BetterEmbedDescriptionLine[];
    /** Button accessory. Data objects default to the Secondary style. */
    button?: ButtonBuilder | Partial<ButtonComponentData>;
    /** Thumbnail accessory, as a URL or thumbnail data. */
    thumbnail?: string | Partial<APIThumbnailComponent>;
}

export interface BetterContainerSeparatorOptions {
    /** Whether to render the separator divider. */
    divider?: boolean;
    /** Separator spacing size. */
    spacing?: number;
}

const MAX_BUTTONS_PER_ROW = 5;

/** Joins lines, dropping conditional falsey values. An empty string inside a list stays as a blank line. */
function normalizeText(text: BetterEmbedDescriptionLine | BetterEmbedDescriptionLine[]): string {
    const lines = Array.isArray(text) ? text : [text];
    return lines.filter(line => typeof line === "string").join("\n");
}

export class BetterContainer {
    private readonly container = new ContainerBuilder();

    constructor(options: BetterContainerOptions = {}) {
        this.setColor(options.color === undefined ? resolveGlobalEmbedColor() : options.color);
    }

    /** Converts the container into Discord API container JSON, which also lets Discord.js accept it as a component. */
    toJSON(): APIContainerComponent {
        return this.container.toJSON();
    }

    /**
     * Sets the container accent color. A pool is rolled here, once, so serializing or sending never re-rolls it.
     * @param color Color, random color choices, or null to clear it
     */
    setColor(color: ColorResolvable | ColorResolvable[] | null): this {
        const resolved = resolveUxColor(color);
        if (resolved === null) this.container.clearAccentColor();
        else this.container.setAccentColor(resolveColor(resolved));
        return this;
    }

    /** Clears the container accent color. */
    clearColor(): this {
        return this.setColor(null);
    }

    /**
     * Adds a separator component, with Discord's visible divider by default.
     * @param options Separator options
     */
    addSeparator(options: BetterContainerSeparatorOptions = {}): this {
        this.container.addSeparatorComponents(separator => {
            if (options.divider !== undefined) separator.setDivider(options.divider);
            if (options.spacing !== undefined) separator.setSpacing(options.spacing);
            return separator;
        });

        return this;
    }

    /**
     * Adds a text display component. Text that comes out empty adds nothing, so `show && "line"` is safe.
     * @param text Text content or lines to add
     */
    addText(text: BetterEmbedDescriptionLine | BetterEmbedDescriptionLine[]): this {
        const content = normalizeText(text);
        if (content) this.container.addTextDisplayComponents(display => display.setContent(content));
        return this;
    }

    /**
     * Adds a media gallery component.
     * @param media Media items to add
     */
    addMedia(...media: BetterContainerMediaItem[]): this {
        this.container.addMediaGalleryComponents(gallery => {
            for (const item of media) {
                const urls = Array.isArray(item.url) ? item.url : [item.url];

                for (const url of urls) {
                    gallery.addItems(mediaItem => {
                        mediaItem.setURL(url);
                        if (item.spoiler) mediaItem.setSpoiler(true);
                        if (item.description) mediaItem.setDescription(item.description);
                        return mediaItem;
                    });
                }
            }

            return gallery;
        });

        return this;
    }

    /**
     * Adds a section with optional text and accessory.
     * @param options Section options
     */
    addSection(options: BetterContainerSectionOptions): this {
        this.container.addSectionComponents(section => {
            // --- Text ---
            const text = normalizeText(options.text);
            if (text) section.addTextDisplayComponents(display => display.setContent(text));

            // --- Accessory ---
            const { thumbnail, button } = options;
            if (thumbnail) {
                section.setThumbnailAccessory(
                    new ThumbnailBuilder(typeof thumbnail === "string" ? { media: { url: thumbnail } } : thumbnail)
                );
            }
            if (button) {
                section.setButtonAccessory(
                    button instanceof ButtonBuilder
                        ? button
                        : new ButtonBuilder({ style: ButtonStyle.Secondary, ...button } as ButtonComponentData)
                );
            }

            return section;
        });

        return this;
    }

    /**
     * Adds components in an action row, splitting buttons into rows of 5.
     * Discord doesn't allow buttons and a select in one row, or more than one select, so both throw.
     * @param components Buttons, or a single select menu
     */
    addRow(...components: MessageActionRowComponentBuilder[]): this {
        const buttons = components.filter(c => c.data.type === ComponentType.Button).length;
        if (buttons && buttons < components.length) {
            throw new Error("[BetterContainer] A row cannot mix buttons and select menus");
        }
        if (!buttons && components.length > 1) throw new Error("[BetterContainer] A row can only hold one select menu");

        for (let i = 0; i < components.length; i += MAX_BUTTONS_PER_ROW) {
            this.container.addActionRowComponents(
                new ActionRowBuilder<MessageActionRowComponentBuilder>().setComponents(
                    components.slice(i, i + MAX_BUTTONS_PER_ROW)
                )
            );
        }
        return this;
    }

    private toSendOptions(options: DynaSendOptions): RequiredDynaSendOptions {
        return {
            ...options,
            components: [this, ...(options.components ?? [])],
            flags: addMessageFlag(options.flags, MessageFlags.IsComponentsV2)
        };
    }

    /**
     * Sends this container through dynaSend.
     * A fresh interaction reply resolves to `null` unless `withResponse` is set.
     * @param handler Discord object to send through
     * @param options Additional dynaSend options
     */
    send(handler: Message, options: DynaSendOptions & { method: "edit" }): Promise<Message>;
    send<T extends MessageSendHandler>(handler: T, options?: DynaSendOptions): Promise<SentMessage<T>>;
    send<T extends SendHandler>(handler: T, options: DynaSendOptions & MessageReturningSendOptions): Promise<SentMessage<T>>;
    send<T extends SendHandler>(handler: T, options?: DynaSendOptions): Promise<SentMessage<T> | null>;
    send(handler: SendHandler, options: DynaSendOptions = {}): Promise<Message | null> {
        return dynaSend(handler, this.toSendOptions(options));
    }

    /**
     * Sends this container as a follow-up to an interaction.
     * @param interaction Interaction to follow up on
     * @param options Additional dynaSend options
     */
    followUp(interaction: InteractionBasedSendHandler, options: DynaSendOptions = {}): Promise<TriggeredMessage> {
        return dynaSend(interaction, { ...this.toSendOptions(options), method: "followUp" });
    }

    /**
     * Edits a message, or an interaction's reply, to show this container.
     * @param target Message or interaction to edit
     * @param options Additional dynaSend options
     */
    edit(target: InteractionBasedSendHandler | Message, options: DynaSendOptions = {}): Promise<Message> {
        return dynaSend(target, { ...this.toSendOptions(options), method: "edit" });
    }
}
