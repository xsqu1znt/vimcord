import type { APIEmbed, APIEmbedField, ColorResolvable, Message } from "discord.js";
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

import { resolveColor } from "discord.js";
import { dynaSend } from "./dynaSend.js";
import { resolveEmbedColor } from "./uxConfig.js";

/** Embed author text with an optional icon and link. */
export interface BetterEmbedAuthor {
    /** Text displayed in this embed block. */
    text: string;
    /** Icon URL; null removes the icon. */
    icon?: string | null;
    /** URL opened when this text is clicked. */
    hyperlink?: string | null;
}

/** Embed title text with an optional link. */
export interface BetterEmbedTitle {
    /** Text displayed in this embed block. */
    text: string;
    /** URL opened when this text is clicked. */
    hyperlink?: string | null;
}

/** Embed footer text with an optional icon. */
export interface BetterEmbedFooter {
    /** Text displayed in this embed block. */
    text: string;
    /** Icon URL; null removes the icon. */
    icon?: string | null;
}

/** A description line or a falsey conditional value that should be omitted. */
export type BetterEmbedDescriptionLine = string | false | 0 | 0n | null | undefined;

/** Embed content and appearance passed to BetterEmbed. */
export interface BetterEmbedData {
    /** Author text or author appearance; null clears it. @default null */
    author?: string | BetterEmbedAuthor | null;
    /** Title text or linked title; null clears it. @default null */
    title?: string | BetterEmbedTitle | null;
    /** Thumbnail image URL; null clears it. @default null */
    thumbnailUrl?: string | null;
    /** Description text or conditional lines joined with newlines. @default null */
    description?: string | BetterEmbedDescriptionLine[] | null;
    /** Main image URL; null clears it. @default null */
    imageUrl?: string | null;
    /** Footer text or footer appearance; null clears it. @default null */
    footer?: string | BetterEmbedFooter | null;
    /** Embed fields; null and undefined entries are skipped. @default [] */
    fields?: (APIEmbedField | null | undefined)[];
    /** Fixed color, random pool, or null for no color. @default UX config's environment embed color */
    color?: ColorResolvable | ColorResolvable[] | null;
    /** Timestamp to display; true uses serialization time. @default null */
    timestamp?: number | boolean | Date | null;
}

interface BetterEmbedState {
    author: string | BetterEmbedAuthor | null;
    title: string | BetterEmbedTitle | null;
    thumbnailUrl: string | null;
    description: string | BetterEmbedDescriptionLine[] | null;
    imageUrl: string | null;
    footer: string | BetterEmbedFooter | null;
    fields: (APIEmbedField | null | undefined)[];
    color: ColorResolvable | ColorResolvable[] | null;
    timestamp: number | boolean | Date | null;
}

function isEmbedField(field: APIEmbedField | null | undefined): field is APIEmbedField {
    return Boolean(field);
}

function normalizeAuthor(author: string | BetterEmbedAuthor | null): BetterEmbedAuthor | null {
    return typeof author === "string" ? { text: author } : author;
}

function normalizeTitle(title: string | BetterEmbedTitle | null): BetterEmbedTitle | null {
    return typeof title === "string" ? { text: title } : title;
}

function normalizeFooter(footer: string | BetterEmbedFooter | null): BetterEmbedFooter | null {
    return typeof footer === "string" ? { text: footer } : footer;
}

function normalizeDescription(description: BetterEmbedState["description"]): string | null {
    // Keep empty strings as intentional blank lines while removing conditional falsey values.
    if (Array.isArray(description)) return description.filter(line => typeof line === "string").join("\n") || null;
    return description;
}

/** Builds embeds with conditional description lines and shared colors. */
export class BetterEmbed {
    private data: BetterEmbedState;

