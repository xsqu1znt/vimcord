import type {
    Guild,
    GuildMember,
    GuildResolvable,
    PermissionResolvable,
    RoleResolvable,
    User,
    UserResolvable
} from "discord.js";
import type { CommandModuleContext, CommandModuleType } from "@/abstracts/AbstractCommandModule.js";
import type { ModuleTestResult } from "@/abstracts/AbstractModule.js";
import type { StaffGlobals } from "@/client/globals.js";

export enum MissingPermissionReason {
    User = "User",
    UserBlacklisted = "UserBlacklisted",

    Role = "Role",
    RoleBlacklisted = "RoleBlacklisted",

    Client = "Client",
    IsBot = "IsBot",

    GuildBlacklisted = "GuildBlacklisted",
    NotInGuild = "NotInGuild",

    NotGuildOwner = "NotGuildOwner",
    NotBotOwner = "NotBotOwner",
    NotBotStaff = "NotBotStaff"
}

export interface CommandModulePermissions {
    /** Permissions the user is required to have to use this command.
     * @remarks If this is a slash command, use the builder's `setDefaultMemberPermissions` option instead. */
    user?: PermissionResolvable[];
    /** Only allow these users to use this command. */
    userWhitelist?: UserResolvable[];
    /** Don't allow these users to use this command. */
    userBlacklist?: UserResolvable[];

    /** Only allow these roles to use this command. */
    roles?: RoleResolvable[];
    /** Don't allow these roles to use this command. */
    roleBlacklist?: RoleResolvable[];

    /** Permissions the client is required to have to execute this command. */
    client?: PermissionResolvable[];
    /** Allow other bots to use this command. */
    allowBots?: boolean;

    /** Only allow these guilds to use this command. */
    guildWhitelist?: GuildResolvable[];
    /** Don't allow these guilds to use this command. */
    guildBlacklist?: GuildResolvable[];
    /**
     * Make this command only usable inside of a guild.
     * @remarks For slash commands, use the builder's `setContexts()` option instead.
     */
    guildOnly?: boolean;

    /** Only the owner of the guild can use this command. */
    guildOwnerOnly?: boolean;
    /** Only allow the bot owner to use this command. */
    botOwnerOnly?: boolean;
    /** Only allow the bot staff, including the bot owner, to use this command. */
    botStaffOnly?: boolean;
}

export type PermissionTestResult =
    | ModuleTestResult<true>
    | (ModuleTestResult<false> & {
          reason: MissingPermissionReason;
          missingUserPermissions?: PermissionResolvable[];
          missingClientPermissions?: PermissionResolvable[];
          missingRoles?: RoleResolvable[];
      });

export function testCommandPermissions<K extends CommandModuleType>(
    ctx: CommandModuleContext<K>,
    permissions: CommandModulePermissions
): PermissionTestResult {
    const source = ctx.args[0];
    const guild = source.guild;
    const member = source.member as GuildMember | null;
    const user = "author" in source ? source.author : source.user;

    let result = testGuildContext(
        guild,
        permissions.guildOnly ?? false,
        permissions.guildWhitelist,
        permissions.guildBlacklist
    );
    if (!result.passed) return result;

    result = testBotPresence(user, permissions.allowBots ?? false);
    if (!result.passed) return result;

    result = testUserWhitelist(user.id, permissions.userWhitelist);
    if (!result.passed) return result;

    result = testUserBlacklist(user.id, permissions.userBlacklist);
    if (!result.passed) return result;

    result = testGuildOwnership(guild, user.id, permissions.guildOwnerOnly ?? false);
    if (!result.passed) return result;

    result = testBotOwnership(ctx.client.globals.staff.ownerId, user.id, permissions.botOwnerOnly ?? false);
    if (!result.passed) return result;

    result = testBotStaff(ctx.client.globals.staff, user.id, member, permissions.botStaffOnly ?? false);
    if (!result.passed) return result;

    result = testRoles(member, permissions.roles, permissions.roleBlacklist);
    if (!result.passed) return result;

    result = testUserPermissions(member, permissions.user);
    if (!result.passed) return result;

    result = testClientPermissions(guild, permissions.client);
    if (!result.passed) return result;

    return { passed: true };
}

export function testUserPermissions(
    member: GuildMember | null,
    requiredPermissions: PermissionResolvable[] | undefined
): PermissionTestResult {
    if (!requiredPermissions?.length || !member || !("guild" in member)) {
        return { passed: true };
    }

    const missing = requiredPermissions.filter(p => !member.permissions.has(p));
    if (missing.length) {
        return { passed: false, reason: MissingPermissionReason.User, missingUserPermissions: missing };
    }

    return { passed: true };
}

