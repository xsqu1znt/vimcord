import {
    APIEmbed,
    APIEmbedField,
    Client,
    ColorResolvable,
    EmbedBuilder,
    GuildMember,
    Message,
    TextBasedChannel,
    User
} from "discord.js";
import type { InteractionResolveable, SendHandler } from "./types";
import { createToolsConfig, globalToolsConfig, ToolsConfig } from "@/configs/tools.config";
import { dynaSend, DynaSendOptions } from "./dynaSend";
import { Vimcord } from "@/client";
import { PartialDeep } from "@/utils/types.utils";

export interface BetterEmbedContext {
    client?: Vimcord | Client | null;
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
    config?: PartialDeep<ToolsConfig>;
}

export class BetterEmbed {
    private embed = new EmbedBuilder();
    private data: Required<Omit<BetterEmbedData, "config">>;
    private config: ToolsConfig;

    /** A powerful wrapper for `EmbedBuilder` that introduces useful features
     *
     * Auto-shorthand context formatting (_ACF_) is enabled by default
     *
     * All functions utilize _ACF_ unless `BetterEmbed.acf` is set to `false`
     *
     * ___Use a blackslash___ `\` ___to escape any context___
     *
     * \- - - Author Context - - -
     * - __`$USER`__: _author's mention (@xsqu1znt)_
     * - __`$USER_NAME`__: _author's username_
     * - __`$DISPLAY_NAME`__: _author's display name (requires `GuildMember` context)_
     * - __`$USER_AVATAR`__: _author's avatar_
     *
     * \- - - Client Context - - -
     *
     * - __`$BOT_AVATAR`__: _bot's avatar_
     *
     * \- - - Shorthand Context - - -
     * - __`$YEAR`__: _YYYY_
     * - __`$MONTH`__: _MM_
     * - __`$DAY`__: _DD_
     * - __`$year`__: _YY_
     * - __`$month`__: _M or MM_
     * - __`$day`__: _D or DD_ */
    constructor(data: BetterEmbedData = {}) {
        this.config = data.config ? createToolsConfig(data.config) : globalToolsConfig;

        // Initialize with defaults
        this.data = {
            context: data.context || null,
            author: data.author || null,
            title: data.title || null,
            thumbnailUrl: data.thumbnailUrl || null,
            description: data.description || null,
            imageUrl: data.imageUrl || null,
            footer: data.footer || null,
            fields: data.fields || [],
            color: data.color ?? (this.config.devMode ? this.config.embedColorDev : this.config.embedColor),
            timestamp: data.timestamp || null,
            acf: data.acf ?? true
        };

        this.build();
    }

    private build(): void {
        this.normalizeData();
        this.applyContextFormatting();
        this.configureEmbed();
    }

    private normalizeData(): void {
        if (typeof this.data.author === "string") {
            this.data.author = { text: this.data.author };
        }

        if (typeof this.data.title === "string") {
            this.data.title = { text: this.data.title };
        }

        if (typeof this.data.footer === "string") {
            this.data.footer = { text: this.data.footer };
        }

        if (this.data.timestamp === true) {
            this.data.timestamp = Date.now();
        }
    }

    private getContextUser(): GuildMember | User | null {
        const context = this.data.context;
        if (!context) return null;

        return (
            context.user ||
            (context.interaction as any)?.member ||
            (context.interaction as any)?.user ||
            context.message?.member ||
            context.message?.author ||
            null
        );
    }

    private getContextClient(): Vimcord | Client | null {
        const context = this.data.context;
        if (!context) return null;

        return context.client || context.interaction?.client || context.message?.client || null;
    }

