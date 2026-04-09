import type { ButtonInteraction, CommandInteraction, Message, MessageComponentInteraction } from "discord.js";
import type { BetterModalSubmitResult } from "./betterModal.js";
import type { DynaSendOptions, RequiredDynaSendOptions } from "./dynaSend.js";
import type { EmbedResolvable, SendHandler, UserResolvable } from "./dynaSend.types.js";

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder, TextInputStyle } from "discord.js";
import { BetterCollector, CollectorMode } from "./betterCollector.js";
import { BetterModal } from "./betterModal.js";
import { dynaSend } from "./dynaSend.js";
import { handleResolveAction, ResolveAction } from "./shared.js";

// TODO: Will eventually come from a global config
const DEFAULT_CONFIG = {
    timeout: 60_000,
    confirmLabel: "Confirm",
    rejectLabel: "Reject",
    promptTitle: "Confirmation Required",
    promptDescription: "Please confirm or reject this action.",
    inputLabel: "Your answer",
    inputPlaceholder: "Enter yes or no"
} as const;

interface AdditionalButton {
    builder: ButtonBuilder | ((b: ButtonBuilder) => ButtonBuilder);
    handler?: (interaction: MessageComponentInteraction) => void | Promise<void>;
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
    additionalButtons?: Record<string, AdditionalButton>;
    onResolve?: ResolveAction[];
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
    onResolve?: ResolveAction[];
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

    return option ?? new ButtonBuilder({ customId, label: defaultLabel, style: defaultStyle });
}

// Builds an ActionRow with confirm/reject buttons and custom buttons at their specified positions
// Positions: 0 = before confirm, 1 = between confirm/reject, 2+ = after reject
function buildActionRow(
    confirmBtn: ButtonBuilder,
    rejectBtn: ButtonBuilder,
    customButtons: Map<string, { button: ButtonBuilder; handler?: AdditionalButton["handler"]; index: number }>,
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
    return new EmbedBuilder().setTitle(DEFAULT_CONFIG.promptTitle).setDescription(DEFAULT_CONFIG.promptDescription);
}

// Handles post-resolution actions on the prompt message (delete, disable, or clear components)
async function handleResolve(
    message: Message,
    confirmed: boolean | null,
    onResolve: ResolveAction[],
    customButtons: Map<string, unknown>
): Promise<void> {
    if (confirmed !== null) {
        const action = confirmed ? ResolveAction.DeleteMessageOnConfirm : ResolveAction.DeleteMessageOnReject;
        if (onResolve.includes(action)) {
            await handleResolveAction(message, ResolveAction.DeleteMessage);
            return;
        }
    }

    if (onResolve.includes(ResolveAction.ClearComponents)) {
        await handleResolveAction(message, ResolveAction.ClearComponents);
    } else if (onResolve.includes(ResolveAction.DisableComponents)) {
        const disableAll: Record<string, boolean> = { confirm: true, reject: true };
        for (const id of customButtons.keys()) {
            disableAll[id] = true;
        }
        const confirmBtn = new ButtonBuilder()
            .setCustomId("btn_confirm")
            .setLabel(DEFAULT_CONFIG.confirmLabel)
            .setStyle(ButtonStyle.Success)
            .setDisabled(true);
        const rejectBtn = new ButtonBuilder()
            .setCustomId("btn_reject")
            .setLabel(DEFAULT_CONFIG.rejectLabel)
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
    const timeout = options?.timeout ?? DEFAULT_CONFIG.timeout;
    const participants = options?.participants ?? [];
    const onResolve = options?.onResolve ?? [ResolveAction.DeleteMessageOnConfirm, ResolveAction.DeleteMessageOnReject];

    // Build confirm/reject buttons with custom overrides
    const confirmBtn = buildButton(
        options?.buttons?.confirm,
        "btn_confirm",
        DEFAULT_CONFIG.confirmLabel,
        ButtonStyle.Success
    );
    const rejectBtn = buildButton(options?.buttons?.reject, "btn_reject", DEFAULT_CONFIG.rejectLabel, ButtonStyle.Danger);

    // Build custom buttons map from options
    const customButtons = new Map<string, { button: ButtonBuilder; handler?: AdditionalButton["handler"]; index: number }>();
    if (options?.additionalButtons) {
        for (const [id, { builder, handler, index = 2 }] of Object.entries(options.additionalButtons)) {
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
    const validCustomIds = ["btn_confirm", "btn_reject", ...customButtons.keys()];

    // Create result tracker
    let result: { confirmed: boolean; denied: boolean } = { confirmed: false, denied: false };
    let interactionResolved = false;

    // Set up BetterCollector with sequential mode to process one button at a time
    const collector = new BetterCollector(message, {
        type: ComponentType.Button,
        participants: participants as string[],
        timeout,
        mode: CollectorMode.Sequential,
        max: 1,
        onResolve: ResolveAction.DoNothing
    });

    // Register listener for confirm button
    collector.on("btn_confirm", async () => {
        result = { confirmed: true, denied: false };
        interactionResolved = true;
    });

    // Register listener for reject button
    collector.on("btn_reject", async () => {
        result = { confirmed: false, denied: true };
        interactionResolved = true;
    });

    // Register custom button handlers
    for (const [id, { handler }] of customButtons) {
        if (handler) {
            collector.on(id, async interaction => {
                await handler(interaction);
                interactionResolved = true;
            });
        }
    }

    // Await the collector to finish
    await new Promise<void>(resolve => {
        collector.onEnd(() => {
            resolve();
        });
    });

    // Handle post-resolution actions
    if (interactionResolved) {
        await handleResolve(message, result.confirmed, onResolve, customButtons);
    } else {
        await handleResolve(message, null, onResolve, customButtons);
    }

    return {
        message,
        replied: interactionResolved,
        confirmed: result.confirmed,
        denied: result.denied
    };
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
        timeout = DEFAULT_CONFIG.timeout,
        inputLabel = DEFAULT_CONFIG.inputLabel,
        inputPlaceholder = DEFAULT_CONFIG.inputPlaceholder
    } = options ?? {};

    // Build the modal with a text input using BetterModal
    const modal = new BetterModal({ title: question }).addTextInput({
        customId: "prompt_input",
        label: inputLabel,
        style: TextInputStyle.Short,
        placeholder: inputPlaceholder,
        required: true
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
