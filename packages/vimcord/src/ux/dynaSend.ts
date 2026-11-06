import type {
    ActionRowBuilder,
    BaseMessageOptions,
    CommandInteraction,
    ContainerBuilder,
    DMChannel,
    ForwardOptions,
    GuildTextBasedChannel,
    InteractionEditReplyOptions,
    InteractionReplyOptions,
    MessageActionRowComponentBuilder,
    MessageComponentInteraction,
    MessageCreateOptions,
    MessageEditOptions,
    MessageMentionOptions,
    MessageReplyOptions,
    NewsChannel,
    PollData,
    RepliableInteraction,
    ReplyOptions,
    StickerResolvable,
    TextBasedChannel,
    TextChannel,
    ThreadChannel
} from "discord.js";
import type { BetterContainer } from "./BetterContainer.js";

import {
    BaseChannel,
    BaseInteraction,
    GuildMember,
    InteractionCallbackResponse,
    Message,
    MessageFlags,
    MessageFlagsBitField,
    User
} from "discord.js";

type Mutable<T> = {
    -readonly [P in keyof T]: T[P];
};

type AtLeastOne<T, Keys extends keyof T> = {
    [K in Keys]-?: Omit<T, Keys> & Required<Pick<T, K>> & Partial<Pick<T, Exclude<Keys, K>>>;
}[Keys];

type SendableContentKeys = "content" | "embeds" | "components" | "files" | "stickers" | "poll" | "forward";

/** Sends that can't be inferred from the target. Everything else is detected. */
export type SendMethod = "followUp" | "edit";

/** How a target is actually sent through. */
type ResolvedSendMethod = "reply" | "editReply" | "followUp" | "channel" | "messageReply" | "messageEdit" | "userDM";

export type SendHandler =
    | CommandInteraction
    | RepliableInteraction
    | MessageComponentInteraction
    | TextBasedChannel
    | Message
    | GuildMember
    | User;
export type InteractionBasedSendHandler = CommandInteraction | RepliableInteraction | MessageComponentInteraction;
/** Targets that always hand back the sent message. A fresh interaction reply only does with `withResponse`. */
export type MessageSendHandler = Exclude<SendHandler, InteractionBasedSendHandler>;
/** Options that guarantee an interaction send hands back its message. */
export type MessageReturningSendOptions = { withResponse: true } | { sendMethod: SendMethod };

/** Targets whose sent message says who may click it. A guild channel's doesn't. */
export type TriggeredSendHandler = Exclude<SendHandler, GuildTextBasedChannel>;

declare const triggered: unique symbol;
/** A message known to have a trigger, so `BetterCollector` can infer `participants`. A type-only marker. */
export type TriggeredMessage = Message & { readonly [triggered]: true };

/** The message a send to `T` hands back. */
export type SentMessage<T> = [T] extends [TriggeredSendHandler] ? TriggeredMessage : Message;

export type EmbedResolvable = NonNullable<BaseMessageOptions["embeds"]>[number];
export type InteractionResolveable = CommandInteraction | RepliableInteraction | MessageComponentInteraction;
export type UserResolvable = GuildMember | User | string;

export type SendableTextChannel = DMChannel | TextChannel | NewsChannel | ThreadChannel;

export type SendableComponent = BetterContainer | ContainerBuilder | ActionRowBuilder<MessageActionRowComponentBuilder>;
export type RequiredDynaSendOptions = AtLeastOne<DynaSendOptions, SendableContentKeys>;

export interface DynaSendOptions {
    sendMethod?: SendMethod;
    content?: string;
    embeds?: EmbedResolvable[];
    components?: SendableComponent[];
    files?: Mutable<BaseMessageOptions["files"]>;
    stickers?: StickerResolvable[];
    poll?: PollData;
    flags?: InteractionReplyOptions["flags"];
    withResponse?: boolean;
    allowedMentions?: MessageMentionOptions;
    reply?: ReplyOptions;
    forward?: ForwardOptions;
    tts?: boolean;
    deleteAfter?: number;
}

const EXCLUDE_EPHEMERAL = [MessageFlags.Ephemeral] as const;
const EXCLUDE_EPHEMERAL_AND_SUPPRESS = [MessageFlags.Ephemeral, MessageFlags.SuppressNotifications] as const;

// Checks if response is a deferred channel message with source
function isInteractionCallback(obj: unknown): obj is InteractionCallbackResponse {
    return obj instanceof InteractionCallbackResponse;
}

function toFlagsBitField(flags: NonNullable<InteractionReplyOptions["flags"]>): MessageFlagsBitField {
    return new MessageFlagsBitField(flags as never);
}

/** Whether `flags` includes any of `check`, resolving each array entry as its own (possibly combined) bitfield. */
export function hasAnyMessageFlag(flags: InteractionReplyOptions["flags"], check: readonly MessageFlags[]): boolean {
    if (flags == null) return false;
    if (Array.isArray(flags)) return flags.some(f => toFlagsBitField(f).any(check));
    return toFlagsBitField(flags).any(check);
}

/** Adds a flag to a flags value, resolving through `MessageFlagsBitField`. */
export function addMessageFlag(
    flags: InteractionReplyOptions["flags"],
    flag: MessageFlags
): NonNullable<InteractionReplyOptions["flags"]> {
    if (flags == null) return flag as NonNullable<InteractionReplyOptions["flags"]>;
    return toFlagsBitField(flags).add(flag).bitfield as NonNullable<InteractionReplyOptions["flags"]>;
}

