import type {
    ActionRowBuilder,
    APIContainerComponent,
    APIThumbnailComponent,
    ButtonComponentData,
    ColorResolvable,
    Message,
    MessageActionRowComponentBuilder
} from "discord.js";
import type { DynaSendOptions, RequiredDynaSendOptions, SendHandler } from "./dynaSend.js";

import { ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, resolveColor, ThumbnailBuilder } from "discord.js";
import { dynaSend } from "./dynaSend.js";
import { resolveGlobalEmbedColor } from "./toolConfig.js";

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
    text?: string | (string | null | undefined)[];
    /** Button accessory data. */
    button?: Partial<ButtonComponentData>;
    /** Thumbnail accessory data. */
    thumbnail?: Partial<APIThumbnailComponent>;
}

export interface BetterContainerSeparatorOptions {
    /** Whether to render the separator divider. */
    divider?: boolean;
    /** Separator spacing size. */
    spacing?: number;
}

interface BetterContainerState {
    color: ColorResolvable | ColorResolvable[] | null;
}

function normalizeText(text: string | (string | null | undefined)[]): string {
    if (!Array.isArray(text)) return text;
    return text.filter(line => line != null).join("\n");
}

function addComponentsV2Flag(flags: DynaSendOptions["flags"]): DynaSendOptions["flags"] {
    if (Array.isArray(flags)) {
        return flags.includes(MessageFlags.IsComponentsV2) ? flags : [...flags, MessageFlags.IsComponentsV2];
    }

    if (typeof flags === "number") return flags | MessageFlags.IsComponentsV2;
    if (!flags) return [MessageFlags.IsComponentsV2];

    return [flags, MessageFlags.IsComponentsV2];
}

export class BetterContainer {
    private container = new ContainerBuilder();
    private data: BetterContainerState;

    constructor(options: BetterContainerOptions = {}) {
        this.data = {
            color: options.color === undefined ? resolveGlobalEmbedColor() : options.color
        };

        this.build();
    }

    private resolveColor(): number | null {
        if (!this.data.color) return null;

        const color = Array.isArray(this.data.color)
            ? (this.data.color[Math.floor(Math.random() * this.data.color.length)] ?? null)
            : this.data.color;

        if (!color) return null;
        return resolveColor(color);
    }

    private build(): void {
        const color = this.resolveColor();
        if (color === null) {
            this.container.clearAccentColor();
            return;
        }

        this.container.setAccentColor(color);
    }

    /**
     * Creates a new BetterContainer using this container's data with optional overrides.
     * @param overrides Data to override on the cloned container
     */
    clone(overrides: Partial<BetterContainerOptions> = {}): BetterContainer {
        return new BetterContainer({ ...this.data, ...overrides });
    }

    /**
     * Converts the container into Discord API container JSON.
     */
    toJSON(): APIContainerComponent {
        this.build();
        return this.container.toJSON();
    }

    /**
     * Sets the container accent color.
     * @param color Color, random color choices, or null to clear it
     */
    setColor(color: ColorResolvable | ColorResolvable[] | null): this {
        this.data.color = color;
        this.build();
        return this;
    }

    /** Clears the container accent color. */
    clearColor(): this {
        return this.setColor(null);
    }

    /**
     * Adds a separator component.
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
     * Adds a text display component.
     * @param text Text content or lines to add
     */
    addText(text: string | (string | null | undefined)[]): this {
        this.container.addTextDisplayComponents(display => display.setContent(normalizeText(text)));
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
            if (options.text) {
                section.addTextDisplayComponents(display => display.setContent(normalizeText(options.text ?? "")));
            }

            // --- Accessory ---
            if (options.thumbnail) section.setThumbnailAccessory(new ThumbnailBuilder(options.thumbnail));
            if (options.button) {
                section.setButtonAccessory(
                    new ButtonBuilder({ style: ButtonStyle.Secondary, ...options.button } as ButtonComponentData)
                );
            }

            return section;
        });

        return this;
    }

    /**
     * Adds action rows to the container.
     * @param rows Action rows to add
     */
    addActionRow(...rows: ActionRowBuilder<MessageActionRowComponentBuilder>[]): this {
        this.container.addActionRowComponents(...rows);
        return this;
    }

    /**
     * Sends this container through dynaSend.
     * @param handler Discord object to send through
     * @param options Additional dynaSend options
     */
    async send(handler: SendHandler, options: DynaSendOptions = {}): Promise<Message | null> {
        this.build();

        const sendOptions: RequiredDynaSendOptions = {
            ...options,
            withResponse: options.withResponse ?? true,
            components: [this.container, ...(options.components ?? [])],
            flags: addComponentsV2Flag(options.flags)
        };

        return dynaSend(handler, sendOptions);
    }
}
