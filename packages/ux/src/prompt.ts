import type { ButtonInteraction, CommandInteraction } from "discord.js";
import type { BetterModalSubmitResult } from "./betterModal.js";
import type { DynaSendOptions, RequiredDynaSendOptions } from "./dynaSend.js";
import type { EmbedResolvable, SendHandler, UserResolvable } from "./dynaSend.types.js";

import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    EmbedBuilder,
    Message,
    TextInputStyle
} from "discord.js";
import { BetterModal } from "./betterModal.js";
import { dynaSend } from "./dynaSend.js";

// NOTES: These will eventually come from a global config
const OPTIONS = {
    timeout: 60_000,
    confirmLabel: "Confirm",
    rejectLabel: "Reject",
    promptTitle: "Confirmation Required",
    promptDescription: "Please confirm or reject this action.",
    inputLabel: "Your answer",
    inputPlaceholder: "Enter yes or no"
} as const;

export enum PromptResolveType {
    DisableComponents = 0,
    ClearComponents = 1,
    DeleteOnConfirm = 3,
    DeleteOnReject = 4
}

export interface CustomButton {
    builder: ButtonBuilder | ((b: ButtonBuilder) => ButtonBuilder);
    handler?: (interaction: ButtonInteraction) => void | Promise<void>;
    index?: number;
}

export interface PromptMessageOptions {
    participants?: UserResolvable[];
    content?: string;
    embed?: EmbedResolvable;
    buttons?: {
        confirm?: ButtonBuilder | ((b: ButtonBuilder) => ButtonBuilder);
        reject?: ButtonBuilder | ((b: ButtonBuilder) => ButtonBuilder);
    };
    customButtons?: Record<string, CustomButton>;
    onResolve?: PromptResolveType[];
    timeout?: number;
}

export interface PromptMessageResult {
    message?: Message;
    replied: boolean;
    confirmed: boolean;
    denied: boolean;
}

export interface PromptModalOptions {
    timeout?: number;
    inputLabel?: string;
    inputPlaceholder?: string;
    onResolve?: PromptResolveType[];
}

export interface PromptModalResult {
    valid: boolean | null;
    replied: boolean;
    confirmed: boolean | null;
    denied: boolean | null;
    submitResult?: BetterModalSubmitResult<string>;
}

// Builds a button from an optional override or creates a default with the given customId, label, and style
function buildButton(
    option: ButtonBuilder | ((b: ButtonBuilder) => ButtonBuilder) | undefined,
    customId: string,
    defaultLabel: string,
    defaultStyle: ButtonStyle
): ButtonBuilder {
    if (typeof option === "function") {
        return option(new ButtonBuilder());
    }

    return (
        option ??
        new ButtonBuilder({
            customId,
            label: defaultLabel,
            style: defaultStyle
        })
    );
}

// Builds an ActionRow with confirm/reject buttons and custom buttons at their specified positions
// Positions: 0 = before confirm, 1 = between confirm/reject, 2+ = after reject
function buildActionRow(
    confirmBtn: ButtonBuilder,
    rejectBtn: ButtonBuilder,
    customButtons: Map<string, { button: ButtonBuilder; handler?: CustomButton["handler"]; index: number }>,
    disable: Record<string, boolean> = {}
): ActionRowBuilder<ButtonBuilder> {
    const confirmDisabled = disable.confirm ? new ButtonBuilder(confirmBtn.data).setDisabled(true) : confirmBtn;

    const rejectDisabled = disable.reject ? new ButtonBuilder(rejectBtn.data).setDisabled(true) : rejectBtn;

    const buttons: ButtonBuilder[] = [];
    const customArray = Array.from(customButtons.entries()).map(([id, data]) => ({
        id,
        btn: disable[id] ? new ButtonBuilder(data.button.data).setDisabled(true) : data.button,
        index: data.index
    }));

    customArray.sort((a, b) => a.index - b.index);

    for (const custom of customArray) {
        if (custom.index === 0) buttons.push(custom.btn);
    }

    buttons.push(confirmDisabled);

    for (const custom of customArray) {
        if (custom.index === 1) buttons.push(custom.btn);
    }

    buttons.push(rejectDisabled);

    for (const custom of customArray) {
        if (custom.index >= 2) buttons.push(custom.btn);
    }

    return new ActionRowBuilder<ButtonBuilder>({ components: buttons });
}

// Checks if a user ID is in the allowed participants list (empty list = everyone allowed)
function isParticipant(userId: string, participants: UserResolvable[]): boolean {
    if (participants.length === 0) return true;
    return participants.some(p => {
        if (typeof p === "string") return p === userId;
        if (typeof p === "object" && "id" in p) return p.id === userId;
        return false;
    });
}

// Creates the default embed for prompts using OPTIONS values
function createDefaultEmbed(): EmbedBuilder {
    return new EmbedBuilder().setTitle(OPTIONS.promptTitle).setDescription(OPTIONS.promptDescription);
}

