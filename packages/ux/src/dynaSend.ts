import type {
    ActionRowBuilder,
    BaseMessageOptions,
    ContainerBuilder,
    ForwardOptions,
    GuildTextBasedChannel,
    InteractionEditReplyOptions,
    InteractionReplyOptions,
    MessageActionRowComponentBuilder,
    MessageEditOptions,
    MessageMentionOptions,
    PollData,
    RepliableInteraction,
    ReplyOptions,
    StickerResolvable
} from "discord.js";
import type { EmbedResolvable, SendHandler } from "./dynaSend.types.js";

import { BaseChannel, BaseInteraction, GuildMember, InteractionCallbackResponse, Message, User } from "discord.js";
import { forceArray } from "@vimcord/internal";
import { SendMethod } from "./dynaSend.types.js";

type Mutable<T> = {
    -readonly [P in keyof T]: T[P];
};

export type SendableComponent = ContainerBuilder | ActionRowBuilder<MessageActionRowComponentBuilder>;

export type RequiredDynaSendOptions = DynaSendOptions &
    (
        | { content: string }
        | { embeds: DynaSendOptions["embeds"] }
        | { components: DynaSendOptions["components"] }
        | { files: Mutable<BaseMessageOptions["files"]> }
        | { stickers: StickerResolvable[] }
        | { poll: PollData }
        | { forward: ForwardOptions }
    );

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

// --- Helpers ---

function isInteractionCallback(obj: unknown): obj is InteractionCallbackResponse {
    return obj instanceof InteractionCallbackResponse;
}

function filterFlags(flags: InteractionReplyOptions["flags"], excludeFlags: string[]): InteractionReplyOptions["flags"] {
    if (!flags) return undefined;
    const flagArray = forceArray(flags);
    return flagArray.filter(flag => !excludeFlags.includes(flag as string));
}

// --- Send Method Detection ---

function detectSendMethod(handler: SendHandler): SendMethod {
    if (handler instanceof BaseInteraction) {
        return handler.replied || handler.deferred ? SendMethod.EditReply : SendMethod.Reply;
    }
    if (handler instanceof BaseChannel) return SendMethod.Channel;
    if (handler instanceof Message) return SendMethod.MessageReply;
    if (handler instanceof GuildMember || handler instanceof User) return SendMethod.User;

    throw new Error("[DynaSend] Unable to determine send method for handler type");
}

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

    if (method === SendMethod.User && !(handler instanceof GuildMember || handler instanceof User)) {
        throw new TypeError(`[DynaSend] SendMethod '${SendMethod[method]}' requires User or GuildMember handler`);
    }
}

// --- Message Data Construction ---

type MessageDataMap = {
    [SendMethod.Reply]: InteractionReplyOptions;
    [SendMethod.EditReply]: InteractionEditReplyOptions;
    [SendMethod.FollowUp]: InteractionReplyOptions;
    [SendMethod.Channel]: BaseMessageOptions;
    [SendMethod.MessageReply]: ReplyOptions;
    [SendMethod.MessageEdit]: MessageEditOptions;
    [SendMethod.User]: BaseMessageOptions;
};

function createMessageData<M extends SendMethod>(options: DynaSendOptions, method: M): MessageDataMap[M] {
    const baseData = {
        content: options.content,
        embeds: options.embeds,
        components: options.components,
        files: options.files,
        allowedMentions: options.allowedMentions,
        tts: options.tts
    };

    switch (method) {
        case SendMethod.Reply:
            return {
                ...baseData,
                flags: options.flags,
                withResponse: options.withResponse,
                poll: options.poll
            } as unknown as MessageDataMap[M];

        case SendMethod.EditReply:
            return {
                ...baseData,
                flags: filterFlags(options.flags, ["Ephemeral", "SuppressNotifications"]),
                withResponse: options.withResponse,
                poll: options.poll
            } as unknown as MessageDataMap[M];

        case SendMethod.FollowUp:
            return {
                ...baseData,
                flags: options.flags,
                withResponse: options.withResponse,
                poll: options.poll
            } as unknown as MessageDataMap[M];

        case SendMethod.Channel:
            return {
                ...baseData,
                flags: filterFlags(options.flags, ["Ephemeral"]),
                poll: options.poll,
                stickers: options.stickers,
                reply: options.reply
            } as unknown as MessageDataMap[M];

        case SendMethod.MessageReply:
            return {
                ...baseData,
                flags: filterFlags(options.flags, ["Ephemeral"]),
                poll: options.poll,
                stickers: options.stickers
            } as unknown as MessageDataMap[M];

        case SendMethod.MessageEdit:
            return {
                ...baseData,
                flags: filterFlags(options.flags, ["Ephemeral", "SuppressNotifications"])
            } as unknown as MessageDataMap[M];

        case SendMethod.User:
            return {
                ...baseData,
                flags: filterFlags(options.flags, ["Ephemeral"]),
                poll: options.poll,
                forward: options.forward,
                stickers: options.stickers
            } as unknown as MessageDataMap[M];
    }
}

// --- Send Execution ---

async function executeSend<M extends SendMethod>(
    handler: SendHandler,
    method: M,
    data: MessageDataMap[M]
): Promise<Message> {
    switch (method) {
        case SendMethod.Reply: {
            const response = await (handler as RepliableInteraction).reply(data as InteractionReplyOptions);
            return isInteractionCallback(response)
                ? (response.resource?.message ?? (null as unknown as Message))
                : (null as unknown as Message);
        }

        case SendMethod.EditReply:
            return await (handler as RepliableInteraction).editReply(data as InteractionEditReplyOptions);

        case SendMethod.FollowUp:
            return await (handler as RepliableInteraction).followUp(data as InteractionReplyOptions);

        case SendMethod.Channel:
            return await (handler as GuildTextBasedChannel).send(data as BaseMessageOptions);

        case SendMethod.MessageReply:
            return await (handler as Message).reply(data as ReplyOptions);

        case SendMethod.MessageEdit: {
            const message = handler as Message;
            if (!message.editable) {
                throw new Error("[DynaSend] Message is not editable");
            }
            return await message.edit(data as MessageEditOptions);
        }

        case SendMethod.User:
            return await (handler as GuildMember | User).send(data as BaseMessageOptions);

        default:
            throw new Error(`[DynaSend] Unknown send method '${method}'`);
    }
}

// --- Auto-Delete ---

function scheduleDelete(message: Message, delay: number): void {
    if (delay < 1000) {
        console.warn(`[DynaSend] Delete delay is less than 1 second (${delay}ms). Is this intentional?`);
    }

    setTimeout(async () => {
        try {
            if (message.deletable) {
                await message.delete();
            }
        } catch (error) {
            console.error("[DynaSend] Error deleting message:", error);
        }
    }, delay);
}

// --- Main ---

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