    constructor(data: BetterEmbedData = {}) {
        this.data = {
            author: data.author ?? null,
            title: data.title ?? null,
            thumbnailUrl: data.thumbnailUrl ?? null,
            description: data.description ?? null,
            imageUrl: data.imageUrl ?? null,
            footer: data.footer ?? null,
            fields: data.fields ?? [],
            color: data.color === undefined ? resolveEmbedColor() : data.color,
            timestamp: data.timestamp ?? null
        };
    }

    /** Creates the Discord payload directly from stored data. Setters only update data; this runs at the `toJSON()`/`send()` boundary, so a random `color` pool and `timestamp: true` resolve exactly once per serialization, not once per setter call. */
    toJSON(): APIEmbed {
        const author = normalizeAuthor(this.data.author);
        const title = normalizeTitle(this.data.title);
        const footer = normalizeFooter(this.data.footer);
        const description = normalizeDescription(this.data.description);
        const embed: APIEmbed = {};

        // --- Text Blocks ---
        if (author?.text) {
            embed.author = {
                name: author.text,
                icon_url: author.icon ?? undefined,
                url: author.hyperlink ?? undefined
            };
        }

        if (title?.text) {
            embed.title = title.text;
            if (title.hyperlink) embed.url = title.hyperlink;
        }

        if (description) embed.description = description;

        if (footer?.text) {
            embed.footer = {
                text: footer.text,
                icon_url: footer.icon ?? undefined
            };
        }

        // --- Media ---
        if (this.data.thumbnailUrl) embed.thumbnail = { url: this.data.thumbnailUrl };
        if (this.data.imageUrl) embed.image = { url: this.data.imageUrl };

        // --- Metadata ---
        const color = this.resolveColor();
        if (color !== null) embed.color = resolveColor(color);

        const timestamp = this.data.timestamp;
        if (timestamp !== null && timestamp !== false) {
            embed.timestamp = new Date(timestamp === true ? Date.now() : timestamp).toISOString();
        }

        const validFields = this.data.fields.filter(isEmbedField);
        if (validFields.length > 25) {
            throw new Error(`[BetterEmbed] Embeds cannot have more than 25 fields (got ${validFields.length})`);
        }

        if (validFields.length) embed.fields = validFields.map(field => ({ ...field }));
        return embed;
    }

    private resolveColor(): ColorResolvable | null {
        if (this.data.color === null) return null;
        if (!Array.isArray(this.data.color)) return this.data.color;
        if (!this.data.color.length) return null;
        return this.data.color[Math.floor(Math.random() * this.data.color.length)] ?? null;
    }

    /**
     * Creates a new BetterEmbed using this embed's data with optional overrides.
     * @param overrides Content and appearance overrides. Defaults to `{}`.
     */
    clone(overrides: Partial<BetterEmbedData> = {}): BetterEmbed {
        return new BetterEmbed({ ...this.data, ...overrides });
    }

    /**
     * Sets the embed author.
     * @param author Author text, author options, or null to clear it
     */
    setAuthor(author: string | BetterEmbedAuthor | null): this {
        this.data.author = author;
        return this;
    }

    /**
     * Sets the embed title.
     * @param title Title text, title options, or null to clear it
     */
    setTitle(title: string | BetterEmbedTitle | null): this {
        this.data.title = title;
        return this;
    }

    /**
     * Sets the embed description.
     * @param description Description text, description lines, or null to clear it
     */
    setDescription(description: BetterEmbedData["description"]): this {
        this.data.description = description ?? null;
        return this;
    }

    /**
     * Sets the embed thumbnail URL.
     * @param url Thumbnail URL or null to clear it
     */
    setThumbnail(url: string | null): this {
        this.data.thumbnailUrl = url;
        return this;
    }

    /**
     * Sets the embed image URL.
     * @param url Image URL or null to clear it
     */
    setImage(url: string | null): this {
        this.data.imageUrl = url;
        return this;
    }

    /**
     * Sets the embed footer.
     * @param footer Footer text, footer options, or null to clear it
     */
    setFooter(footer: string | BetterEmbedFooter | null): this {
        this.data.footer = footer;
        return this;
    }

