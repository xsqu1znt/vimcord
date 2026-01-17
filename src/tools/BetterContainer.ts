import {
    ActionRowBuilder,
    APIThumbnailComponent,
    ButtonBuilder,
    ButtonComponentData,
    ContainerBuilder,
    Message,
    MessageActionRowComponentBuilder,
    ThumbnailBuilder
} from "discord.js";
import { globalVimcordToolsConfig, VimcordToolsConfig } from "@/configs/tools.config";
import { DynaSendOptions, dynaSend } from "./dynaSend";
import { SendHandler } from "./types";

export interface BetterContainerData {
    color?: string | string[] | null;
    config?: VimcordToolsConfig;
}

export class BetterContainer {
    private container = new ContainerBuilder();
    private data: Required<Omit<BetterContainerData, "config">>;
    private config: VimcordToolsConfig;

    constructor(data: BetterContainerData = {}) {
        this.config = data.config || globalVimcordToolsConfig;

        this.data = {
            color:
                data.color ??
                (this.config.devMode ? (this.config.embedColorDev as string[]) : (this.config.embedColor as string[])),
            ...data
        };

        this.build();
    }

    private configure() {
        // Color
        if (this.data.color) {
            try {
                const color = Array.isArray(this.data.color)
                    ? (this.data.color[Math.floor(Math.random() * this.data.color.length)] ?? null)
                    : this.data.color;

                if (color) {
                    this.container.setAccentColor(parseInt(color.replace("#", ""), 16));
                } else {
                    this.container.clearAccentColor();
                }
            } catch (error) {
                console.error("[BetterContainer] Invalid color:", error);
            }
        }
    }

    build() {
        this.configure();
    }

    addSeparator(options?: { divider?: boolean; spacing?: number }): this {
        this.container.addSeparatorComponents(sb => {
            if (options?.divider !== undefined) sb.setDivider(options.divider);
            if (options?.spacing !== undefined) sb.setSpacing(options.spacing);
            return sb;
        });
        return this;
    }

    addText(text: string | (string | null | undefined)[]): this {
        this.container.addTextDisplayComponents(tdb =>
            tdb.setContent(Array.isArray(text) ? text.filter(t => t !== null && t !== undefined).join("\n") : text)
        );
        return this;
    }

    addMedia(...media: { url: string | string[]; spoiler?: boolean; description?: string }[]): this {
        this.container.addMediaGalleryComponents(mb => {
            for (const m of media) {
                const urls = Array.isArray(m.url) ? m.url : [m.url];
                for (const u of urls) {
                    mb.addItems(mgb => {
                        mgb.setURL(u);
                        if (m.spoiler) mgb.setSpoiler(true);
                        if (m.description) mgb.setDescription(m.description);
                        return mgb;
                    });
                }
            }

            return mb;
        });
        return this;
    }

    addSection(data: {
        text?: string | (string | null | undefined)[];
        button?: Partial<ButtonComponentData>;
        thumbnail?: Partial<APIThumbnailComponent>;
    }): this {
        this.container.addSectionComponents(sb => {
            // Text
            if (data.text) {
                sb.addTextDisplayComponents(tdb =>
                    tdb.setContent(
                        Array.isArray(data.text)
                            ? data.text.filter(t => t !== null && t !== undefined).join("\n")
                            : data.text!
                    )
                );
            }

            // Thumbnail
            if (data.thumbnail) sb.setThumbnailAccessory(new ThumbnailBuilder(data.thumbnail));

            // Button
            if (data.button) sb.setButtonAccessory(new ButtonBuilder(data.button));

            return sb;
        });

        return this;
    }

    addActionRow(...components: ActionRowBuilder<MessageActionRowComponentBuilder>[]): this {
        this.container.addActionRowComponents(...components);
        return this;
    }

    toJSON() {
        return this.container.toJSON();
    }

    async send(handler: SendHandler, options: DynaSendOptions = {}): Promise<Message | null> {
        this.build();

        return await dynaSend(handler, {
            ...options,
            withResponse: true,
            components: [this.container],
            flags: Array.isArray(options.flags)
                ? [...options.flags, "IsComponentsV2"]
                : options.flags
                  ? [options.flags, "IsComponentsV2"]
                  : "IsComponentsV2"
        });
    }
}
