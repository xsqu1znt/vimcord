import {
    AnyThreadChannel,
    CategoryChannel,
    Channel,
    ChannelType,
    Client,
    DMChannel,
    Guild,
    GuildBasedChannel,
    GuildMember,
    GuildTextBasedChannel,
    Message,
    PartialDMChannel,
    PartialGroupDMChannel,
    Role,
    TextBasedChannel,
    User,
    VoiceBasedChannel
} from "discord.js";

export type FetchedChannel<T> = T extends ChannelType.DM
    ? PartialGroupDMChannel | DMChannel | PartialDMChannel
    : T extends ChannelType.GuildText
      ? GuildBasedChannel & TextBasedChannel
      : T extends ChannelType.PublicThread | ChannelType.PrivateThread | ChannelType.AnnouncementThread
        ? AnyThreadChannel
        : T extends ChannelType.GuildVoice
          ? VoiceBasedChannel
          : T extends ChannelType.GuildCategory
            ? CategoryChannel
            : GuildBasedChannel;

export type FetchedMessageMention<T extends MentionType, InGuild extends boolean> = T extends "user"
    ? User
    : T extends "member"
      ? GuildMember
      : T extends "channel"
        ? InGuild extends true
            ? GuildBasedChannel
            : Channel
        : Role;

export type MentionType = "user" | "member" | "channel" | "role";

export interface GetMessageMentionOptions {
    cleanContent?: string;
    /** Return the ID instead of the object. */
    parse?: boolean;
}