// Removes flags that are not applicable to certain send methods (e.g., Ephemeral for channels)
// Supports number flags, string flags ("Ephemeral"), and array flags; array entries may themselves be combined bitmasks
function filterFlags(
    flags: InteractionReplyOptions["flags"],
    excludeFlags: readonly MessageFlags[]
): InteractionReplyOptions["flags"] {
    if (flags == null) return undefined;

    if (Array.isArray(flags)) {
        const remaining = flags.map(f => toFlagsBitField(f).remove(...excludeFlags).bitfield).filter(f => f !== 0);
        return remaining.length ? (remaining as InteractionReplyOptions["flags"]) : undefined;
    }

    const remaining = toFlagsBitField(flags).remove(...excludeFlags).bitfield;
    return remaining || undefined;
}

// Picks the transport: an explicit method if it fits the target, otherwise whatever the target implies.
function resolveSendMethod(handler: SendHandler, method: SendMethod | undefined): ResolvedSendMethod {
    const isInteraction = handler instanceof BaseInteraction;
    if (method === "followUp") {
        if (!isInteraction) throw new TypeError("[DynaSend] sendMethod 'followUp' requires an interaction");
        return "followUp";
    }
    if (method === "edit") {
        if (isInteraction) return "editReply";
        if (handler instanceof Message) return "messageEdit";
        throw new TypeError("[DynaSend] sendMethod 'edit' requires an interaction or a message");
    }

    if (isInteraction) return handler.replied || handler.deferred ? "editReply" : "reply";
    if (handler instanceof BaseChannel) return "channel";
    if (handler instanceof Message) return "messageReply";
    if (handler instanceof GuildMember || handler instanceof User) return "userDM";

    throw new Error("[DynaSend] Unable to determine send method for handler type");
}

// Executes the actual send using the handler's appropriate method
function executeSend(
    handler: SendHandler,
    method: ResolvedSendMethod,
    data: Omit<DynaSendOptions, "sendMethod" | "deleteAfter">
): Promise<Message | null> {
    switch (method) {
        // Reply to an interaction (initial response)
        case "reply": {
            return (handler as RepliableInteraction)
                .reply(data as InteractionReplyOptions)
                .then(response => (isInteractionCallback(response) ? (response.resource?.message ?? null) : null));
        }

        // Edit an existing interaction reply
        case "editReply":
            return (handler as RepliableInteraction).editReply(data as InteractionEditReplyOptions);

        // Follow-up to an already-replied interaction
        case "followUp":
            return (handler as RepliableInteraction).followUp(data as InteractionReplyOptions);

        // Send to a text-based channel
        case "channel":
            return (handler as GuildTextBasedChannel).send(data as MessageCreateOptions);

        // Reply to an existing message
        case "messageReply":
            return (handler as Message).reply(data as MessageReplyOptions);

        // Edit an existing message
        case "messageEdit": {
            const message = handler as Message;
            if (!message.editable) {
                throw new Error("[DynaSend] Message is not editable");
            }
            return message.edit(data as MessageEditOptions);
        }

        // Send DM to a user or guild member
        case "userDM":
            return (handler as GuildMember | User).send(data as MessageCreateOptions);
    }
}

// Schedules automatic deletion of a message after a delay
// Warns if delay is less than 1 second (Discord limitation)
function scheduleDelete(message: Message, delay: number): void {
    if (delay < 1000) {
        console.warn(`[DynaSend] Delete delay is less than 1 second (${delay}ms). Is this intentional?`);
    }

    setTimeout(async () => {
        try {
            if (message.deletable) await message.delete();
        } catch (error) {
            console.error("[DynaSend] Error deleting message:", error);
        }
    }, delay);
}

/**
 * Intelligently detects and sends a message to a variety of Discord targets using a unified API.
 * A fresh interaction reply resolves to `null` unless `withResponse` is set.
 * Resolves to a `TriggeredMessage` unless the target is a guild channel or the edit of a message that may be the bot's own.
 * @param handler The Discord.js object to send the message through
 * @param options Message options (content, embeds, flags, etc.). At least one content-bearing field is required.
 */
export function dynaSend(handler: Message, options: RequiredDynaSendOptions & { sendMethod: "edit" }): Promise<Message>;
export function dynaSend<T extends MessageSendHandler>(
    handler: T,
    options: RequiredDynaSendOptions
): Promise<SentMessage<T>>;
export function dynaSend<T extends SendHandler>(
    handler: T,
    options: RequiredDynaSendOptions & MessageReturningSendOptions
): Promise<SentMessage<T>>;
export function dynaSend<T extends SendHandler>(
    handler: T,
    options: RequiredDynaSendOptions
): Promise<SentMessage<T> | null>;
export async function dynaSend(handler: SendHandler, options: RequiredDynaSendOptions): Promise<Message | null> {
    const { sendMethod: requested, deleteAfter, ...data } = options;
    const sendMethod = resolveSendMethod(handler, requested);

    if (sendMethod === "editReply" || sendMethod === "messageEdit") {
        data.flags = filterFlags(data.flags, EXCLUDE_EPHEMERAL_AND_SUPPRESS);
    } else if (sendMethod !== "reply" && sendMethod !== "followUp") {
        data.flags = filterFlags(data.flags, EXCLUDE_EPHEMERAL);
    }
    const message = await executeSend(handler, sendMethod, data);
    if (options.withResponse && !message) throw new Error("[DynaSend] Discord did not return the sent message");
    if (deleteAfter && message) scheduleDelete(message, deleteAfter);

    return message;
}
