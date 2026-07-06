import type { APIEmbed, APIEmbedField, Client, ColorResolvable, Message, TextBasedChannel } from "discord.js";
import type { DynaSendOptions, InteractionResolveable, RequiredDynaSendOptions, SendHandler } from "./dynaSend.js";

import { EmbedBuilder, GuildMember, User } from "discord.js";
import { dynaSend } from "./dynaSend.js";
import { resolveGlobalEmbedColor } from "./toolConfig.js";

export interface BetterEmbedContext {
    client?: Client | null;
    interaction?: InteractionResolveable | null;
    channel?: TextBasedChannel | null;
    message?: Message | null;
    user?: GuildMember | User | null;
}

export interface BetterEmbedAuthor {
    text: string;
    icon?: string | boolean | null;
    hyperlink?: string | null;
}

export interface BetterEmbedTitle {
    text: string;
    hyperlink?: string | null;
}

export interface BetterEmbedFooter {
    text: string;
    icon?: string | boolean | null;
}

export interface BetterEmbedData {
    context?: BetterEmbedContext | null;
    author?: string | BetterEmbedAuthor | null;
    title?: string | BetterEmbedTitle | null;
    thumbnailUrl?: string | null;
    description?: string | (string | null | undefined)[] | null;
    imageUrl?: string | null;
    footer?: string | BetterEmbedFooter | null;
    fields?: (APIEmbedField | null | undefined)[];
    color?: ColorResolvable | ColorResolvable[] | null;
    timestamp?: number | boolean | Date | null;
    acf?: boolean;
}

interface BetterEmbedState {
    context: BetterEmbedContext | null;
    author: string | BetterEmbedAuthor | null;
    title: string | BetterEmbedTitle | null;
    thumbnailUrl: string | null;
    description: string | (string | null | undefined)[] | null;
    imageUrl: string | null;
    footer: string | BetterEmbedFooter | null;
    fields: (APIEmbedField | null | undefined)[];
    color: ColorResolvable | ColorResolvable[] | null;
    timestamp: number | boolean | Date | null;
    acf: boolean;
}

interface FormattingContext {
    user: User | null;
    member: GuildMember | null;
    client: Client | null;
    now: Date;
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
    if (Array.isArray(description)) return description.filter(Boolean).join("\n") || null;
    return description;
}

export class BetterEmbed {
    private embed = new EmbedBuilder();
    private data: BetterEmbedState;

    constructor(data: BetterEmbedData = {}) {
        this.data = {
            context: data.context ?? null,
            author: data.author ?? null,
            title: data.title ?? null,
            thumbnailUrl: data.thumbnailUrl ?? null,
            description: data.description ?? null,
            imageUrl: data.imageUrl ?? null,
            footer: data.footer ?? null,
            fields: data.fields ?? [],
            color: data.color === undefined ? resolveGlobalEmbedColor() : data.color,
            timestamp: data.timestamp ?? null,
            acf: data.acf ?? true
        };

        this.build();
    }

    private build(): void {
        const formatting = this.createFormattingContext();
        const author = normalizeAuthor(this.data.author);
        const title = normalizeTitle(this.data.title);
        const footer = normalizeFooter(this.data.footer);
        const description = normalizeDescription(this.data.description);
        const embed = new EmbedBuilder();

        // --- Text Blocks ---
        if (author?.text) {
            embed.setAuthor({
                name: this.formatText(author.text, formatting),
                iconURL: this.resolveIcon(author.icon, formatting),
                url: author.hyperlink ? this.formatText(author.hyperlink, formatting) : undefined
            });
        }

        if (title?.text) {
            embed.setTitle(this.formatText(title.text, formatting));
            if (title.hyperlink) embed.setURL(this.formatText(title.hyperlink, formatting));
        }

        if (description) embed.setDescription(this.formatText(description, formatting));

        if (footer?.text) {
            embed.setFooter({
                text: this.formatText(footer.text, formatting),
                iconURL: this.resolveIcon(footer.icon, formatting)
            });
        }

        // --- Media ---
        if (this.data.thumbnailUrl) embed.setThumbnail(this.formatText(this.data.thumbnailUrl, formatting));
        if (this.data.imageUrl) embed.setImage(this.formatText(this.data.imageUrl, formatting));

        // --- Metadata ---
        const color = this.resolveColor();
        if (color) embed.setColor(color);
        if (this.data.timestamp) embed.setTimestamp(this.data.timestamp === true ? Date.now() : this.data.timestamp);

        const fields = this.data.fields
            .filter(isEmbedField)
            .slice(0, 25)
            .map(field => ({
                ...field,
                name: this.formatText(field.name, formatting),
                value: this.formatText(field.value, formatting)
            }));

        if (fields.length) embed.setFields(fields);

        this.embed = embed;
    }

    private createFormattingContext(): FormattingContext {
        const contextUser = this.getContextUser();
        const member = contextUser instanceof GuildMember ? contextUser : this.getContextMember();
        const user =
            member?.user ?? (contextUser instanceof User ? contextUser : (this.data.context?.interaction?.user ?? null));

        return {
            user,
            member,
            client: this.getContextClient(),
            now: new Date()
        };
    }

    private getContextUser(): GuildMember | User | null {
        const context = this.data.context;
        if (!context) return null;

        return (
            context.user ??
            this.getContextMember() ??
            context.interaction?.user ??
            context.message?.member ??
            context.message?.author ??
            null
        );
    }

    private getContextMember(): GuildMember | null {
        const member = this.data.context?.interaction?.member;
        if (member instanceof GuildMember) return member;
        return this.data.context?.message?.member ?? null;
    }