// Handles post-resolution actions on the prompt message (delete, disable, or clear components)
async function handleResolve(
    message: Message,
    confirmed: boolean | null,
    onResolve: PromptResolveType[],
    customButtons: Map<string, unknown>
): Promise<void> {
    const shouldDelete =
        (confirmed === true && onResolve.includes(PromptResolveType.DeleteOnConfirm)) ||
        (confirmed === false && onResolve.includes(PromptResolveType.DeleteOnReject));

    if (shouldDelete) {
        await message.delete().catch(() => {});
        return;
    }

    if (onResolve.includes(PromptResolveType.ClearComponents)) {
        await message.edit({ components: [] }).catch(() => {});
    } else if (onResolve.includes(PromptResolveType.DisableComponents)) {
        const disableAll: Record<string, boolean> = { confirm: true, reject: true };
        for (const id of customButtons.keys()) {
            disableAll[id] = true;
        }
        const confirmBtn = new ButtonBuilder()
            .setCustomId("btn_confirm")
            .setLabel(OPTIONS.confirmLabel)
            .setStyle(ButtonStyle.Success)
            .setDisabled(true);
        const rejectBtn = new ButtonBuilder()
            .setCustomId("btn_reject")
            .setLabel(OPTIONS.rejectLabel)
            .setStyle(ButtonStyle.Danger)
            .setDisabled(true);
        await message.edit({ components: [buildActionRow(confirmBtn, rejectBtn, new Map(), disableAll)] }).catch(() => {});
    }
}

/**
 * Sends a prompt message with Confirm/Reject buttons and awaits a response.
 *
 * @param handler The send handler,
 * @param options Prompt options,
 * @param sendOptions Additional options passed to dynaSend,
 */
export async function promptMessage(
    handler: SendHandler,
    options?: PromptMessageOptions,
    sendOptions?: DynaSendOptions
): Promise<PromptMessageResult> {
    // Extract options with defaults
    const timeout = options?.timeout ?? OPTIONS.timeout;
    const participants = options?.participants ?? [];
    const onResolve = options?.onResolve ?? [PromptResolveType.DeleteOnConfirm, PromptResolveType.DeleteOnReject];

    // Build confirm/reject buttons with custom overrides
    const confirmBtn = buildButton(options?.buttons?.confirm, "btn_confirm", OPTIONS.confirmLabel, ButtonStyle.Success);
    const rejectBtn = buildButton(options?.buttons?.reject, "btn_reject", OPTIONS.rejectLabel, ButtonStyle.Danger);

    // Build custom buttons map from options
    const customButtons = new Map<string, { button: ButtonBuilder; handler?: CustomButton["handler"]; index: number }>();
    if (options?.customButtons) {
        for (const [id, { builder, handler, index = 2 }] of Object.entries(options.customButtons)) {
            const btn = typeof builder === "function" ? builder(new ButtonBuilder()) : builder;
            customButtons.set(id, { button: btn, handler, index });
        }
    }

    // Create embed (custom or default)
    const embed = options?.embed ?? createDefaultEmbed();

    // Build send data for dynaSend
    const sendData: DynaSendOptions = {
        ...sendOptions,
        embeds: [embed],
        content: options?.content,
        components: [buildActionRow(confirmBtn, rejectBtn, customButtons)]
    };

    // Send the prompt message
    const message = await dynaSend(handler, sendData as RequiredDynaSendOptions);
    if (!message) {
        return { replied: false, confirmed: false, denied: false };
    }

    // Set up valid custom IDs for the collector filter
    const validCustomIds = new Set(["btn_confirm", "btn_reject", ...customButtons.keys()]);

    try {
        // Await button interaction
        const interaction = await message.awaitMessageComponent({
            componentType: ComponentType.Button,
            filter: i => validCustomIds.has(i.customId) && isParticipant(i.user.id, participants),
            time: timeout
        });

        // Defer the button update to acknowledge receipt
        await interaction.deferUpdate().catch(() => {});

        // Determine if confirmed or rejected
        let confirmed: boolean | null = null;
        if (interaction.customId === "btn_confirm") {
            confirmed = true;
        } else if (interaction.customId === "btn_reject") {
            confirmed = false;
        }

        // Run custom button handler if one exists
        const customBtn = customButtons.get(interaction.customId);
        if (customBtn?.handler) {
            await customBtn.handler(interaction);
        }

        // Handle post-resolution actions
        await handleResolve(message, confirmed, onResolve, customButtons);

        return { message, replied: true, confirmed: confirmed === true, denied: confirmed === false };
    } catch {
        // Handle timeout
        await handleResolve(message, null, onResolve, customButtons);
        return { replied: false, confirmed: false, denied: false };
    }
}

/**
 * Prompts the user with a modal containing a text input asking a yes/no question.
 * Input is case-insensitive and accepts "yes", "y", "no", "n".
 *
 * @param interaction The interaction to show the modal on (must not have been replied to yet).
 * @param question The question to display in the modal input.
 * @param options Modal prompt options.
 */
export async function promptModal(
    interaction: CommandInteraction,
    question: string,
    options?: PromptModalOptions
): Promise<PromptModalResult> {
    const {
        timeout = OPTIONS.timeout,
        inputLabel = OPTIONS.inputLabel,
        inputPlaceholder = OPTIONS.inputPlaceholder
    } = options ?? {};

    // Build the modal with a text input using BetterModal
    const modal = new BetterModal().setTitle(question).setComponents({
        textInput: {
            customId: "prompt_input",
            label: inputLabel,
            style: TextInputStyle.Short,
            placeholder: inputPlaceholder,
            required: true
        }
    });

    // Show and await modal submission
    const submitResult = await modal.showAndAwait<string>(interaction, { timeout });
    if (!submitResult) return { valid: false, replied: false, confirmed: false, denied: false };

    // Get and normalize the input value
    const value = (submitResult.getField("prompt_input") ?? "").trim().toLowerCase();

    // Validate yes/no input
    const validYes = ["yes", "y"].includes(value);
    const validNo = ["no", "n"].includes(value);

    return { valid: validYes || validNo, replied: true, confirmed: validYes, denied: validNo, submitResult };
}
