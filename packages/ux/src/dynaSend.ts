import type {
    ActionRowBuilder,
    BaseMessageOptions,
    CommandInteraction,
    ContainerBuilder,
    DMChannel,
    EmbedBuilder,
    ForwardOptions,
    GuildTextBasedChannel,
    InteractionEditReplyOptions,
    InteractionReplyOptions,
    MessageActionRowComponentBuilder,
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

import {
    BaseChannel,
    BaseInteraction,
    GuildMember,
    InteractionCallbackResponse,
    Message,
    MessageFlags,
    User
} from "discord.js";

type Mutable<T> = {
    -readonly [P in keyof T]: T[P];
};

type AtLeastOne<T, Keys extends keyof T> = {
    [K in Keys]-?: Omit<T, Keys> & Required<Pick<T, K>> & Partial<Pick<T, Exclude<Keys, K>>>;
}[Keys];

type SendableContentKeys = "content" | "embeds" | "components" | "files" | "stickers" | "poll" | "forward";

export enum SendMethod {
    Reply = "Reply",
    EditReply = "EditReply",
    FollowUp = "FollowUp",
    Channel = "Channel",
    MessageReply = "MessageReply",
    MessageEdit = "MessageEdit",
    UserDM = "UserDM"
}

export type SendHandler = CommandInteraction | RepliableInteraction | TextBasedChannel | Message | GuildMember | User;
export type InteractionBasedSendHandler = CommandInteraction | RepliableInteraction;

// TODO: Reimplement BetterEmbed when added to @vimcord/ux
export type EmbedResolvable = EmbedBuilder;
export type InteractionResolveable = CommandInteraction | RepliableInteraction;
export type UserResolvable = GuildMember | User | string;

export type SendableTextChannel = DMChannel | TextChannel | NewsChannel | ThreadChannel;

export type SendableComponent = ContainerBuilder | ActionRowBuilder<MessageActionRowComponentBuilder>;
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

// Removes flags that are not applicable to certain send methods (e.g., Ephemeral for channels)
// Supports number flags, string flags ("Ephemeral"), and array flags
function filterFlags(
    flags: InteractionReplyOptions["flags"],
    excludeFlags: readonly MessageFlags[]
): InteractionReplyOptions["flags"] {
    if (flags == null) return undefined;

    // Build sets of flags to exclude for O(1) lookup
    const flagToExclude = new Set<number>();
    const stringFlags = new Set<string>();

    for (const f of excludeFlags) {
        flagToExclude.add(f);
        stringFlags.add(MessageFlags[f]);
    }

    // Handle array flags: filter out excluded flags
    if (Array.isArray(flags)) {
        const filtered = flags.filter(f => {
            const num = typeof f === "number" ? f : MessageFlags[f as keyof typeof MessageFlags];
            return !flagToExclude.has(num);
        });
        return filtered.length ? (filtered as InteractionReplyOptions["flags"]) : undefined;
    }

    // Handle number flags: bitwise AND to remove excluded flags
    if (typeof flags === "number") {
        let result = flags;
        for (const flag of excludeFlags) result &= ~flag;
        return result || undefined;
    }

    // Handle single string flag: check if it should be excluded
    return stringFlags.has(String(flags)) ? undefined : flags;
}

// Determines the appropriate send method based on the handler type and state
function detectSendMethod(handler: SendHandler): SendMethod {
    if (handler instanceof BaseInteraction) {
        return handler.replied || handler.deferred ? SendMethod.EditReply : SendMethod.Reply;
    }
    if (handler instanceof BaseChannel) return SendMethod.Channel;
    if (handler instanceof Message) return SendMethod.MessageReply;
    if (handler instanceof GuildMember || handler instanceof User) return SendMethod.UserDM;

    throw new Error("[DynaSend] Unable to determine send method for handler type");
}

// Validates that the handler is compatible with the requested send method
function validateSendMethod(handler: SendHandler, method: SendMethod): void {
    const interactionMethods = [SendMethod.Reply, SendMethod.EditReply, SendMethod.FollowUp];

    if (interactionMethods.includes(method) && !(handler instanceof BaseInteraction)) {
        throw new TypeError(`[DynaSend] SendMethod '${SendMethod[method]}' requires BaseInteraction handler`);
    }

    if (method === SendMethod.Channel && !(handler instanceof BaseChannel)) {
        throw new TypeError(`[DynaSend] SendMethod '${SendMethod[method]}' requires BaseChannel handler`);
    }

    if ([SendMethod.MessageReply, SendMethod.MessageEdit].includes(method) && !(handler instanceof Message)) {
        throw new TypeError(`[DynaSend] SendMethod '${SendMethod[method]}' requires Message handler`);
    }

    if (method === SendMethod.UserDM && !(handler instanceof GuildMember || handler instanceof User)) {
        throw new TypeError(`[DynaSend] SendMethod '${SendMethod[method]}' requires User or GuildMember handler`);
    }
}

// Constructs the message options object for a given send method
type MessageDataMap = {
    [SendMethod.Reply]: InteractionReplyOptions;
    [SendMethod.EditReply]: InteractionEditReplyOptions;
    [SendMethod.FollowUp]: InteractionReplyOptions;
    [SendMethod.Channel]: MessageCreateOptions;
    [SendMethod.MessageReply]: MessageReplyOptions;
    [SendMethod.MessageEdit]: MessageEditOptions;
    [SendMethod.UserDM]: MessageCreateOptions;
};

// Constructs the message options object for a given send method
// Applies method-specific filtering (e.g., removing Ephemeral flag for Channel sends)
function createMessageData<M extends SendMethod>(options: DynaSendOptions, method: M): MessageDataMap[M] {
    const sharedBase = {
        content: options.content,
        embeds: options.embeds,
        components: options.components,
        files: options.files,
        allowedMentions: options.allowedMentions
    };

    switch (method) {
        // Interaction reply - flags allowed, supports withResponse
        case SendMethod.Reply:
            return {
                ...sharedBase,
                tts: options.tts,
                flags: options.flags,
                withResponse: options.withResponse,
                poll: options.poll
            } as MessageDataMap[M];

        // Edit existing reply - filter out Ephemeral and SuppressNotifications
        case SendMethod.EditReply:
            return {
                ...sharedBase,
                flags: filterFlags(options.flags, EXCLUDE_EPHEMERAL_AND_SUPPRESS),
                withResponse: options.withResponse,
                poll: options.poll
            } as MessageDataMap[M];

        // Follow-up to interaction - flags allowed
        case SendMethod.FollowUp:
            return {
                ...sharedBase,
                tts: options.tts,
                flags: options.flags,
                poll: options.poll
            } as MessageDataMap[M];

        // Channel send - filter out Ephemeral (not applicable to channels)
        case SendMethod.Channel:
            return {
                ...sharedBase,
                tts: options.tts,
                flags: filterFlags(options.flags, EXCLUDE_EPHEMERAL),
                poll: options.poll,
                stickers: options.stickers,
                reply: options.reply,
                forward: options.forward
            } as MessageDataMap[M];

        // Message reply - filter out Ephemeral
        case SendMethod.MessageReply:
            return {
                ...sharedBase,
                tts: options.tts,
                flags: filterFlags(options.flags, EXCLUDE_EPHEMERAL),
                poll: options.poll,
                stickers: options.stickers
            } as MessageDataMap[M];

        // Message edit - filter out Ephemeral and SuppressNotifications
        case SendMethod.MessageEdit:
            return {
                ...sharedBase,
                flags: filterFlags(options.flags, EXCLUDE_EPHEMERAL_AND_SUPPRESS)
            } as MessageDataMap[M];

        // User DM - filter out Ephemeral
        case SendMethod.UserDM:
            return {
                ...sharedBase,
                tts: options.tts,
                flags: filterFlags(options.flags, EXCLUDE_EPHEMERAL),
                poll: options.poll,
                stickers: options.stickers,
                forward: options.forward
            } as MessageDataMap[M];
    }
}

// Executes the actual send using the handler's appropriate method
async function executeSend<M extends SendMethod>(
    handler: SendHandler,
    method: M,
    data: MessageDataMap[M]
): Promise<Message | null> {
    switch (method) {
        // Reply to an interaction (initial response)
        case SendMethod.Reply: {
            const response = await (handler as RepliableInteraction).reply(data as InteractionReplyOptions);
            return isInteractionCallback(response) ? (response.resource?.message ?? null) : null;
        }

        // Edit an existing interaction reply
        case SendMethod.EditReply:
            return await (handler as RepliableInteraction).editReply(data as InteractionEditReplyOptions);

        // Follow-up to an already-replied interaction
        case SendMethod.FollowUp:
            return await (handler as RepliableInteraction).followUp(data as InteractionReplyOptions);

        // Send to a text-based channel
        case SendMethod.Channel:
            return await (handler as GuildTextBasedChannel).send(data as MessageCreateOptions);

        // Reply to an existing message
        case SendMethod.MessageReply:
            return await (handler as Message).reply(data as MessageReplyOptions);

        // Edit an existing message
        case SendMethod.MessageEdit: {
            const message = handler as Message;
            if (!message.editable) {
                throw new Error("[DynaSend] Message is not editable");
            }
            return await message.edit(data as MessageEditOptions);
        }

        // Send DM to a user or guild member
        case SendMethod.UserDM:
            return await (handler as GuildMember | User).send(data as MessageCreateOptions);

        default:
            throw new Error(`[DynaSend] Unknown send method '${method}'`);
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
 * @param handler The Discord.js object to send the message through
 * @param options Message options (content, embeds, flags, etc.). At least one content-bearing field is required.
 */
export async function dynaSend(handler: SendHandler, options: RequiredDynaSendOptions): Promise<Message | null> {
    const sendMethod = options.sendMethod ?? detectSendMethod(handler);

    validateSendMethod(handler, sendMethod);

    const messageData = createMessageData(options, sendMethod);
    const message = await executeSend(handler, sendMethod, messageData);

    if (options.deleteAfter && message) {
        scheduleDelete(message, options.deleteAfter);
    }

    return message;
}
