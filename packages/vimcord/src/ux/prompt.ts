import type { CommandInteraction, Message, MessageEditOptions } from "discord.js";
import type { BetterModalSubmitResult } from "./betterModal.js";
import type { DynaSendOptions, EmbedResolvable, RequiredDynaSendOptions, SendHandler } from "./dynaSend.js";
import type { OnResolve, Participant, ResolveResult, TimingOptions } from "./shared.js";

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
export type PromptStatus = "confirmed" | "rejected" | "custom" | "timeout";
/** How a modal prompt was answered. `"invalid"` means the submitted text was neither a yes nor a no. */
export type PromptModalStatus = Exclude<PromptStatus, "custom"> | "invalid";

/** User-facing confirm and reject button overrides. */
export interface PromptMessageButtonOptions {
    /** Confirm button override. */
    confirm?: PromptButtonResolvable;
    /** Reject button override. */
    reject?: PromptButtonResolvable;
}

/** Extra prompt button with an optional style to use when it is selected. */
export interface PromptAdditionalButtonOptions {
    button: ButtonBuilder;
    /** Style used when this button ends a highlighted prompt. Defaults to Primary. */
    selectedStyle?: ButtonStyle;
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
    /** Extra buttons appended after reject. Wrap a button to override its selected style. */
    additionalButtons?: (ButtonBuilder | PromptAdditionalButtonOptions)[];
    /** Whether pressing an additional button ends the prompt with `status: "custom"` and the pressed
     * custom ID. Off by default so callers already driving those buttons through `onCollector` keep
     * their current behavior.
     * @default false
     */
    resolveOnAdditionalButton?: boolean;
    /** Receives the internal collector before waiting so extra button listeners can be registered. */
    onCollector?: (collector: PromptCollector) => void | Promise<void>;
    /** Cleanup action or awaited final payload, applied once after the decision. @default ResolveAction.DeleteMessage */
    onResolve?: OnResolve<PromptResolveContext>;
    /** Whether DisableComponents should keep the selected prompt button colored. */
    highlightSelectedButton?: boolean;
}

export type PromptMessageOptions = PromptMessageBaseOptions & PromptTimingOptions;

/** Result returned by a button-based confirmation prompt. */
export interface PromptMessageResult {
    /** How the prompt was answered. */
    status: PromptStatus;
    /** Custom ID of the pressed additional button. Only set when `status` is `"custom"`. */
    customId?: string;
    /** Prompt message returned by dynaSend when Discord provides one. */
    message?: Message;
}

/** Decision passed to the prompt's resolution callback. */
export interface PromptResolveContext extends PromptMessageResult {
    message: Message;
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

function createPromptButton(fallback: ButtonBuilder, customId: string, override?: PromptButtonResolvable): ButtonBuilder {
    const button = typeof override === "function" ? override(new ButtonBuilder(fallback.data)) : override;

    return new ButtonBuilder({ ...fallback.data, ...button?.data }).setCustomId(customId);
}

function buildPromptRow(
    confirmButton: ButtonBuilder,
    rejectButton: ButtonBuilder,
    additionalButtons: PromptAdditionalButtonOptions[]
): ActionRowBuilder<ButtonBuilder> {
    const buttons = [confirmButton, rejectButton, ...additionalButtons.map(({ button }) => button)];

    if (buttons.length > 5) throw new Error("[Prompt] Prompt rows cannot contain more than 5 buttons");

    return new ActionRowBuilder<ButtonBuilder>().setComponents(buttons);
}

function getButtonCustomId(button: ButtonBuilder): string | null {
    const data = button.data as { custom_id?: unknown; customId?: unknown };
    const customId = data.custom_id ?? data.customId;

    return typeof customId === "string" ? customId : null;
}

/** Colors the chosen prompt button; shared resolution disables the resulting component tree. */
function highlightPromptComponents(
    components: NonNullable<MessageEditOptions["components"]>,
    pressedCustomId: string | null,
    selectedAdditionalStyle?: ButtonStyle
) {
    return components.map(row => {
        const data = ("toJSON" in row ? row.toJSON() : row) as {
            type: ComponentType;
            components?: { custom_id?: string; style?: ButtonStyle }[];
        };
        if (data.type !== ComponentType.ActionRow || !data.components) return data;
        return {
            ...data,
            components: data.components.map(c => {
                const unchosen =
                    pressedCustomId !== null &&
                    c.custom_id !== pressedCustomId &&
                    (c.custom_id === PROMPT_CUSTOM_IDS.confirm || c.custom_id === PROMPT_CUSTOM_IDS.reject);
                return {
                    ...c,
                    style:
                        c.custom_id === pressedCustomId && selectedAdditionalStyle !== undefined
                            ? selectedAdditionalStyle
                            : unchosen
                              ? ButtonStyle.Secondary
                              : c.style
                };
            })
        };
    });
}

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
    const additionalButtons: PromptAdditionalButtonOptions[] = (options.additionalButtons ?? []).map(item =>
        item instanceof ButtonBuilder ? { button: item } : item
    );

