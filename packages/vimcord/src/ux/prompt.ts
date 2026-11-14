import type { Message, MessageEditOptions } from "discord.js";
import type { DynaSendOptions, EmbedResolvable, SendHandler, TriggeredMessage } from "./dynaSend.js";
import type {
    InferredSendOptions,
    OnResolve,
    ParticipantSendArgs,
    ParticipantsOption,
    ResolveResult,
    TimingOptions
} from "./shared.js";

import { ActionRowBuilder, BaseInteraction, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder } from "discord.js";
import { BetterCollector } from "./betterCollector.js";
import { dynaSend } from "./dynaSend.js";
import { assertTargetHasTrigger, handleResolveAction, isMessageGone, resolveTiming } from "./shared.js";
import { uxConfig } from "./uxConfig.js";

export type PromptButtonResolvable = ButtonBuilder | ((button: ButtonBuilder) => ButtonBuilder);
export type PromptTimingOptions = TimingOptions;

/** How a button prompt was answered. `"timeout"` also covers a collector stopped externally with no user decision. */
export type PromptStatus = "confirmed" | "rejected" | "custom" | "timeout";

/** User-facing confirm and reject button overrides. */
export interface PromptMessageButtonOptions {
    /** Confirm button override. @default UX config's prompt.buttons.confirm */
    confirm?: PromptButtonResolvable;
    /** Reject button override. @default UX config's prompt.buttons.reject */
    reject?: PromptButtonResolvable;
}

/** Options for sending a button-based confirmation prompt. */
export interface PromptMessageBaseOptions {
    /** Users allowed to click; required when the target has no trigger. @default inferred from target trigger */
    participants?: ParticipantsOption;
    /** Message text displayed with the decision buttons. @default send options' content */
    content?: string;
    /** Embed displayed above the decision buttons. @default UX config's prompt title and description */
    embed?: EmbedResolvable;
    /** Confirm and reject button overrides. @default UX config's prompt.buttons */
    buttons?: PromptMessageButtonOptions;
    /** Up to three buttons resolving with status "custom" and their customId. @default [] */
    extraButtons?: ButtonBuilder[];
    /** Cleanup action or awaited final payload, applied once after the decision. @default "disable" */
    onResolve?: OnResolve<PromptResolveContext>;
}

/** Prompt content, participants, decision buttons, timing, and cleanup. */
export type PromptMessageOptions = PromptMessageBaseOptions & PromptTimingOptions;

/** Result returned by a button-based confirmation prompt. */
export interface PromptMessageResult {
    /** How the prompt was answered. */
    status: PromptStatus;
    /** Custom ID of the pressed extra button. Only set when `status` is `"custom"`. */
    customId?: string;
    /** The prompt message, as Discord last returned it. */
    message: Message;
}

/** Decision passed to the prompt's resolution callback. */
export type PromptResolveContext = PromptMessageResult;

const PROMPT_CUSTOM_IDS = {
    confirm: "prompt:confirm",
    reject: "prompt:reject"
} as const;

function createPromptButton(fallback: ButtonBuilder, customId: string, override?: PromptButtonResolvable): ButtonBuilder {
    const button = typeof override === "function" ? override(new ButtonBuilder(fallback.data)) : override;

    return new ButtonBuilder({ ...fallback.data, ...button?.data }).setCustomId(customId);
}

function buildPromptRow(
    confirmButton: ButtonBuilder,
    rejectButton: ButtonBuilder,
    extraButtons: ButtonBuilder[]
): ActionRowBuilder<ButtonBuilder> {
    const buttons = [confirmButton, rejectButton, ...extraButtons];

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
    pressedCustomId: string | null
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
                const isDecision = c.custom_id === PROMPT_CUSTOM_IDS.confirm || c.custom_id === PROMPT_CUSTOM_IDS.reject;
                if (c.custom_id === pressedCustomId) return isDecision ? c : { ...c, style: ButtonStyle.Primary };
                return pressedCustomId !== null && isDecision ? { ...c, style: ButtonStyle.Secondary } : c;
            })
        };
    });
}

