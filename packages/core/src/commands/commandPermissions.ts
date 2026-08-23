import type {
    APIInteractionGuildMember,
    Guild,
    GuildMember,
    GuildResolvable,
    PermissionResolvable,
    RoleResolvable,
    User,
    UserResolvable
} from "discord.js";
import type { ModuleTestResult } from "@/abstracts/AbstractModule.js";
import type { CommandModuleHookContext, CommandModuleType } from "@/abstracts/index.js";
import type { StaffGlobals } from "@/client/globals.js";

import { PermissionFlagsBits, PermissionsBitField } from "discord.js";

export enum MissingPermissionReason {
    User = "User",
    UserNotWhitelisted = "UserNotWhitelisted",
    UserBlacklisted = "UserBlacklisted",

    Role = "Role",
    RoleBlacklisted = "RoleBlacklisted",

    Client = "Client",
    IsBot = "IsBot",

    GuildBlacklisted = "GuildBlacklisted",
    GuildNotWhitelisted = "GuildNotWhitelisted",
    NotInGuild = "NotInGuild",

    NotGuildOwner = "NotGuildOwner",
    NotBotOwner = "NotBotOwner",
    NotBotStaff = "NotBotStaff"
}

export interface CommandModulePermissions {
    /** Guild permissions that grant access to this command.
     * @remarks If this is a slash command, use the builder's `setDefaultMemberPermissions` option instead. */
    user?: PermissionResolvable[];
    /** Users granted access to this command. */
    userWhitelist?: UserResolvable[];
    /** Don't allow these users to use this command. */
    userBlacklist?: UserResolvable[];

    /** Roles that grant access to this command. */
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