    // --- Buttons ---
    const confirmButton = createPromptButton(config.buttons.confirm, PROMPT_CUSTOM_IDS.confirm, options.buttons?.confirm);
    const rejectButton = createPromptButton(config.buttons.reject, PROMPT_CUSTOM_IDS.reject, options.buttons?.reject);

    const selectedAdditionalStyles = new Map<string, ButtonStyle>();
    const additionalCustomIds = additionalButtons.map(({ button, selectedStyle }) => {
        const customId = getButtonCustomId(button);
        if (!customId) throw new Error("[Prompt] Additional buttons must have a customId");

        if (customId === PROMPT_CUSTOM_IDS.confirm || customId === PROMPT_CUSTOM_IDS.reject) {
            throw new Error(`[Prompt] Additional buttons cannot use the reserved customId "${customId}"`);
        }

        selectedAdditionalStyles.set(customId, selectedStyle ?? ButtonStyle.Primary);
        return customId;
    });

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
    // The custom ID of the button that ended the prompt, or null if nothing was pressed.
    let pressedCustomId: string | null = null;
    const collector = new BetterCollector(message, {
        ...options,
        type: ComponentType.Button,
        participants: options.participants,
        onResolve: ResolveAction.DoNothing
    });

    collector.on(
        PROMPT_CUSTOM_IDS.confirm,
        async () => {
            if (pressedCustomId !== null) return;
            pressedCustomId = PROMPT_CUSTOM_IDS.confirm;
            collector.stop("confirmed");
        },
        { defer: { update: true } }
    );

    collector.on(
        PROMPT_CUSTOM_IDS.reject,
        async () => {
            if (pressedCustomId !== null) return;
            pressedCustomId = PROMPT_CUSTOM_IDS.reject;
            collector.stop("rejected");
        },
        { defer: { update: true } }
    );

    if (options.resolveOnAdditionalButton) {
        for (const customId of additionalCustomIds) {
            collector.on(
                customId,
                async () => {
                    if (pressedCustomId !== null) return;
                    pressedCustomId = customId;
                    collector.stop("custom");
                },
                { defer: { update: true } }
            );
        }
    }

    // Register completion before awaiting onCollector: if that callback stops the collector (or it
    // times out) before returning, "end" must not fire while nothing is listening yet.
    const ended = new Promise<void>(resolve => collector.onEnd(() => resolve()));
    await options.onCollector?.(collector);
    await ended;

    // Any ending without a resolving click - a real timeout or a collector stopped externally
    // (e.g. from onCollector) - is reported as "timeout"; only a click is a decision.
    const status: PromptStatus =
        pressedCustomId === PROMPT_CUSTOM_IDS.confirm
            ? "confirmed"
            : pressedCustomId === PROMPT_CUSTOM_IDS.reject
              ? "rejected"
              : pressedCustomId !== null
                ? "custom"
                : "timeout";

    // --- Resolution ---
    const context: PromptResolveContext = {
        status,
        customId: status === "custom" ? (pressedCustomId ?? undefined) : undefined,
        message
    };
    const result =
        typeof options.onResolve === "function"
            ? await options.onResolve(context)
            : (options.onResolve ?? ResolveAction.DeleteMessage);
    const action = typeof result === "string" ? result : result.action;
    let resolution: ResolveResult = result;
    if (action === ResolveAction.DisableComponents && (options.highlightSelectedButton ?? config.highlightSelectedButton)) {
        const payload = typeof result === "string" ? { action: result } : result;
        resolution = {
            ...payload,
            components: highlightPromptComponents(
                payload.components ?? message.components,
                pressedCustomId,
                pressedCustomId === null ? undefined : selectedAdditionalStyles.get(pressedCustomId)
            ) as never
        };
    }
    const resolvedMessage = await handleResolveAction(message, resolution, sendOptions?.allowedMentions);
    return { ...context, message: resolvedMessage ?? message };
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
