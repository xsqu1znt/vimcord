import type { Guild, User } from "discord.js";
import type { Vimcord } from "@/client/Vimcord.js";
import type { CLICommandContext } from "../types.js";

const DISCORD_ID_PATTERN = /^\d{17,20}$/;

/** Narrows a command context after the runtime enforces client targeting. */
export function requireCLIClient(context: CLICommandContext): Vimcord {
    if (!context.client) throw new Error("This command requires a selected client");
    return context.client;
}

export function formatBytes(bytes: number): string {
    const units = ["B", "KiB", "MiB", "GiB"];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex++;
    }

    return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatDuration(milliseconds: number | null): string {
    if (milliseconds === null || milliseconds < 0) return "Unavailable";

    let seconds = Math.floor(milliseconds / 1_000);
    const days = Math.floor(seconds / 86_400);
    seconds %= 86_400;
    const hours = Math.floor(seconds / 3_600);
    seconds %= 3_600;
    const minutes = Math.floor(seconds / 60);
    seconds %= 60;

    return [days ? `${days}d` : "", hours ? `${hours}h` : "", minutes ? `${minutes}m` : "", `${seconds}s`]
        .filter(Boolean)
        .join(" ");
}

export function formatLatency(latencyMs?: number): string {
    return latencyMs === undefined ? "—" : `${latencyMs.toFixed(1)} ms`;
}

function resolveUniqueMatch<T>(query: string, matches: readonly T[], describe: (value: T) => string): T | null {
    if (!matches.length) return null;
    if (matches.length > 1) {
        throw new Error(`'${query}' is ambiguous; matches: ${matches.map(describe).join(", ")}`);
    }
    return matches[0]!;
}

/** Resolves a guild id through Discord or a unique cached guild name. */
export async function resolveCLIGuild(client: Vimcord, query: string): Promise<Guild> {
    if (DISCORD_ID_PATTERN.test(query)) {
        const guild = await client.fetchGuild(query);
        if (!guild) throw new Error(`Guild '${query}' is not available to this client`);
        return guild;
    }

    const normalized = query.toLowerCase();
    const guilds = Array.from(client.guilds.cache.values());
    const exact = resolveUniqueMatch(
        query,
        guilds.filter(guild => guild.name.toLowerCase() === normalized),
        guild => `${guild.name} (${guild.id})`
    );
    if (exact) return exact;

    const partial = resolveUniqueMatch(
        query,
        guilds.filter(guild => guild.name.toLowerCase().includes(normalized)),
        guild => `${guild.name} (${guild.id})`
    );
    if (!partial) throw new Error(`No cached guild matches '${query}'`);
    return partial;
}

/** Resolves a user id through Discord or a unique cached username, tag, or global name. */
export async function resolveCLIUser(client: Vimcord, query: string): Promise<User> {
    if (DISCORD_ID_PATTERN.test(query)) {
        const user = await client.fetchUser(query);
        if (!user) throw new Error(`User '${query}' could not be fetched`);
        return user;
    }

    const normalized = query.toLowerCase();
    const users = Array.from(client.users.cache.values());
    const values = (user: User): string[] =>
        [user.username, user.tag, user.globalName].filter((value): value is string => Boolean(value));
    const exact = resolveUniqueMatch(
        query,
        users.filter(user => values(user).some(value => value.toLowerCase() === normalized)),
        user => `${user.tag} (${user.id})`
    );
    if (exact) return exact;

    const partial = resolveUniqueMatch(
        query,
        users.filter(user => values(user).some(value => value.toLowerCase().includes(normalized))),
        user => `${user.tag} (${user.id})`
    );
    if (!partial) throw new Error(`No cached user matches '${query}'; use a Discord user id to fetch one`);
    return partial;
}