/**
 * Sends a confirmation prompt and waits for confirm or reject.
 * @param handler Discord target used to send the prompt
 * @param options Decision buttons, participant access, and cleanup settings. Defaults to `{}`.
 * @param sendOptions Additional options passed to dynaSend
 * @throws Before sending, when replying to a bot's message outside of a DM without `participants`
 */
export function promptMessage<T extends SendHandler>(
    handler: T,
    ...args: ParticipantSendArgs<
        T,
        [options?: PromptMessageOptions, sendOptions?: InferredSendOptions<T>],
        [
            options: PromptMessageOptions & {
                /** Users permitted to click; an empty list permits nobody. */
                participants: ParticipantsOption;
            },
            sendOptions?: DynaSendOptions
        ]
    >
): Promise<PromptMessageResult>;
/** Sends decision buttons and resolves with the user's choice or timeout. */
export async function promptMessage(
    handler: SendHandler,
    options: PromptMessageOptions = {},
    sendOptions?: DynaSendOptions
): Promise<PromptMessageResult> {
    assertTargetHasTrigger(handler, options.participants, sendOptions?.method);
    resolveTiming(options);
    const config = uxConfig.prompt;
    const extraButtons = options.extraButtons ?? [];

    // --- Buttons ---
    const confirmButton = createPromptButton(config.buttons.confirm, PROMPT_CUSTOM_IDS.confirm, options.buttons?.confirm);
    const rejectButton = createPromptButton(config.buttons.reject, PROMPT_CUSTOM_IDS.reject, options.buttons?.reject);

    const extraCustomIds = extraButtons.map(button => {
        const customId = getButtonCustomId(button);
        if (!customId) throw new Error("[Prompt] Extra buttons must have a customId");

        if (customId === PROMPT_CUSTOM_IDS.confirm || customId === PROMPT_CUSTOM_IDS.reject) {
            throw new Error(`[Prompt] Extra buttons cannot use the reserved customId "${customId}"`);
        }

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
        components: [buildPromptRow(confirmButton, rejectButton, extraButtons)],
        withResponse: true
    });

    // --- Collector ---
    // The custom ID of the button that ended the prompt, or null if nothing was pressed.
    let pressedCustomId: string | null = null;
    // The signature already required `participants` for targets with no trigger.
    const interaction = handler instanceof BaseInteraction ? handler : undefined;
    const collector = new BetterCollector(message as TriggeredMessage, { ...options, interaction, onResolve: "keep" });

    const resolveOn = (customId: string, reason: string) =>
        collector.on(customId, async i => {
            await i.deferUpdate().catch(() => {});
            if (pressedCustomId !== null) return;
            pressedCustomId = customId;
            collector.stop(reason);
        });

    resolveOn(PROMPT_CUSTOM_IDS.confirm, "confirmed");
    resolveOn(PROMPT_CUSTOM_IDS.reject, "rejected");
    for (const customId of extraCustomIds) resolveOn(customId, "custom");

    const reason = await new Promise<string>(resolve => collector.onEnd(resolve));

    // Any ending without a resolving click is reported as "timeout"; only a click is a decision.
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
        typeof options.onResolve === "function" ? await options.onResolve(context) : (options.onResolve ?? "disable");
    if (isMessageGone(reason)) return context;
    const action = typeof result === "string" ? result : result.action;
    let resolution: ResolveResult = result;
    if (action === "disable" && config.highlightSelectedButton) {
        const payload = typeof result === "string" ? { action: result } : result;
        resolution = {
            ...payload,
            components: highlightPromptComponents(payload.components ?? message.components, pressedCustomId) as never
        };
    }
    const resolvedMessage = await handleResolveAction(message, resolution, sendOptions?.allowedMentions, interaction);
    return { ...context, message: resolvedMessage ?? message };
}
