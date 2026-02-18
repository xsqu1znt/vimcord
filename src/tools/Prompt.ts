import {
    ActionRowBuilder,
    APIButtonComponent,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    ContainerBuilder,
    Message,
    UserResolvable,
    ButtonInteraction
} from "discord.js";
import { createToolsConfig, globalToolsConfig, ToolsConfig } from "@/configs/tools.config";
import { dynaSend, DynaSendOptions, RequiredDynaSendOptions } from "./dynaSend";
import { EmbedResolvable, SendHandler } from "./types";
import { BetterContainer } from "./BetterContainer";
import { BetterEmbed } from "./BetterEmbed";
import { PartialDeep } from "@/types/helpers";

export enum PromptResolveType {
    DisableComponents = 0,
    ClearComponents = 1,
    DeleteOnConfirm = 3,
    DeleteOnReject = 4
}

export type ButtonHandler = (interaction: ButtonInteraction) => void | Promise<void>;

export interface CustomButton {
    builder: ButtonBuilder | ((builder: ButtonBuilder) => ButtonBuilder) | Partial<APIButtonComponent>;
    handler?: ButtonHandler;
    /** Position index: 0 = before confirm, 1 = between confirm/reject, 2+ = after reject
     * @defaultValue 2 */
    index?: number;
}

export interface PromptOptions {
    participants?: UserResolvable[];
    content?: string;
    embed?: EmbedResolvable;
    container?: ContainerBuilder | BetterContainer;
    textOnly?: boolean;
    buttons?: {
        confirm?: ButtonBuilder | ((builder: ButtonBuilder) => ButtonBuilder) | Partial<APIButtonComponent>;
        reject?: ButtonBuilder | ((builder: ButtonBuilder) => ButtonBuilder) | Partial<APIButtonComponent>;
    };
    customButtons?: Record<string, CustomButton>;
    /** @defaultValue [PromptResolveType.DeleteOnConfirm, PromptResolveType.DeleteOnReject] */
    onResolve?: PromptResolveType[];
    timeout?: number;
    config?: PartialDeep<ToolsConfig>;
}

export interface PromptResult {
    message: Message | null;
    confirmed: boolean | null;
    customId: string | null;
    timedOut: boolean;
}

export class Prompt {
    readonly participants: UserResolvable[];
    readonly content?: string;
    readonly embed: EmbedResolvable;
    readonly container?: ContainerBuilder | BetterContainer;
    readonly textOnly?: boolean;
    readonly buttons: { confirm: ButtonBuilder; reject: ButtonBuilder };
    readonly customButtons: Map<string, { button: ButtonBuilder; handler?: ButtonHandler; index: number }>;
    readonly onResolve: PromptResolveType[];
    readonly timeout: number;
    readonly config: ToolsConfig;

    private message: Message | null = null;

    constructor(options: PromptOptions = {}) {
        this.config = options.config ? createToolsConfig(options.config) : globalToolsConfig;
        this.participants = options.participants ?? [];
        this.timeout = options.timeout ?? this.config.timeouts.prompt;
        this.content = options.content;
        this.embed = options.embed ?? this.createDefaultForm();
        this.container = options?.container;
        this.textOnly = options.textOnly;
        this.buttons = this.createButtons(options.buttons);
        this.customButtons = this.createCustomButtons(options.customButtons);
        this.onResolve = options.onResolve ?? [PromptResolveType.DeleteOnConfirm, PromptResolveType.DeleteOnReject];
    }

    private createDefaultForm(): BetterEmbed {
        return new BetterEmbed({
            title: this.config.prompt.defaultTitle,
            description: this.config.prompt.defaultDescription
        });
    }

    private createButtons(buttonOptions?: PromptOptions["buttons"]): {
        confirm: ButtonBuilder;
        reject: ButtonBuilder;
    } {
        const confirm = this.buildButton(
            buttonOptions?.confirm,
            "btn_confirm",
            this.config.prompt.confirmLabel,
            ButtonStyle.Success
        );

        const reject = this.buildButton(
            buttonOptions?.reject,
            "btn_reject",
            this.config.prompt.rejectLabel,
            ButtonStyle.Danger
        );

        return { confirm, reject };
    }

    private createCustomButtons(
        customOptions?: Record<string, CustomButton>
    ): Map<string, { button: ButtonBuilder; handler?: ButtonHandler; index: number }> {
        const map = new Map<string, { button: ButtonBuilder; handler?: ButtonHandler; index: number }>();

        if (!customOptions) return map;

        for (const [customId, { builder, handler, index = 2 }] of Object.entries(customOptions)) {
            const button = this.buildButton(builder, customId, customId, ButtonStyle.Primary);
            map.set(customId, { button, handler, index });
        }

        return map;
    }

    private buildButton(
        option: ButtonBuilder | ((builder: ButtonBuilder) => ButtonBuilder) | Partial<APIButtonComponent> | undefined,
        customId: string,
        defaultLabel: string,
        defaultStyle: ButtonStyle
    ): ButtonBuilder {
        if (typeof option === "function") {
            return option(new ButtonBuilder());
        }

        if (option instanceof ButtonBuilder) {
            return option;
        }

        return new ButtonBuilder({
            customId,
            label: defaultLabel,
            style: defaultStyle,
            ...option
        });
    }

