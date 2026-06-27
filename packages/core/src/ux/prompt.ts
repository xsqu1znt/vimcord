import type { CommandInteraction, Message } from "discord.js";
import type { BetterModalSubmitResult } from "./betterModal.js";
import type { DynaSendOptions, EmbedResolvable, RequiredDynaSendOptions, SendHandler } from "./dynaSend.js";
import type { Participant } from "./shared.js";

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder, TextInputStyle } from "discord.js";
import { BetterCollector, CollectorMode } from "./betterCollector.js";
import { BetterModal } from "./betterModal.js";
import { dynaSend } from "./dynaSend.js";
import { handleResolveAction, ResolveAction } from "./shared.js";

export type PromptCollector = BetterCollector<ComponentType.Button>;
export type PromptButtonResolvable = ButtonBuilder | ((button: ButtonBuilder) => ButtonBuilder);

/** User-facing confirm and reject button overrides. */
export interface PromptMessageButtonOptions {
    /** Confirm button override. */
    confirm?: PromptButtonResolvable;
    /** Reject button override. */
    reject?: PromptButtonResolvable;
}

/** Options for sending a button-based confirmation prompt. */
export interface PromptMessageOptions {
    /** Users allowed to interact with the prompt. */
    participants?: Participant[];
    /** Message content sent with the prompt. */
    content?: string;
    /** Embed sent with the prompt. */
    embed?: EmbedResolvable;
    /** Confirm and reject button overrides. */
    buttons?: PromptMessageButtonOptions;
    /** Extra buttons appended after reject without changing their custom IDs or styling. */
    additionalButtons?: ButtonBuilder[];
    /** Receives the internal collector before waiting so extra button listeners can be registered. */
    onCollector?: (collector: PromptCollector) => void | Promise<void>;
    /** Resolve actions applied after confirm, reject, or timeout. */
    onResolve?: ResolveAction[];
    /** Whether DisableComponents should keep the selected prompt button colored. */
    highlightSelectedButton?: boolean;
    /** Time in milliseconds before the prompt stops waiting. */
    timeout: number;
}

/** Result returned by a button-based confirmation prompt. */
export interface PromptMessageResult {
    /** Prompt message returned by dynaSend when Discord provides one */
    message?: Message;
    /** Whether the prompt was answered with confirm or reject */
    replied: boolean;
    /** Whether the prompt was confirmed */
    confirmed: boolean;
    /** Whether the prompt was rejected */
    denied: boolean;
}

/** Options for prompting with a yes/no modal. */
export interface PromptModalOptions {
    /** Time in milliseconds before the modal stops waiting */
    timeout: number;
    /** Text input label */
    inputLabel?: string;
    /** Text input placeholder */
    inputPlaceholder?: string;
}

/** Result returned by a yes/no modal prompt. */
export interface PromptModalResult {
    /** Whether the submitted value was yes or no */
    valid: boolean | null;
    /** Whether the modal was submitted */
    replied: boolean;
    /** Whether the submitted value was yes */
    confirmed: boolean | null;
    /** Whether the submitted value was no */
    denied: boolean | null;
    /** BetterModal submit result for the submitted modal */
    submitResult?: BetterModalSubmitResult;
}

const PROMPT_CUSTOM_IDS = {
    confirm: "prompt:confirm",
    reject: "prompt:reject",
    input: "prompt:input"
} as const;

// TODO: Will eventually come from a global config
const DEFAULT_CONFIG = {
    promptTitle: "Confirmation Required",
    promptDescription: "Please confirm or reject this action.",
    inputLabel: "Your answer",
    inputPlaceholder: "Enter yes or no",
    buttons: {
        confirm: new ButtonBuilder({
            customId: PROMPT_CUSTOM_IDS.confirm,
            label: "Confirm",
            style: ButtonStyle.Success
        }),
        reject: new ButtonBuilder({
            customId: PROMPT_CUSTOM_IDS.reject,
            label: "Reject",
            style: ButtonStyle.Danger
        })
    }
} as const;

/**
 * Sends a confirmation prompt and waits for confirm or reject.
 * @param handler Discord target used to send the prompt
 * @param options Prompt options
 * @param sendOptions Additional options passed to dynaSend
 */
export async function promptMessage(
    handler: SendHandler,
    options: PromptMessageOptions,
    sendOptions?: DynaSendOptions
): Promise<PromptMessageResult> {
    const onResolve = options.onResolve ?? [ResolveAction.DeleteMessageOnConfirm, ResolveAction.DeleteMessageOnReject];
    const additionalButtons = options.additionalButtons ?? [];

    // --- Buttons ---
    const confirmButton = createPromptButton(
        DEFAULT_CONFIG.buttons.confirm,
        PROMPT_CUSTOM_IDS.confirm,
        options.buttons?.confirm
    );
    const rejectButton = createPromptButton(
        DEFAULT_CONFIG.buttons.reject,
        PROMPT_CUSTOM_IDS.reject,
        options.buttons?.reject
    );

    for (const button of additionalButtons) {
        if (!getButtonCustomId(button)) throw new Error("[Prompt] Additional buttons must have a customId");
    }

    // --- Message ---
    const message = await dynaSend(handler, {
        ...sendOptions,
        content: options.content ?? sendOptions?.content,
        embeds: [
            options.embed ??
                new EmbedBuilder().setTitle(DEFAULT_CONFIG.promptTitle).setDescription(DEFAULT_CONFIG.promptDescription)
        ],
        components: [buildPromptRow(confirmButton, rejectButton, additionalButtons)]
    } satisfies RequiredDynaSendOptions);

    if (!message) return { replied: false, confirmed: false, denied: false };

    // --- Collector ---
    const result = { replied: false, confirmed: false, denied: false };
    const collector = new BetterCollector(message, {
        type: ComponentType.Button,
        participants: options.participants,
        timeout: options.timeout,
        idle: options.timeout,
        mode: CollectorMode.Sequential,
        onResolve: ResolveAction.DoNothing
    });

    collector.on(
        PROMPT_CUSTOM_IDS.confirm,
        async () => {
            result.replied = true;
            result.confirmed = true;
            collector.stop("confirmed");
        },
        { defer: { update: true } }
    );

    collector.on(
        PROMPT_CUSTOM_IDS.reject,
        async () => {
            result.replied = true;
            result.denied = true;
            collector.stop("rejected");
        },
        { defer: { update: true } }
    );

    await options.onCollector?.(collector);

    const endReason = await new Promise<string>(resolve => {
        collector.onEnd((_collected, reason) => resolve(reason));
    });

    if (!result.replied && (endReason === "time" || endReason === "idle")) {
        result.denied = true;
    }

    // --- Resolution ---
    await handlePromptResolve(
        message,
        result.confirmed ? true : result.denied ? false : null,
        onResolve,
        options.highlightSelectedButton ?? false
    );

    return { message, ...result };
}

