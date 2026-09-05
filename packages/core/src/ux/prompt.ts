import type { CommandInteraction, Message } from "discord.js";
import type { BetterModalSubmitResult } from "./betterModal.js";
import type { DynaSendOptions, EmbedResolvable, RequiredDynaSendOptions, SendHandler } from "./dynaSend.js";
import type { Participant, TimingOptions } from "./shared.js";

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder, TextInputStyle } from "discord.js";
import { BetterCollector } from "./betterCollector.js";
import { BetterModal } from "./betterModal.js";
import { dynaSend } from "./dynaSend.js";
import { handleResolveAction, ResolveAction, resolveTiming } from "./shared.js";
import { getGlobalUxConfig } from "./uxConfig.js";

export type PromptCollector = BetterCollector<ComponentType.Button>;
export type PromptButtonResolvable = ButtonBuilder | ((button: ButtonBuilder) => ButtonBuilder);
export type PromptTimingOptions = TimingOptions;

/** How a button prompt was answered. `"timeout"` also covers a collector stopped externally with no user decision. */
export type PromptStatus = "confirmed" | "rejected" | "timeout";
/** How a modal prompt was answered. `"invalid"` means the submitted text was neither a yes nor a no. */
export type PromptModalStatus = PromptStatus | "invalid";

/** User-facing confirm and reject button overrides. */
export interface PromptMessageButtonOptions {
    /** Confirm button override. */
    confirm?: PromptButtonResolvable;
    /** Reject button override. */
    reject?: PromptButtonResolvable;
}

/** Options for sending a button-based confirmation prompt. */
export interface PromptMessageBaseOptions {
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
    /** Resolve action applied after confirmation.
     * @default ResolveAction.DeleteMessage
     */
    onConfirm?: ResolveAction;
    /** Resolve action applied after rejection.
     * @default ResolveAction.DeleteMessage
     */
    onReject?: ResolveAction;
    /** Resolve action applied when the prompt ends without a decision (timeout or external stop).
     * @default ResolveAction.DeleteMessage
     */
    onTimeout?: ResolveAction;
    /** Whether DisableComponents should keep the selected prompt button colored. */
    highlightSelectedButton?: boolean;
}

export type PromptMessageOptions = PromptMessageBaseOptions & PromptTimingOptions;

/** Result returned by a button-based confirmation prompt. */
export interface PromptMessageResult {
    /** How the prompt was answered. */
    status: PromptStatus;
    /** Prompt message returned by dynaSend when Discord provides one. */
    message?: Message;
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
    /** How the modal was answered. */
    status: PromptModalStatus;
    /** BetterModal submit result for the submitted modal. Absent only when `status` is `"timeout"`. */
    submitResult?: BetterModalSubmitResult;
}

const PROMPT_CUSTOM_IDS = {
    confirm: "prompt:confirm",
    reject: "prompt:reject",
    input: "prompt:input"
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
    resolveTiming(options);
    const config = getGlobalUxConfig().prompt;
    const additionalButtons = options.additionalButtons ?? [];

    // --- Buttons ---
    const confirmButton = createPromptButton(config.buttons.confirm, PROMPT_CUSTOM_IDS.confirm, options.buttons?.confirm);
    const rejectButton = createPromptButton(config.buttons.reject, PROMPT_CUSTOM_IDS.reject, options.buttons?.reject);

    for (const button of additionalButtons) {
        if (!getButtonCustomId(button)) throw new Error("[Prompt] Additional buttons must have a customId");
    }

    // --- Message ---
    // A fresh interaction reply needs `withResponse: true` or Discord never returns the message the
    // collector attaches to; force it so the caller's own send options can never silently disable this.
    const message = await dynaSend(handler, {
        ...sendOptions,
        content: options.content ?? sendOptions?.content,
        embeds: [
            options.embed ?? new EmbedBuilder().setTitle(config.defaultTitle).setDescription(config.defaultDescription)
        ],
        components: [buildPromptRow(confirmButton, rejectButton, additionalButtons)],
        withResponse: true
    } satisfies RequiredDynaSendOptions);

    if (!message) return { status: "timeout" };

    // --- Collector ---
    let replied = false;
    let confirmed = false;
    const collector = new BetterCollector(message, {
        ...options,
        type: ComponentType.Button,
        participants: options.participants,
        onResolve: ResolveAction.DoNothing
    });

    collector.on(
        PROMPT_CUSTOM_IDS.confirm,
        async () => {
            replied = true;
            confirmed = true;
            collector.stop("confirmed");
        },
        { defer: { update: true } }
    );

    collector.on(
        PROMPT_CUSTOM_IDS.reject,
        async () => {
            replied = true;
            confirmed = false;
            collector.stop("rejected");
        },
        { defer: { update: true } }
    );

    // Register completion before awaiting onCollector: if that callback stops the collector (or it
    // times out) before returning, "end" must not fire while nothing is listening yet.
    const ended = new Promise<void>(resolve => collector.onEnd(() => resolve()));
    await options.onCollector?.(collector);
    await ended;

    // Any ending without an explicit confirm/reject click - a real timeout or a collector stopped
    // externally (e.g. from onCollector) - is reported as "timeout"; only a click is a decision.
    const status: PromptStatus = !replied ? "timeout" : confirmed ? "confirmed" : "rejected";

    // --- Resolution ---
    const resolveAction =
        status === "confirmed"
            ? (options.onConfirm ?? ResolveAction.DeleteMessage)
            : status === "rejected"
              ? (options.onReject ?? ResolveAction.DeleteMessage)
              : (options.onTimeout ?? ResolveAction.DeleteMessage);

    await handlePromptResolve(
        message,
        status,
        resolveAction,
        options.highlightSelectedButton ?? config.highlightSelectedButton
    );

    return { status, message };
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
    const config = getGlobalUxConfig().prompt;
    const modal = new BetterModal({ title: question }).addTextInput({
        customId: PROMPT_CUSTOM_IDS.input,
        label: options.inputLabel ?? config.inputLabel,
        style: TextInputStyle.Short,
        placeholder: options.inputPlaceholder ?? config.inputPlaceholder,
        required: true
    });

    const submitResult = await modal.showAndAwait(interaction, { timeout: options.timeout });
    if (!submitResult) return { status: "timeout" };

    const value = submitResult.getField(PROMPT_CUSTOM_IDS.input, ComponentType.TextInput).trim().toLowerCase();
    const status: PromptModalStatus =
        value === "yes" || value === "y" ? "confirmed" : value === "no" || value === "n" ? "rejected" : "invalid";

    return { status, submitResult };
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
    status: PromptStatus,
    action: ResolveAction,
    highlightSelectedButton: boolean
): Promise<void> {
    if (action === ResolveAction.DoNothing) return;

    if (action === ResolveAction.DisableComponents && highlightSelectedButton) {
        await disablePromptComponents(message, status === "confirmed" ? true : status === "rejected" ? false : null);
        return;
    }

    await handleResolveAction(message, action);
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