export function testUserWhitelist(userId: string, userWhitelist: UserResolvable[] | undefined): PermissionTestResult {
    if (!userWhitelist?.length) {
        return { passed: true };
    }

    const whitelistedIds = userWhitelist.map(u => u.toString());
    if (!whitelistedIds.includes(userId)) {
        return { passed: false, reason: MissingPermissionReason.UserBlacklisted };
    }

    return { passed: true };
}

export function testUserBlacklist(userId: string, userBlacklist: UserResolvable[] | undefined): PermissionTestResult {
    if (!userBlacklist?.length) {
        return { passed: true };
    }

    const blacklistedIds = userBlacklist.map(u => u.toString());
    if (blacklistedIds.includes(userId)) {
        return { passed: false, reason: MissingPermissionReason.UserBlacklisted };
    }

    return { passed: true };
}

export function testRoles(
    member: GuildMember | null,
    allowedRoles: RoleResolvable[] | undefined,
    blockedRoles: RoleResolvable[] | undefined
): PermissionTestResult {
    if (!member || !("roles" in member)) {
        return { passed: true };
    }

    const allowedIds = allowedRoles?.map(r => r.toString()) ?? [];
    const blockedIds = blockedRoles?.map(r => r.toString()) ?? [];

    if (allowedIds.length) {
        const memberRoleIds = member.roles.cache.map(r => r.id);
        const hasAllowed = allowedIds.some(id => memberRoleIds.includes(id));
        if (!hasAllowed) {
            return { passed: false, reason: MissingPermissionReason.Role, missingRoles: allowedRoles };
        }
    }

    if (blockedIds.length) {
        const memberRoleIds = member.roles.cache.map(r => r.id);
        const hasBlocked = blockedIds.some(id => memberRoleIds.includes(id));
        if (hasBlocked) {
            return { passed: false, reason: MissingPermissionReason.RoleBlacklisted };
        }
    }

    return { passed: true };
}

export function testClientPermissions(
    guild: Guild | null,
    requiredPermissions: PermissionResolvable[] | undefined
): PermissionTestResult {
    if (!requiredPermissions?.length || !guild?.members.me) {
        return { passed: true };
    }

    const clientMember = guild.members.me;
    if (!clientMember) return { passed: true };

    const missing = requiredPermissions.filter(p => !clientMember.permissions.has(p));
    if (missing.length) {
        return { passed: false, reason: MissingPermissionReason.Client, missingClientPermissions: missing };
    }

    return { passed: true };
}

export function testGuildContext(
    guild: Guild | null,
    guildOnly: boolean,
    guildWhitelist: GuildResolvable[] | undefined,
    guildBlacklist: GuildResolvable[] | undefined
): PermissionTestResult {
    if (guildOnly && !guild) {
        return { passed: false, reason: MissingPermissionReason.NotInGuild };
    }

    if (guildBlacklist?.length && guild) {
        const blacklistIds = guildBlacklist.map(g => g.toString());
        if (blacklistIds.includes(guild.id)) {
            return { passed: false, reason: MissingPermissionReason.GuildBlacklisted };
        }
    }

    if (guildWhitelist?.length && guild) {
        const whitelistIds = guildWhitelist.map(g => g.toString());
        if (!whitelistIds.includes(guild.id)) {
            return { passed: false, reason: MissingPermissionReason.GuildBlacklisted };
        }
    }

    return { passed: true };
}

export function testBotPresence(user: User, allowBots: boolean): PermissionTestResult {
    if (!allowBots && user.bot) {
        return { passed: false, reason: MissingPermissionReason.IsBot };
    }

    return { passed: true };
}

export function testGuildOwnership(guild: Guild | null, userId: string, guildOwnerOnly: boolean): PermissionTestResult {
    if (!guildOwnerOnly || !guild) {
        return { passed: true };
    }

    if (guild.ownerId !== userId) {
        return { passed: false, reason: MissingPermissionReason.NotGuildOwner };
    }

    return { passed: true };
}

export function testBotOwnership(ownerId: string | null, userId: string, botOwnerOnly: boolean): PermissionTestResult {
    if (!botOwnerOnly) {
        return { passed: true };
    }

    if (ownerId !== userId) {
        return { passed: false, reason: MissingPermissionReason.NotBotOwner };
    }

    return { passed: true };
}

export function testBotStaff(
    staff: StaffGlobals,
    userId: string,
    member: GuildMember | null,
    botStaffOnly: boolean
): PermissionTestResult {
    if (!botStaffOnly) {
        return { passed: true };
    }

    if (staff.ownerId === userId || staff.superUsers.includes(userId)) {
        return { passed: true };
    }

    const memberRoleIds = member?.roles.cache.map(r => r.id) ?? [];
    const hasStaffRole = staff.superUserRoles.some(id => memberRoleIds.includes(id));
    if (hasStaffRole) {
        return { passed: true };
    }

    return { passed: false, reason: MissingPermissionReason.NotBotStaff };
}