    private buildActionRow(disable: Record<string, boolean> = {}): ActionRowBuilder<ButtonBuilder> {
        const confirmBtn = disable.confirm
            ? new ButtonBuilder(this.buttons.confirm.data).setDisabled(true)
            : this.buttons.confirm;

        const rejectBtn = disable.reject
            ? new ButtonBuilder(this.buttons.reject.data).setDisabled(true)
            : this.buttons.reject;

        const buttons: ButtonBuilder[] = [];

        // Collect custom buttons with their indices
        const customButtonsArray = Array.from(this.customButtons.entries()).map(([customId, data]) => ({
            customId,
            button: disable[customId] ? new ButtonBuilder(data.button.data).setDisabled(true) : data.button,
            index: data.index
        }));

        // Sort by index
        customButtonsArray.sort((a, b) => a.index - b.index);

        // Build button array in order
        for (const custom of customButtonsArray) {
            if (custom.index === 0) {
                buttons.push(custom.button);
            }
        }

        buttons.push(confirmBtn);

        for (const custom of customButtonsArray) {
            if (custom.index === 1) {
                buttons.push(custom.button);
            }
        }

        buttons.push(rejectBtn);

        for (const custom of customButtonsArray) {
            if (custom.index >= 2) {
                buttons.push(custom.button);
            }
        }

        return new ActionRowBuilder<ButtonBuilder>({ components: buttons });
    }

    private buildSendOptions(options?: DynaSendOptions): RequiredDynaSendOptions {
        const sendData: DynaSendOptions = { ...options };

        if (!this.textOnly && this.container) {
            sendData.components = Array.isArray(sendData.components)
                ? [...sendData.components, this.container]
                : [this.container];

            const existingFlags = sendData.flags ? (Array.isArray(sendData.flags) ? sendData.flags : [sendData.flags]) : [];

            if (!existingFlags.includes("IsComponentsV2")) {
                sendData.flags = [...existingFlags, "IsComponentsV2"];
            } else {
                sendData.flags = existingFlags;
            }
        } else {
            if (!this.textOnly) {
                sendData.embeds = Array.isArray(sendData.embeds) ? [this.embed, ...sendData.embeds] : [this.embed];
            }
        }

        if (this.content) {
            sendData.content = this.content;
        }

        sendData.components = Array.isArray(sendData.components)
            ? [...sendData.components, this.buildActionRow()]
            : [this.buildActionRow()];

        return sendData as RequiredDynaSendOptions;
    }

    private isParticipant(userId: string): boolean {
        if (this.participants.length === 0) return true;
        return this.participants.some(p => {
            if (typeof p === "string") return p === userId;
            if (typeof p === "object" && "id" in p) return p.id === userId;
            return false;
        });
    }

    private async handleResolve(confirmed: boolean | null): Promise<void> {
        if (!this.message) return;

        const shouldDelete =
            (confirmed === true && this.onResolve.includes(PromptResolveType.DeleteOnConfirm)) ||
            (confirmed === false && this.onResolve.includes(PromptResolveType.DeleteOnReject));

        if (shouldDelete) {
            await this.message.delete().catch(Boolean);
            return;
        }

        if (this.onResolve.includes(PromptResolveType.ClearComponents)) {
            await this.message.edit({ components: [] }).catch(Boolean);
        } else if (this.onResolve.includes(PromptResolveType.DisableComponents)) {
            const disableAll: Record<string, boolean> = { confirm: true, reject: true };
            for (const customId of this.customButtons.keys()) {
                disableAll[customId] = true;
            }
            await this.message.edit({ components: [this.buildActionRow(disableAll)] }).catch(Boolean);
        }
    }

    async send(handler: SendHandler, options?: DynaSendOptions): Promise<Message | null> {
        const sendData = this.buildSendOptions(options);
        this.message = await dynaSend(handler, sendData);
        return this.message;
    }

    async awaitResponse(): Promise<PromptResult> {
        if (!this.message) {
            throw new Error("Prompt must be sent before awaiting response");
        }

        const validCustomIds = new Set(["btn_confirm", "btn_reject", ...this.customButtons.keys()]);

        try {
            const interaction = await this.message.awaitMessageComponent({
                componentType: ComponentType.Button,
                filter: i => validCustomIds.has(i.customId) && this.isParticipant(i.user.id),
                time: this.timeout
            });

            await interaction.deferUpdate().catch(Boolean);

            let confirmed: boolean | null = null;
            if (interaction.customId === "btn_confirm") {
                confirmed = true;
            } else if (interaction.customId === "btn_reject") {
                confirmed = false;
            }

            const customButton = this.customButtons.get(interaction.customId);
            if (customButton?.handler) {
                await customButton.handler(interaction);
            }

            await this.handleResolve(confirmed);

            return {
                message: this.message,
                confirmed,
                customId: interaction.customId,
                timedOut: false
            };
        } catch (error) {
            await this.handleResolve(false);

            return {
                message: this.message,
                confirmed: null,
                customId: null,
                timedOut: true
            };
        }
    }
}

/** Create and send a prompt, awaiting its response
 * @param handler - The send handler
 * @param options - Prompt options
 * @param sendOptions - Additional send options */
export async function prompt(
    handler: SendHandler,
    options?: PromptOptions,
    sendOptions?: DynaSendOptions
): Promise<PromptResult> {
    const p = new Prompt(options);
    await p.send(handler, sendOptions);
    return await p.awaitResponse();
}
