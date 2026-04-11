import type {
    Guild,
    GuildMember,
    GuildResolvable,
    PermissionResolvable,
    RoleResolvable,
    User,
    UserResolvable
} from "discord.js";
import type { PermissionTestResult } from "./AbstractCommandModule.js";

import { MissingPermissionReason } from "./AbstractCommandModule.js";

export function testUserPermissions(
    member: GuildMember | null,
    requiredPermissions: PermissionResolvable[] | undefined
): Promise<PermissionTestResult> {
    if (!requiredPermissions?.length || !member || !("guild" in member)) {
        return Promise.resolve({ passed: true });
    }

    const missing = requiredPermissions.filter(p => !member.permissions.has(p));
    if (missing.length) {
        return Promise.resolve({ passed: false, reason: MissingPermissionReason.User, missingUserPermissions: missing });
    }

    return Promise.resolve({ passed: true });
}

export function testUserWhitelist(
    userId: string,
    userWhitelist: UserResolvable[] | undefined
): Promise<PermissionTestResult> {
    if (!userWhitelist?.length) {
        return Promise.resolve({ passed: true });
    }

    const whitelistedIds = userWhitelist.map(u => u.toString());
    if (!whitelistedIds.includes(userId)) {
        return Promise.resolve({ passed: false, reason: MissingPermissionReason.UserBlacklisted });
    }

    return Promise.resolve({ passed: true });
}

export function testUserBlacklist(
    userId: string,
    userBlacklist: UserResolvable[] | undefined
): Promise<PermissionTestResult> {
    if (!userBlacklist?.length) {
        return Promise.resolve({ passed: true });
    }

    const blacklistedIds = userBlacklist.map(u => u.toString());
    if (blacklistedIds.includes(userId)) {
        return Promise.resolve({ passed: false, reason: MissingPermissionReason.UserBlacklisted });
    }

    return Promise.resolve({ passed: true });
}

export function testRoles(
    member: GuildMember | null,
    allowedRoles: RoleResolvable[] | undefined,
    blockedRoles: RoleResolvable[] | undefined
): Promise<PermissionTestResult> {
    if (!member || !("roles" in member)) {
        return Promise.resolve({ passed: true });
    }

    const allowedIds = allowedRoles?.map(r => r.toString()) ?? [];
    const blockedIds = blockedRoles?.map(r => r.toString()) ?? [];

    if (allowedIds.length) {
        const memberRoleIds = member.roles.cache.map(r => r.id);
        const hasAllowed = allowedIds.some(id => memberRoleIds.includes(id));
        if (!hasAllowed) {
            return Promise.resolve({ passed: false, reason: MissingPermissionReason.Role, missingRoles: allowedRoles });
        }
    }

    if (blockedIds.length) {
        const memberRoleIds = member.roles.cache.map(r => r.id);
        const hasBlocked = blockedIds.some(id => memberRoleIds.includes(id));
        if (hasBlocked) {
            return Promise.resolve({ passed: false, reason: MissingPermissionReason.RoleBlacklisted });
        }
    }

    return Promise.resolve({ passed: true });
}

export function testClientPermissions(
    guild: Guild | null,
    requiredPermissions: PermissionResolvable[] | undefined
): Promise<PermissionTestResult> {
    if (!requiredPermissions?.length || !guild?.members.me) {
        return Promise.resolve({ passed: true });
    }

    const clientMember = guild.members.me;
    if (!clientMember) return Promise.resolve({ passed: true });

    const missing = requiredPermissions.filter(p => !clientMember.permissions.has(p));
    if (missing.length) {
        return Promise.resolve({ passed: false, reason: MissingPermissionReason.Client, missingClientPermissions: missing });
    }

    return Promise.resolve({ passed: true });
}

export function testGuildContext(
    guild: Guild | null,
    guildOnly: boolean,
    guildWhitelist: GuildResolvable[] | undefined,
    guildBlacklist: GuildResolvable[] | undefined
): Promise<PermissionTestResult> {
    if (guildOnly && !guild) {
        return Promise.resolve({ passed: false, reason: MissingPermissionReason.NotInGuild });
    }

    if (guildBlacklist?.length && guild) {
        const blacklistIds = guildBlacklist.map(g => g.toString());
        if (blacklistIds.includes(guild.id)) {
            return Promise.resolve({ passed: false, reason: MissingPermissionReason.GuildBlacklisted });
        }
    }

    if (guildWhitelist?.length && guild) {
        const whitelistIds = guildWhitelist.map(g => g.toString());
        if (!whitelistIds.includes(guild.id)) {
            return Promise.resolve({ passed: false, reason: MissingPermissionReason.GuildBlacklisted });
        }
    }

    return Promise.resolve({ passed: true });
}

export function testBotPresence(user: User, allowBots: boolean): Promise<PermissionTestResult> {
    if (!allowBots && user.bot) {
        return Promise.resolve({ passed: false, reason: MissingPermissionReason.IsBot });
    }

    return Promise.resolve({ passed: true });
}

export function testGuildOwnership(
    guild: Guild | null,
    userId: string,
    guildOwnerOnly: boolean
): Promise<PermissionTestResult> {
    if (!guildOwnerOnly || !guild) {
        return Promise.resolve({ passed: true });
    }

    if (guild.ownerId !== userId) {
        return Promise.resolve({ passed: false, reason: MissingPermissionReason.NotGuildOwner });
    }

    return Promise.resolve({ passed: true });
}