const MENTION_OR_SNOWFLAKE_REGEX = /<@[#&]?[\d]{6,}>|[\d]{6,}/;

const fetchUserPromises: Map<string, Promise<User | null>> = new Map();
const fetchGuildPromises: Map<string, Promise<Guild | null>> = new Map();
const fetchMemberPromises: Map<string, Promise<GuildMember | null>> = new Map();
const fetchChannelPromises: Map<string, Promise<GuildBasedChannel | null>> = new Map();
const fetchMessagePromises: Map<string, Promise<Message | null>> = new Map();
const fetchRolePromises: Map<string, Promise<Role | null>> = new Map();

function createCachedFetch<T>(cache: Map<string, Promise<T>>, fetchFn: () => Promise<T>, cacheKey: string): Promise<T> {
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const promise = fetchFn().finally(() => cache.delete(cacheKey));
    cache.set(cacheKey, promise);
    return promise;
}

/** Returns the string if it's populated, or "0" otherwise.
 *
 * Useful for fetching where the provided ID may or may not exist.
 * @param str The string to check. */
export function __zero(str?: string | null): string {
    return str?.length ? str : "0";
}

/** Check if the given string is a mention or a snowflake.
 *
 * Looks for formats like `<@123456789>`, or a numeric string with at least 6 digits.
 * @param str The string to check. */
export function isMentionOrSnowflake(str: string | undefined): boolean {
    return str ? MENTION_OR_SNOWFLAKE_REGEX.test(str) : false;
}

/** Remove mention syntax from a string.
 * @param str The string to clean. */
export function cleanMention(str: string | undefined): string | undefined {
    return str ? str.replaceAll(/[<@#&>]/g, "").trim() : undefined;
}

/** Get a mention or snowflake argument of a specified type from a message.
 * @param message - The message to parse.
 * @param content - The message's clean content to parse. Will be used if message.mentions isn't populated.
 * @param type - The type of mention.
 * @param index - The argument index in the content. Default is `0`
 * @param idOnly - Whether to return the ID instead of the fetched object. */
export async function getMessageMention<M extends Message, T extends MentionType>(
    message: M,
    content: string | undefined | null,
    type: T,
    index: number,
    idOnly: true
): Promise<string | null>;
export async function getMessageMention<M extends Message, T extends MentionType>(
    message: M,
    content: string | undefined | null,
    type: T,
    index?: number,
    idOnly?: false
): Promise<FetchedMessageMention<T, M extends Message<true> ? true : false> | null>;
export async function getMessageMention<M extends Message, T extends MentionType>(
    message: M,
    content: string | undefined | null,
    type: T,
    index: number = 0,
    idOnly?: boolean
): Promise<FetchedMessageMention<T, M extends Message<true> ? true : false> | string | null> {
    const args = content?.split(" ");
    const arg = isMentionOrSnowflake(args?.[index]) ? cleanMention(args?.[index]) : undefined;

    switch (type) {
        case "user": {
            const userMention = message.mentions.users.at(index) || null;
            if (!userMention && arg) {
                return idOnly
                    ? arg
                    : ((await fetchUser(message.client, arg)) as FetchedMessageMention<
                          T,
                          M extends Message<true> ? true : false
                      >);
            }
            return idOnly
                ? userMention?.id || null
                : (userMention as FetchedMessageMention<T, M extends Message<true> ? true : false>);
        }

        case "member": {
            if (!message.guild) return null;
            const member = await fetchMember(message.guild, message.mentions.users.at(index)?.id ?? arg);
            return idOnly
                ? member?.id || null
                : (member as FetchedMessageMention<T, M extends Message<true> ? true : false>);
        }

        case "channel": {
            const channelMention = message.mentions.channels.at(index) || null;
            if (!channelMention && arg) {
                if (idOnly) return arg;
                const channel = message.guild
                    ? await fetchChannel(message.guild, arg)
                    : (message.client.channels.cache.get(__zero(arg)) ?? message.client.channels.fetch(__zero(arg)));
                return channel as FetchedMessageMention<T, M extends Message<true> ? true : false>;
            }
            return idOnly
                ? channelMention?.id || null
                : (channelMention as FetchedMessageMention<T, M extends Message<true> ? true : false>);
        }

        case "role": {
            const roleMention = message.mentions.roles.at(index) || null;
            if (!roleMention && arg) {
                if (idOnly) return arg;
                return message.guild
                    ? ((await fetchRole(message.guild, arg)) as FetchedMessageMention<
                          T,
                          M extends Message<true> ? true : false
                      >)
                    : null;
            }
            return idOnly
                ? roleMention?.id || null
                : (roleMention as FetchedMessageMention<T, M extends Message<true> ? true : false>);
        }

        default:
            return null;
    }
}

/** Get the ID of the first mention of a specified type from a message or message content.
 * @param options Optional options that aren't really optional. */
export function getFirstMentionId(options: { message?: Message; content?: string; type: MentionType }): string {
    let mentionId = "";

    if (options.message) {
        switch (options.type) {
            case "user":
                mentionId = options.message.mentions.users.first()?.id || "";
                break;
            case "member":
                mentionId = options.message.mentions.members?.first()?.id || "";
                break;
            case "channel":
                mentionId = options.message.mentions.channels.first()?.id || "";
                break;
            case "role":
                mentionId = options.message.mentions.roles.first()?.id || "";
                break;
        }
    }

    const firstArg = options.content?.split(" ")[0] || "";
    return mentionId || isMentionOrSnowflake(firstArg) ? cleanMention(firstArg)! : "";
}

/** Fetch a user from the client, checking the cache first.
 * @param client - The client to fetch the user from.
 * @param userId - The ID of the user to fetch. */
export async function fetchUser(client: Client<true>, userId: string | undefined | null): Promise<User | null> {
    if (!userId) return null;
    const key = `${client.user.id}-${userId}`;
    const cached = client.users.cache.get(__zero(userId));
    if (cached) return cached;
    return createCachedFetch(fetchUserPromises, () => client.users.fetch(__zero(userId)).catch(() => null), key);
}

/** Fetch a guild from the client, checking the cache first.
 * @param client - The client to fetch the guild from.
 * @param guildId - The ID of the guild to fetch. */
export async function fetchGuild(client: Client<true>, guildId: string | undefined | null): Promise<Guild | null> {
    if (!guildId) return null;
    const key = `${client.user.id}-${guildId}`;
    const cached = client.guilds.cache.get(__zero(guildId));
    if (cached) return cached;
    return createCachedFetch(fetchGuildPromises, () => client.guilds.fetch(__zero(guildId)).catch(() => null), key);
}

/** Fetch a member from a guild, checking the cache first.
 * @param guild - The guild to fetch the member from.
 * @param memberId - The ID of the member to fetch. */
export async function fetchMember(guild: Guild, memberId: string | undefined | null): Promise<GuildMember | null> {
    if (!memberId) return null;
    const key = `${guild.id}-${memberId}`;
    const cached = guild.members.cache.get(__zero(memberId));
    if (cached) return cached;
    return createCachedFetch(fetchMemberPromises, () => guild.members.fetch(__zero(memberId)).catch(() => null), key);
}

/** Fetch a channel from a guild, checking the cache first.
 *
 * ***NOTE:*** If the channel type does not match the provided type or the channel is null, null is returned.
 * @param guild - The guild to fetch the channel from.
 * @param channelId - The ID of the channel to fetch.
 * @param type - The type of channel to fetch. */
export async function fetchChannel<T extends ChannelType>(
    guild: Guild,
    channelId: string | undefined | null,
    type?: T
): Promise<FetchedChannel<T> | null> {
    if (!channelId) return null;
    const key = `${guild.id}-${channelId}`;
    const cached = guild.channels.cache.get(__zero(channelId)) ?? null;
    if (cached) {
        if (type && cached.type !== type) return null;
        return cached as FetchedChannel<T>;
    }
    const channel = await createCachedFetch(
        fetchChannelPromises,
        () => guild.channels.fetch(__zero(channelId)).catch(() => null),
        key
    );
    if (type && channel?.type !== type) return null;
    return channel as FetchedChannel<T>;
}

/** Fetch a message from a channel, checking the cache first.
 * @param channel - The channel to fetch the message from.
 * @param messageId - The ID of the message to fetch. */
export async function fetchMessage(
    channel: GuildTextBasedChannel | VoiceBasedChannel,
    messageId: string | undefined | null
): Promise<Message | null> {
    if (!messageId) return null;
    const key = `${channel.guild.id}-${messageId}`;
    const cached = channel.messages.cache.get(__zero(messageId));
    if (cached) return cached;
    return createCachedFetch(fetchMessagePromises, () => channel.messages.fetch(__zero(messageId)).catch(() => null), key);
}

/** Fetch a role from a guild, checking the cache first.
 * @param guild - The guild to fetch the role from.
 * @param roleId - The ID of the role to fetch. */
export async function fetchRole(guild: Guild, roleId: string | undefined | null): Promise<Role | null> {
    if (!roleId) return null;
    const key = `${guild.id}-${roleId}`;
    const cached = guild.roles.cache.get(__zero(roleId));
    if (cached) return cached;
    return createCachedFetch(fetchRolePromises, () => guild.roles.fetch(__zero(roleId)).catch(() => null), key);
}