    /**
     * Sets the embed color.
     * @param color Color, random color choices, or null to clear it
     */
    setColor(color: ColorResolvable | ColorResolvable[] | null): this {
        this.data.color = color;
        return this;
    }

    /**
     * Sets the embed timestamp.
     * @param timestamp Timestamp value, true for the current time, or null to clear it
     */
    setTimestamp(timestamp: number | boolean | Date | null): this {
        this.data.timestamp = timestamp;
        return this;
    }

    /**
     * Appends fields to the embed.
     * @param fields Fields to append
     */
    addFields(fields: APIEmbedField[]): this {
        this.data.fields = [...this.data.fields, ...fields];
        return this;
    }

    /**
     * Replaces all embed fields.
     * @param fields Fields to set
     */
    setFields(fields: APIEmbedField[]): this {
        this.data.fields = fields;
        return this;
    }

    /**
     * Removes and inserts fields at the given index.
     * @param index Index to start changing fields at
     * @param deleteCount Number of fields to remove
     * @param fields Fields to insert
     */
    spliceFields(index: number, deleteCount: number, ...fields: APIEmbedField[]): this {
        const updatedFields = [...this.data.fields];
        updatedFields.splice(index, deleteCount, ...fields);
        this.data.fields = updatedFields;
        return this;
    }

    /**
     * Sends this embed through dynaSend. A fresh interaction reply resolves to `null` unless `withResponse` is set.
     * @param handler Discord object to send through
     * @param options Additional dynaSend options
     * @param overrides Data to apply to a cloned embed before sending
     */
    send(
        handler: Message,
        options: DynaSendOptions & {
            /** Overrides inferred delivery with a follow-up or edit. @default inferred from target */
            method: "edit";
        },
        overrides?: Partial<BetterEmbedData>
    ): Promise<Message>;
    /** Sends through a Discord target using inferred delivery. */
    send<T extends MessageSendHandler>(
        handler: T,
        options?: DynaSendOptions,
        overrides?: Partial<BetterEmbedData>
    ): Promise<SentMessage<T>>;
    /** Sends through a Discord target using inferred delivery. */
    send<T extends SendHandler>(
        handler: T,
        options: DynaSendOptions & MessageReturningSendOptions,
        overrides?: Partial<BetterEmbedData>
    ): Promise<SentMessage<T>>;
    /** Sends through a Discord target using inferred delivery. */
    send<T extends SendHandler>(
        handler: T,
        options?: DynaSendOptions,
        overrides?: Partial<BetterEmbedData>
    ): Promise<SentMessage<T> | null>;
    /** Sends through a Discord target using inferred delivery. */
    send(
        handler: SendHandler,
        options: DynaSendOptions = {},
        overrides?: Partial<BetterEmbedData>
    ): Promise<Message | null> {
        const embeds = [overrides ? this.clone(overrides) : this, ...(options.embeds ?? [])];
        const sendOptions: RequiredDynaSendOptions = { ...options, embeds };

        return dynaSend(handler, sendOptions);
    }

    /**
     * Sends this embed as a follow-up to an interaction.
     * @param interaction Interaction to follow up on
     * @param options Additional dynaSend options
     */
    followUp(interaction: InteractionBasedSendHandler, options: DynaSendOptions = {}): Promise<TriggeredMessage> {
        return dynaSend(interaction, { ...options, embeds: [this, ...(options.embeds ?? [])], method: "followUp" });
    }

    /**
     * Edits a message, or an interaction's reply, to show this embed.
     * @param target Message or interaction to edit
     * @param options Additional dynaSend options
     */
    edit(target: InteractionBasedSendHandler | Message, options: DynaSendOptions = {}): Promise<Message> {
        return dynaSend(target, { ...options, embeds: [this, ...(options.embeds ?? [])], method: "edit" });
    }
}