    private applyContextFormatting(str?: string): string | undefined {
        if (!this.data.acf) return;

        const user = this.getContextUser();
        const guildMember = user instanceof GuildMember ? user : null;
        const actualUser = guildMember?.user || (user instanceof User ? user : null);
        const client = this.getContextClient();

        const formatString = (str: string): string => {
            if (!str || !str.includes("$")) return str;

            return (
                str
                    // User context
                    .replace(/(?<!\\)\$USER\b/g, actualUser?.toString() || "$USER")
                    .replace(/(?<!\\)\$USER_NAME\b/g, actualUser?.username || "$USER_NAME")
                    .replace(/(?<!\\)\$USER_AVATAR\b/g, actualUser?.avatarURL() || "$USER_AVATAR")
                    .replace(/(?<!\\)\$DISPLAY_NAME\b/g, guildMember?.displayName || "$DISPLAY_NAME")

                    // Bot context
                    .replace(/(?<!\\)\$BOT_AVATAR\b/g, client?.user?.avatarURL() || "$BOT_AVATAR")

                    // Utility
                    .replace(/(?<!\\)\$INVIS\b/g, "\u200B")

                    // Date context
                    .replace(/(?<!\\)\$YEAR/g, new Date().getFullYear().toString())
                    .replace(/(?<!\\)\$MONTH/g, String(new Date().getMonth() + 1).padStart(2, "0"))
                    .replace(/(?<!\\)\$DAY/g, String(new Date().getDate()).padStart(2, "0"))
                    .replace(/(?<!\\)\$year/g, String(new Date().getFullYear()).slice(-2))
                    .replace(/(?<!\\)\$month/g, String(new Date().getMonth() + 1).padStart(2, "0"))
                    .replace(/(?<!\\)\$day/g, String(new Date().getDate()).padStart(2, "0"))

                    // Mentions
                    .replace(/(?<!\\|<)@([0-9]+)(?!>)/g, "<@$1>")
                    .replace(/(?<!\\|<)@&([0-9]+)(?!>)/g, "<@&$1>")
                    .replace(/(?<!\\|<)#([0-9]+)(?!>)/g, "<#$1>")
            );
        };

        if (str) {
            // Apply context to the given string and return early
            return formatString(str);
        }

        // Apply formatting to text fields
        if (this.data.author && typeof this.data.author === "object") {
            this.data.author.text = formatString(this.data.author.text);

            // Handle author icon
            if (this.data.author.icon === true && actualUser) {
                this.data.author.icon = actualUser.avatarURL();
            } else if (typeof this.data.author.icon === "string") {
                this.data.author.icon = formatString(this.data.author.icon);
            }
        }

        if (this.data.title && typeof this.data.title === "object") {
            this.data.title.text = formatString(this.data.title.text);
        }

        if (this.data.description) {
            this.data.description = formatString(
                Array.isArray(this.data.description)
                    ? this.data.description.filter(s => s !== null && s !== undefined).join("\n")
                    : this.data.description
            );
        }

        if (this.data.footer && typeof this.data.footer === "object") {
            this.data.footer.text = formatString(this.data.footer.text);
        }

        if (this.data.thumbnailUrl) {
            this.data.thumbnailUrl = formatString(this.data.thumbnailUrl);
        }

        if (this.data.imageUrl) {
            this.data.imageUrl = formatString(this.data.imageUrl);
        }

        // Apply formatting to fields
        this.data.fields = this.data.fields.filter(Boolean).map(field => ({
            ...field,
            name: formatString(field!.name),
            value: formatString(field!.value)
        }));
    }

    private configureEmbed(): void {
        // Set author
        if (this.data.author && typeof this.data.author === "object" && this.data.author.text) {
            try {
                this.embed.setAuthor({
                    name: this.data.author.text,
                    iconURL: typeof this.data.author.icon === "string" ? this.data.author.icon : undefined,
                    url: this.data.author.hyperlink || undefined
                });
            } catch (error) {
                console.error("[BetterEmbed] Invalid author configuration:", error);
            }
        }

        // Set title
        if (this.data.title && typeof this.data.title === "object" && this.data.title.text) {
            try {
                this.embed.setTitle(this.data.title.text);
                if (this.data.title.hyperlink) {
                    this.embed.setURL(this.data.title.hyperlink);
                }
            } catch (error) {
                console.error("[BetterEmbed] Invalid title configuration:", error);
            }
        }

        // Set description
        if (this.data.description) {
            this.embed.setDescription(
                Array.isArray(this.data.description) ? this.data.description.join("\n") : this.data.description
            );
        }

        // Set thumbnail
        if (this.data.thumbnailUrl) {
            try {
                this.embed.setThumbnail(this.data.thumbnailUrl);
            } catch (error) {
                console.error("[BetterEmbed] Invalid thumbnail URL:", error);
            }
        }

        // Set image
        if (this.data.imageUrl) {
            try {
                this.embed.setImage(this.data.imageUrl);
            } catch (error) {
                console.error("[BetterEmbed] Invalid image URL:", error);
            }
        }

        // Set footer
        if (this.data.footer && typeof this.data.footer === "object" && this.data.footer.text) {
            try {
                this.embed.setFooter({
                    text: this.data.footer.text,
                    iconURL: typeof this.data.footer.icon === "string" ? this.data.footer.icon : undefined
                });
            } catch (error) {
                console.error("[BetterEmbed] Invalid footer configuration:", error);
            }
        }

        // Set color
        if (this.data.color) {
            try {
                const color = Array.isArray(this.data.color)
                    ? (this.data.color[Math.floor(Math.random() * this.data.color.length)] ?? null)
                    : this.data.color;
                this.embed.setColor(color);
            } catch (error) {
                console.error("[BetterEmbed] Invalid color:", error);
            }
        }

        // Set timestamp
        if (this.data.timestamp && this.data.timestamp !== true) {
            try {
                this.embed.setTimestamp(this.data.timestamp as Date | number);
            } catch (error) {
                console.error("[BetterEmbed] Invalid timestamp:", error);
            }
        }

        // Set fields
        if (this.data.fields.length > 0) {
            const validFields = this.data.fields.slice(0, 25); // Discord limit
            if (this.data.fields.length > 25) {
                console.warn("[BetterEmbed] Only first 25 fields will be used (Discord limit)");
            }
            this.embed.setFields(validFields as APIEmbedField[]);
        }
    }

    setAuthor(author: string | BetterEmbedAuthor | null): this {
        this.data.author = author;
        this.build();
        return this;
    }

    setTitle(title: string | BetterEmbedTitle | null): this {
        this.data.title = title;
        this.build();
        return this;
    }

    setDescription(description: string | null): this {
        this.data.description = description;
        this.build();
        return this;
    }

    setThumbnail(url: string | null): this {
        this.data.thumbnailUrl = url;
        this.build();
        return this;
    }

    setImage(url: string | null): this {
        this.data.imageUrl = url;
        this.build();
        return this;
    }

    setFooter(footer: string | BetterEmbedFooter | null): this {
        this.data.footer = footer;
        this.build();
        return this;
    }

    setColor(color: ColorResolvable | ColorResolvable[] | null): this {
        this.data.color = color;
        this.build();
        return this;
    }

    setTimestamp(timestamp: number | boolean | Date | null): this {
        this.data.timestamp = timestamp;
        this.build();
        return this;
    }

    addFields(fields: APIEmbedField[]): this {
        this.data.fields = [...this.data.fields, ...fields];
        this.build();
        return this;
    }

    setFields(fields: APIEmbedField[]): this {
        this.data.fields = fields;
        this.build();
        return this;
    }

    spliceFields(index: number, deleteCount: number, ...fields: APIEmbedField[]): this {
        this.data.fields.splice(index, deleteCount, ...fields);
        this.build();
        return this;
    }

    clone(overrides: Partial<BetterEmbedData> = {}): BetterEmbed {
        return new BetterEmbed({ ...this.data, ...overrides });
    }

    toJSON(): APIEmbed {
        return this.embed.toJSON();
    }

    async send(
        handler: SendHandler,
        options: DynaSendOptions = {},
        overrides?: Partial<BetterEmbedData>
    ): Promise<Message | null> {
        this.build();

        // Apply ACF to message content
        if (options.content && this.data.acf) {
            options.content = this.applyContextFormatting(options.content) as string;
        }

        return await dynaSend(handler, {
            ...options,
            embeds: [
                overrides ? this.clone(overrides) : this,
                ...(Array.isArray(options?.embeds) ? options?.embeds : options?.embeds ? [options?.embeds] : [])
            ]
        });
    }
}
