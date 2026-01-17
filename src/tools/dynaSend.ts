import {
    ActionRowBuilder,
    APIContainerComponent,
    BaseChannel,
    BaseInteraction,
    BaseMessageOptions,
    ContainerBuilder,
    ForwardOptions,
    GuildMember,
    GuildTextBasedChannel,
    InteractionCallbackResponse,
    InteractionReplyOptions,
    Message,
    MessageActionRowComponentBuilder,
    MessageMentionOptions,
    PollData,
    RepliableInteraction,
    ReplyOptions,
    StickerResolvable,
    User
} from "discord.js";
import { EmbedResolvable, SendHandler, SendMethod } from "./types";
import { BetterContainer } from "./BetterContainer";

type Mutable<T> = {
    -readonly [P in keyof T]: T[P];
};

export type SendableComponent = ContainerBuilder | BetterContainer | ActionRowBuilder<MessageActionRowComponentBuilder>;
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
    /** The method used to send the message - auto-detected if not provided */
    sendMethod?: SendMethod;
    /** Text content to send in the message */
    content?: string;
    /** Embeds to send with the message */
    embeds?: EmbedResolvable[];
    /** Components to send with the message */
    components?: SendableComponent[];
    /** Attachments to send with the message */
    files?: Mutable<BaseMessageOptions["files"]>;
    /** Stickers to send with the message */
    stickers?: StickerResolvable[];
    /** Send a poll */
    poll?: PollData;
    /** Interaction flags */
    flags?: InteractionReplyOptions["flags"];
    /** Return the message after replying to or editing an interaction */
    withResponse?: boolean;
    /** Mention types allowed for the message */
    allowedMentions?: MessageMentionOptions;
    /** The message to reply to */
    reply?: ReplyOptions;
    /** Forward a message */
    forward?: ForwardOptions;
    /** Send as a TTS message */
    tts?: boolean;
    /** Time in milliseconds before deleting the message */
    deleteAfter?: number;
}

export class DynaSend {
    private static forceArray<T>(value: T | T[]): T[] {
        return Array.isArray(value) ? value : [value];
    }

    private static isInteractionCallback(obj: any): obj is InteractionCallbackResponse {
        return obj instanceof InteractionCallbackResponse;
    }

    private static filterFlags(
        flags: InteractionReplyOptions["flags"],
        excludeFlags: string[]
    ): InteractionReplyOptions["flags"] {
        if (!flags) return undefined;
        const flagArray = this.forceArray(flags);
        return flagArray.filter(flag => !excludeFlags.includes(flag as string));
    }

    private static detectSendMethod(handler: SendHandler): SendMethod {
        if (handler instanceof BaseInteraction) {
            return handler.replied || handler.deferred ? SendMethod.EditReply : SendMethod.Reply;
        }
        if (handler instanceof BaseChannel) return SendMethod.Channel;
        if (handler instanceof Message) return SendMethod.MessageReply;
        if (handler instanceof GuildMember || handler instanceof User) return SendMethod.User;

        throw new Error("[DynaSend] Unable to determine send method for handler type");
    }

    private static validateSendMethod(handler: SendHandler, method: SendMethod): void {
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

    private static createMessageData(options: DynaSendOptions, method: SendMethod): any {
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
                };

            case SendMethod.EditReply:
                return {
                    ...baseData,
                    flags: this.filterFlags(options.flags, ["Ephemeral", "SuppressNotifications"]),
                    withResponse: options.withResponse,
                    poll: options.poll
                };

            case SendMethod.FollowUp:
                return {
                    ...baseData,
                    flags: options.flags,
                    withResponse: options.withResponse,
                    poll: options.poll
                };

            case SendMethod.Channel:
                return {
                    ...baseData,
                    flags: this.filterFlags(options.flags, ["Ephemeral"]),
                    poll: options.poll,
                    stickers: options.stickers,
                    reply: options.reply
                };

            case SendMethod.MessageReply:
                return {
                    ...baseData,
                    flags: this.filterFlags(options.flags, ["Ephemeral"]),
                    poll: options.poll,
                    stickers: options.stickers
                };

            case SendMethod.MessageEdit:
                return {
                    ...baseData,
                    flags: this.filterFlags(options.flags, ["Ephemeral", "SuppressNotifications"])
                };

            case SendMethod.User:
                return {
                    ...baseData,
                    flags: this.filterFlags(options.flags, ["Ephemeral"]),
                    poll: options.poll,
                    forward: options.forward,
                    stickers: options.stickers
                };

            default:
                return baseData;
        }
    }

    private static async executeSend(handler: SendHandler, method: SendMethod, data: any): Promise<Message | null> {
        try {
            switch (method) {
                case SendMethod.Reply: {
                    const response = await (handler as RepliableInteraction).reply(data);
                    return this.isInteractionCallback(response) ? (response.resource?.message ?? null) : null;
                }

                case SendMethod.EditReply:
                    return await (handler as RepliableInteraction).editReply(data);

                case SendMethod.FollowUp:
                    return await (handler as RepliableInteraction).followUp(data);

                case SendMethod.Channel:
                    return await (handler as GuildTextBasedChannel).send(data);

                case SendMethod.MessageReply:
                    return await (handler as Message).reply(data);

                case SendMethod.MessageEdit: {
                    const message = handler as Message;
                    if (!message.editable) {
                        console.warn("[DynaSend] Message is not editable");
                        return null;
                    }
                    return await message.edit(data);
                }

                case SendMethod.User:
                    return await (handler as GuildMember | User).send(data);

                default:
                    throw new Error(`[DynaSend] Unknown send method '${method}'`);
            }
        } catch (error) {
            console.error(`[DynaSend] Error with method '${SendMethod[method]}':`, error);
            return null;
        }
    }

    private static scheduleDelete(message: Message, delay: number): void {
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

    static async send(handler: SendHandler, options: RequiredDynaSendOptions): Promise<Message | null> {
        // Determine send method
        const sendMethod = options.sendMethod ?? this.detectSendMethod(handler);

        // Validate the combination
        this.validateSendMethod(handler, sendMethod);

        // Create message data
        const messageData = this.createMessageData(options, sendMethod);

        // Execute the send
        const message = await this.executeSend(handler, sendMethod, messageData);

        // Schedule deletion if requested
        if (options.deleteAfter && message) {
            this.scheduleDelete(message, options.deleteAfter);
        }

        return message;
    }
}

export async function dynaSend(handler: SendHandler, options: RequiredDynaSendOptions): Promise<Message | null> {
    return DynaSend.send(handler, options);
}