    /** Grant access to the owner of the guild. */
    guildOwnerOnly?: boolean;
    /** Grant access to the bot owner. */
    botOwnerOnly?: boolean;
    /** Grant access to bot staff, including the bot owner. */
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

type CommandMember = GuildMember | APIInteractionGuildMember | null;

function resolveUserId(user: UserResolvable): string {
    if (typeof user === "string") return user;
    if ("author" in user) return user.author.id;
    return user.id;
}

function resolveRoleId(role: RoleResolvable): string {
    return typeof role === "string" ? role : role.id;
}

function resolveGuildId(guild: GuildResolvable): string | null {
    if (typeof guild === "string") return guild;
    if ("guild" in guild) return guild.guild?.id ?? null;
    return guild.id;
}

function getMemberRoleIds(member: CommandMember): string[] {
    if (!member) return [];
    return Array.isArray(member.roles) ? member.roles : member.roles.cache.map(role => role.id);
}

async function isCommandBypasser<K extends CommandModuleType>(
    ctx: CommandModuleHookContext<K>,
    staff: StaffGlobals,
    commandName: string,
    userId: string
): Promise<boolean> {
    const normalizedCommandName = commandName.trim().toLowerCase();
    const matchingEntries = staff.bypassers.filter(
        entry => entry.commandName.trim().toLowerCase() === normalizedCommandName
    );
    if (!matchingEntries.length) return false;
    if (matchingEntries.some(entry => entry.userIds?.includes(userId))) return true;

    const roleIds = matchingEntries.flatMap(entry => entry.roleIds ?? []);
    if (!roleIds.length) return false;

    // Resolved against the configured staff guild, not the invoking guild, so a bypasser role
    // grants access regardless of which server the command was used in.
    const staffGuildRoleIds = await ctx.client.getStaffGuildRoleIds(userId);
    return roleIds.some(id => staffGuildRoleIds.includes(id));
}

function requiresAdministrator(requiredPermissions: PermissionResolvable[] | undefined): boolean {
    return Boolean(
        requiredPermissions?.some(
            permission =>
                (PermissionsBitField.resolve(permission) & PermissionFlagsBits.Administrator) ===
                PermissionFlagsBits.Administrator
        )
    );
}

function canBypassAdministrator(staff: StaffGlobals, userId: string, isBotStaff: boolean, isBypasser: boolean): boolean {
    const bypasses = staff.bypassesGuildAdmin;
    if (bypasses.allBotStaff && isBotStaff) return true;
    if (bypasses.botOwner && staff.ownerId === userId) return true;
    if (bypasses.superUsers && staff.superUsers.includes(userId)) return true;
    return bypasses.bypassers && isBypasser;
}

export async function testCommandPermissions<K extends CommandModuleType>(
    ctx: CommandModuleHookContext<K>,
    permissions: CommandModulePermissions
): Promise<PermissionTestResult> {
    const source = "message" in ctx ? ctx.message : ctx.interaction;
    const guild = source.guild;
    const member = source.member as CommandMember;
    const user = "author" in source ? source.author : source.user;
    const staff = ctx.client.globals.staff;

    // --- Hard restrictions ---
    let result = testGuildContext(
        guild,
        permissions.guildOnly ?? false,
        permissions.guildWhitelist,
        permissions.guildBlacklist
    );
    if (!result.passed) return result;

    result = testBotPresence(user, permissions.allowBots ?? false);
    if (!result.passed) return result;

    result = testUserBlacklist(user.id, permissions.userBlacklist);
    if (!result.passed) return result;

    result = testRoles(member, undefined, permissions.roleBlacklist);
    if (!result.passed) return result;

    result = testClientPermissions(guild, permissions.client);
    if (!result.passed) return result;

    // --- Additive access grants ---
    const isBypasser = await isCommandBypasser(ctx, staff, ctx.module.name, user.id);
    const administratorRequired = requiresAdministrator(permissions.user);
    const needsBotStaff =
        Boolean(permissions.botStaffOnly) || (administratorRequired && staff.bypassesGuildAdmin.allBotStaff);
    const isBotStaff = needsBotStaff ? await ctx.client.isBotStaff(user.id) : false;
    const bypassAdministrator = administratorRequired && canBypassAdministrator(staff, user.id, isBotStaff, isBypasser);
    const accessTests: PermissionTestResult[] = [];

    if (permissions.user?.length) {
        accessTests.push(testUserPermissions(member, permissions.user, bypassAdministrator));
    }

    if (permissions.userWhitelist?.length) {
        accessTests.push(testUserWhitelist(user.id, permissions.userWhitelist));
    }

    if (permissions.roles?.length) {
        accessTests.push(testRoles(member, permissions.roles));
    }

    if (permissions.guildOwnerOnly) {
        accessTests.push(testGuildOwnership(guild, user.id, true));
    }

    if (permissions.botOwnerOnly) {
        accessTests.push(testBotOwnership(staff.ownerId, user.id, true));
    }

    if (permissions.botStaffOnly) {
        accessTests.push(testBotStaff(staff, user.id, member, true, isBotStaff));
    }

    if (isBypasser) {
        accessTests.push({ passed: true });
    }

    if (!accessTests.length || accessTests.some(test => test.passed)) {
        return { passed: true };
    }

    return accessTests[0] ?? { passed: true };
}

export function testUserPermissions(
    member: CommandMember,
    requiredPermissions: PermissionResolvable[] | undefined,
    bypassAdministrator: boolean = false
): PermissionTestResult {
    if (!requiredPermissions?.length) return { passed: true };
    if (!member) return { passed: false, reason: MissingPermissionReason.NotInGuild };

    const memberPermissions = new PermissionsBitField(
        typeof member.permissions === "string" ? BigInt(member.permissions) : member.permissions
    );
    // Administrator bypasses remove only that bit; every other permission in the grant must still be present.
    const effectiveRequiredPermissions = bypassAdministrator
        ? requiredPermissions
              .map(permission => PermissionsBitField.resolve(permission) & ~PermissionFlagsBits.Administrator)
              .filter(permission => permission !== 0n)
        : requiredPermissions;
    const missing = effectiveRequiredPermissions.filter(permission => !memberPermissions.has(permission));
    if (missing.length) {
        return { passed: false, reason: MissingPermissionReason.User, missingUserPermissions: missing };
    }

    return { passed: true };
}

export function testUserWhitelist(userId: string, userWhitelist: UserResolvable[] | undefined): PermissionTestResult {
    if (!userWhitelist?.length) {
        return { passed: true };
    }

    const whitelistedIds = userWhitelist.map(resolveUserId);
    if (!whitelistedIds.includes(userId)) {
        return { passed: false, reason: MissingPermissionReason.UserNotWhitelisted };
    }

    return { passed: true };
}

export function testUserBlacklist(userId: string, userBlacklist: UserResolvable[] | undefined): PermissionTestResult {
    if (!userBlacklist?.length) {
        return { passed: true };
    }

    const blacklistedIds = userBlacklist.map(resolveUserId);
    if (blacklistedIds.includes(userId)) {
        return { passed: false, reason: MissingPermissionReason.UserBlacklisted };
    }

    return { passed: true };
}

export function testRoles(
    member: CommandMember,
    allowedRoles: RoleResolvable[] | undefined,
    blockedRoles: RoleResolvable[] | undefined = undefined
): PermissionTestResult {
    const allowedIds = allowedRoles?.map(resolveRoleId) ?? [];
    const blockedIds = blockedRoles?.map(resolveRoleId) ?? [];
    const memberRoleIds = getMemberRoleIds(member);

    if (blockedIds.some(id => memberRoleIds.includes(id))) {
        return { passed: false, reason: MissingPermissionReason.RoleBlacklisted };
    }

    if (allowedIds.length) {
        const hasAllowed = allowedIds.some(id => memberRoleIds.includes(id));
        if (!hasAllowed) {
            return { passed: false, reason: MissingPermissionReason.Role, missingRoles: allowedRoles };
        }
    }

    return { passed: true };
}

export function testClientPermissions(
    guild: Guild | null,
    requiredPermissions: PermissionResolvable[] | undefined
): PermissionTestResult {
    if (!requiredPermissions?.length || !guild) return { passed: true };

    const clientMember = guild.members.me;
    if (!clientMember) {
        return {
            passed: false,
            reason: MissingPermissionReason.Client,
            missingClientPermissions: requiredPermissions
        };
    }

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
        const blacklistIds = guildBlacklist.map(resolveGuildId);
        if (blacklistIds.includes(guild.id)) {
            return { passed: false, reason: MissingPermissionReason.GuildBlacklisted };
        }
    }

