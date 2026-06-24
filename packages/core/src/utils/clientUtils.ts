import type { FetchGuildOptions, User, UserResolvable } from "discord.js";
import type { Vimcord } from "@/client/index.js";

/**
 * Fetches a guild, first checking if the guild is cached.
 * @param client The Vimcord client
 * @param options The ID or options to fetch
 */
export async function fetchGuild(client: Vimcord, options: string | FetchGuildOptions | null | undefined) {
    if (options === null || options === undefined) return null;
    const fetch = async () => await client.guilds.fetch(options).catch(() => null);
    return typeof options === "string" ? (client.guilds.cache.get(options) ?? (await fetch())) : await fetch();
}

/**
 * Fetches a user, first checking if the user is cached.
 * @param client The Vimcord client
 * @param user The ID or user to fetch
 */
export async function fetchUser(client: Vimcord, user: UserResolvable | null | undefined): Promise<User | null> {
    if (user === null || user === undefined) return null;
    const fetch = async () => await client.users.fetch(user, { cache: true }).catch(() => null);
    return typeof user === "string" ? (client.users.cache.get(user) ?? (await fetch())) : await fetch();
}
