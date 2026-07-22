import type { Guild, GuildMember, GuildMemberResolvable, Role, RoleResolvable } from "discord.js";

/**
 * Fetches a guild role after checking the guild's role cache.
 * @param guild Guild that owns the role.
 * @param role Role or role ID to resolve.
 */
export async function fetchRole(
    guild: Guild | null | undefined,
    role: RoleResolvable | null | undefined
): Promise<Role | null> {
    if (!guild || role === null || role === undefined) return null;

    const roleId = guild.roles.resolveId(role);
    if (!roleId) return null;
    return guild.roles.cache.get(roleId) ?? (await guild.roles.fetch(roleId, { cache: true }).catch(() => null));
}

/**
 * Fetches a guild member after checking the guild's member cache.
 * @param guild Guild that owns the member.
 * @param member Member, user, or user ID to resolve.
 */
export async function fetchMember(
    guild: Guild | null | undefined,
    member: GuildMemberResolvable | null | undefined
): Promise<GuildMember | null> {
    if (!guild || member === null || member === undefined) return null;

    const memberId = guild.members.resolveId(member);
    if (!memberId) return null;
    return (
        guild.members.cache.get(memberId) ?? (await guild.members.fetch({ user: memberId, cache: true }).catch(() => null))
    );
}