    if (guildWhitelist?.length && !guild) {
        return { passed: false, reason: MissingPermissionReason.NotInGuild };
    }

    if (guildWhitelist?.length && guild) {
        const whitelistIds = guildWhitelist.map(resolveGuildId);
        if (!whitelistIds.includes(guild.id)) {
            return { passed: false, reason: MissingPermissionReason.GuildNotWhitelisted };
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
    if (!guildOwnerOnly) return { passed: true };
    if (!guild) return { passed: false, reason: MissingPermissionReason.NotInGuild };

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
    member: CommandMember,
    botStaffOnly: boolean,
    resolvedBotStaff?: boolean
): PermissionTestResult {
    if (!botStaffOnly) {
        return { passed: true };
    }

    // A resolved result comes from the configured staff guild and is authoritative over the invoking guild member.
    if (resolvedBotStaff !== undefined) {
        return resolvedBotStaff ? { passed: true } : { passed: false, reason: MissingPermissionReason.NotBotStaff };
    }

    if (staff.ownerId === userId || staff.superUsers.includes(userId)) {
        return { passed: true };
    }

    const memberRoleIds = getMemberRoleIds(member);
    const hasStaffRole = staff.superUserRoles.some(id => memberRoleIds.includes(id));
    if (hasStaffRole) {
        return { passed: true };
    }

    return { passed: false, reason: MissingPermissionReason.NotBotStaff };
}