    private getContextClient(): Client | null {
        const context = this.data.context;
        if (!context) return null;

        return context.client ?? context.interaction?.client ?? context.message?.client ?? context.channel?.client ?? null;
    }

    private formatText(text: string, context: FormattingContext): string {
        if (!this.data.acf) return text;
        if (!text.includes("$") && !/[#@]/.test(text)) return text;

        const fullYear = context.now.getFullYear().toString();
        const month = String(context.now.getMonth() + 1).padStart(2, "0");
        const day = String(context.now.getDate()).padStart(2, "0");

        return text
            .replace(/(?<!\\)\$USER\b/g, context.user?.toString() ?? "$USER")
            .replace(/(?<!\\)\$USER_NAME\b/g, context.user?.username ?? "$USER_NAME")
            .replace(/(?<!\\)\$USER_AVATAR\b/g, context.user?.displayAvatarURL() ?? "$USER_AVATAR")
            .replace(/(?<!\\)\$DISPLAY_NAME\b/g, context.member?.displayName ?? "$DISPLAY_NAME")
            .replace(/(?<!\\)\$BOT_AVATAR\b/g, context.client?.user?.displayAvatarURL() ?? "$BOT_AVATAR")
            .replace(/(?<!\\)\$INVIS\b/g, "\u200B")
            .replace(/(?<!\\)\$YEAR\b/g, fullYear)
            .replace(/(?<!\\)\$MONTH\b/g, month)
            .replace(/(?<!\\)\$DAY\b/g, day)
            .replace(/(?<!\\)\$year\b/g, fullYear.slice(-2))
            .replace(/(?<!\\)\$month\b/g, month)
            .replace(/(?<!\\)\$day\b/g, day);
    }

    private resolveIcon(icon: string | boolean | null | undefined, context: FormattingContext): string | undefined {
        if (icon === true) return context.user?.displayAvatarURL();
        if (typeof icon === "string") return this.formatText(icon, context);
        return undefined;
    }

    private resolveColor(): ColorResolvable | null {
        if (!this.data.color) return null;
        if (!Array.isArray(this.data.color)) return this.data.color;
        if (!this.data.color.length) return null;
        return this.data.color[Math.floor(Math.random() * this.data.color.length)] ?? null;
    }

    /**
     * Creates a new BetterEmbed using this embed's data with optional overrides.
     * @param overrides Data to override on the cloned embed
     */
    clone(overrides: Partial<BetterEmbedData> = {}): BetterEmbed {
        return new BetterEmbed({ ...this.data, ...overrides });
    }

    /**
     * Converts the embed into Discord API embed JSON.
     */
    toJSON(): APIEmbed {
        this.build();
        return this.embed.toJSON();
    }

    /**
     * Sets the embed author.
     * @param author Author text, author options, or null to clear it
     */
    setAuthor(author: string | BetterEmbedAuthor | null): this {
        this.data.author = author;
        this.build();
        return this;
    }

    /**
     * Sets the embed title.
     * @param title Title text, title options, or null to clear it
     */
    setTitle(title: string | BetterEmbedTitle | null): this {
        this.data.title = title;
        this.build();
        return this;
    }

    /**
     * Sets the embed description.
     * @param description Description text, description lines, or null to clear it
     */
    setDescription(description: BetterEmbedData["description"]): this {
        this.data.description = description ?? null;
        this.build();
        return this;
    }

    /**
     * Sets the embed thumbnail URL.
     * @param url Thumbnail URL or null to clear it
     */
    setThumbnail(url: string | null): this {
        this.data.thumbnailUrl = url;
        this.build();
        return this;
    }

    /**
     * Sets the embed image URL.
     * @param url Image URL or null to clear it
     */
    setImage(url: string | null): this {
        this.data.imageUrl = url;
        this.build();
        return this;
    }

    /**
     * Sets the embed footer.
     * @param footer Footer text, footer options, or null to clear it
     */
    setFooter(footer: string | BetterEmbedFooter | null): this {
        this.data.footer = footer;
        this.build();
        return this;
    }

    /**
     * Sets the embed color.
     * @param color Color, random color choices, or null to clear it
     */
    setColor(color: ColorResolvable | ColorResolvable[] | null): this {
        this.data.color = color;
        this.build();
        return this;
    }

    /**
     * Sets the embed timestamp.
     * @param timestamp Timestamp value, true for the current time, or null to clear it
     */
    setTimestamp(timestamp: number | boolean | Date | null): this {
        this.data.timestamp = timestamp;
        this.build();
        return this;
    }

    /**
     * Appends fields to the embed.
     * @param fields Fields to append
     */
    addFields(fields: APIEmbedField[]): this {
        this.data.fields = [...this.data.fields, ...fields];
        this.build();
        return this;
    }

    /**
     * Replaces all embed fields.
     * @param fields Fields to set
     */
    setFields(fields: APIEmbedField[]): this {
        this.data.fields = fields;
        this.build();
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
        this.build();
        return this;
    }

    /**
     * Sends this embed through dynaSend.
     * @param handler Discord object to send through
     * @param options Additional dynaSend options
     * @param overrides Data to apply to a cloned embed before sending
     */
    async send(
        handler: SendHandler,
        options: DynaSendOptions = {},
        overrides?: Partial<BetterEmbedData>
    ): Promise<Message | null> {
        const content =
            options.content && this.data.acf
                ? this.formatText(options.content, this.createFormattingContext())
                : options.content;
        const embeds = [overrides ? this.clone(overrides) : this, ...(options.embeds ?? [])];
        const sendOptions: RequiredDynaSendOptions = { ...options, content, embeds };

        return dynaSend(handler, sendOptions);
    }
}