/**
 * Prompts for a yes/no answer in a modal.
 * @param interaction Interaction used to show the modal
 * @param question Question to display as the modal title
 * @param options Modal prompt options
 */
export async function promptModal(
    interaction: CommandInteraction,
    question: string,
    options: PromptModalOptions
): Promise<PromptModalResult> {
    const modal = new BetterModal({ title: question }).addTextInput({
        customId: PROMPT_CUSTOM_IDS.input,
        label: options.inputLabel ?? DEFAULT_CONFIG.inputLabel,
        style: TextInputStyle.Short,
        placeholder: options.inputPlaceholder ?? DEFAULT_CONFIG.inputPlaceholder,
        required: true
    });

    const submitResult = await modal.showAndAwait(interaction, { timeout: options.timeout });
    if (!submitResult) return { valid: null, replied: false, confirmed: null, denied: null };

    const value = (submitResult.getField<string>(PROMPT_CUSTOM_IDS.input) ?? "").trim().toLowerCase();
    const confirmed = value === "yes" || value === "y";
    const denied = value === "no" || value === "n";

    return { valid: confirmed || denied, replied: true, confirmed, denied, submitResult };
}

function createPromptButton(fallback: ButtonBuilder, customId: string, override?: PromptButtonResolvable): ButtonBuilder {
    const button = typeof override === "function" ? override(new ButtonBuilder(fallback.data)) : override;

    return new ButtonBuilder({ ...fallback.data, ...button?.data }).setCustomId(customId);
}

function buildPromptRow(
    confirmButton: ButtonBuilder,
    rejectButton: ButtonBuilder,
    additionalButtons: ButtonBuilder[]
): ActionRowBuilder<ButtonBuilder> {
    const buttons = [confirmButton, rejectButton, ...additionalButtons];

    if (buttons.length > 5) throw new Error("[Prompt] Prompt rows cannot contain more than 5 buttons");

    return new ActionRowBuilder<ButtonBuilder>().setComponents(buttons);
}

function getButtonCustomId(button: ButtonBuilder): string | null {
    const data = button.data as { custom_id?: unknown; customId?: unknown };
    const customId = data.custom_id ?? data.customId;

    return typeof customId === "string" ? customId : null;
}

async function handlePromptResolve(
    message: Message,
    confirmed: boolean | null,
    onResolve: ResolveAction[],
    highlightSelectedButton: boolean
): Promise<void> {
    for (const action of onResolve) {
        if (action === ResolveAction.DeleteMessageOnConfirm && confirmed !== true) continue;
        if (action === ResolveAction.DeleteMessageOnReject && confirmed !== false) continue;
        if (action === ResolveAction.DoNothing) continue;

        if (action === ResolveAction.DisableComponents && highlightSelectedButton) {
            await disablePromptComponents(message, confirmed);
            continue;
        }

        await handleResolveAction(
            message,
            action === ResolveAction.DeleteMessageOnConfirm || action === ResolveAction.DeleteMessageOnReject
                ? ResolveAction.DeleteMessage
                : action
        );

        if (
            action === ResolveAction.DeleteMessage ||
            action === ResolveAction.DeleteMessageOnConfirm ||
            action === ResolveAction.DeleteMessageOnReject
        ) {
            return;
        }
    }
}

async function disablePromptComponents(message: Message, confirmed: boolean | null): Promise<void> {
    if (!message.editable) return;

    try {
        const updatedRows = message.components.map(row => {
            const rowData = row.toJSON() as {
                type: ComponentType;
                components?: { custom_id?: string; disabled?: boolean; style?: ButtonStyle }[];
            };

            if (rowData.type === ComponentType.Container || !rowData.components) return rowData;

            return {
                ...rowData,
                components: rowData.components.map(component => {
                    const unchosenPromptButton =
                        confirmed !== null &&
                        ((confirmed && component.custom_id === PROMPT_CUSTOM_IDS.reject) ||
                            (!confirmed && component.custom_id === PROMPT_CUSTOM_IDS.confirm));

                    return {
                        ...component,
                        disabled: true,
                        style: unchosenPromptButton ? ButtonStyle.Secondary : component.style
                    };
                })
            };
        });

        await message.edit({ components: updatedRows as never });
    } catch (err) {
        if (err instanceof Error && !err.message.includes("Unknown Message")) {
            console.error("[Prompt] Failed to disable components:", err);
        }
    }
}
