import type {
    APIInteractionGuildMember,
    GuildMember,
    GuildResolvable,
    Message,
    PermissionResolvable,
    RoleResolvable,
    User,
    UserResolvable
} from "discord.js";
import type { ModuleTestResult } from "@/abstracts/AbstractModule.js";
import type { CommandModuleHookContext, CommandModuleType } from "@/abstracts/index.js";
import type { StaffGlobals } from "@/client/globals.js";

import { PermissionFlagsBits, PermissionsBitField } from "discord.js";
import { resolveGuildId } from "@/utils/clientUtils.js";

export enum MissingPermissionReason {
    User = "User",
    UserNotAllowed = "UserNotAllowed",
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
    /** User permissions in the invoking channel that grant access to this command.
     * @remarks If this is a slash command, use the builder's `setDefaultMemberPermissions` option instead.
     * Other grants can also allow access. Hard restrictions always apply.
     */
    user?: PermissionResolvable[];
    /** Users granted access to this command. Other grants can also allow access. */
    users?: UserResolvable[];
    /** Don't allow these users to use this command. This restriction always applies. */
    userBlacklist?: UserResolvable[];

    /** Roles that grant access to this command. Other grants can also allow access. */
    roles?: RoleResolvable[];
    /** Don't allow these roles to use this command. This restriction always applies. */
    roleBlacklist?: RoleResolvable[];

    /** Permissions the client must have in the invoking channel. This restriction applies in guilds. */
    client?: PermissionResolvable[];
    /** Allow other bots to use this command. */
    allowBots?: boolean;

    /** Only allow these guilds to use this command. This restriction always applies. */
    guildWhitelist?: GuildResolvable[];
    /** Don't allow these guilds to use this command. This restriction always applies. */
    guildBlacklist?: GuildResolvable[];
    /** Only allow this command inside a guild.
     * @remarks For slash commands, use the builder's `setContexts()` option instead.
     */
    guildOnly?: boolean;

    /** Grant access to the owner of the invoking guild. Other grants can also allow access. */
    guildOwner?: boolean;
    /** Grant access to the bot owner. Other grants can also allow access. */
    botOwner?: boolean;
    /** Grant access to configured bot staff. Other grants can also allow access. */
    botStaff?: boolean;
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
type FailedPermissionTest = Extract<PermissionTestResult, { passed: false }>;

function resolveUserId(user: UserResolvable): string {
    if (typeof user === "string") return user;
    if ("author" in user) return user.author.id;
    return user.id;
}

function resolveRoleId(role: RoleResolvable): string {
    return typeof role === "string" ? role : role.id;
}

function hasRole(member: CommandMember, roleId: string): boolean {
    if (!member) return false;
    return Array.isArray(member.roles) ? member.roles.includes(roleId) : member.roles.cache.has(roleId);
}

function getPrefixChannelPermissions(message: Message, member: GuildMember | null): PermissionsBitField | null {
    if (!member || !("permissionsFor" in message.channel)) return null;
    return message.channel.permissionsFor(member);
}

function testGuildContext(
    guildId: string | null,
    guildOnly: boolean | undefined,
    guildWhitelist: GuildResolvable[] | undefined,
    guildBlacklist: GuildResolvable[] | undefined
): PermissionTestResult {
    if (guildOnly && !guildId) return { passed: false, reason: MissingPermissionReason.NotInGuild };

    if (guildId && guildBlacklist?.some(guild => resolveGuildId(guild) === guildId)) {
        return { passed: false, reason: MissingPermissionReason.GuildBlacklisted };
    }

    if (guildWhitelist?.length && !guildId) return { passed: false, reason: MissingPermissionReason.NotInGuild };

    if (guildId && guildWhitelist?.length && !guildWhitelist.some(guild => resolveGuildId(guild) === guildId)) {
        return { passed: false, reason: MissingPermissionReason.GuildNotWhitelisted };
    }

    return { passed: true };
}

function testBotPresence(user: User, allowBots: boolean | undefined): PermissionTestResult {
    return !allowBots && user.bot ? { passed: false, reason: MissingPermissionReason.IsBot } : { passed: true };
}

function testUserBlacklist(userId: string, users: UserResolvable[] | undefined): PermissionTestResult {
    if (users?.some(user => resolveUserId(user) === userId)) {
        return { passed: false, reason: MissingPermissionReason.UserBlacklisted };
    }

    return { passed: true };
}

function testRoles(
    member: CommandMember,
    requiredRoles: RoleResolvable[] | undefined,
    blockedRoles?: RoleResolvable[]
): PermissionTestResult {
    if (blockedRoles?.some(role => hasRole(member, resolveRoleId(role)))) {
        return { passed: false, reason: MissingPermissionReason.RoleBlacklisted };
    }

    if (!requiredRoles?.length) return { passed: true };
    if (!requiredRoles.some(role => hasRole(member, resolveRoleId(role)))) {
        return { passed: false, reason: MissingPermissionReason.Role, missingRoles: requiredRoles };
    }

    return { passed: true };
}

function testUserPermissions(
    permissions: PermissionsBitField | null,
    requiredPermissions: PermissionResolvable[] | undefined,
    bypassAdministrator = false
): PermissionTestResult {
    if (!requiredPermissions?.length) return { passed: true };
    if (!permissions) return { passed: false, reason: MissingPermissionReason.NotInGuild };

    const effectivePermissions = bypassAdministrator
        ? requiredPermissions
              .map(permission => PermissionsBitField.resolve(permission) & ~PermissionFlagsBits.Administrator)
              .filter(permission => permission !== 0n)
        : requiredPermissions;
    const missing = effectivePermissions.filter(permission => !permissions.has(permission));
    return missing.length
        ? { passed: false, reason: MissingPermissionReason.User, missingUserPermissions: missing }
        : { passed: true };
}

function testUsers(userId: string, users: UserResolvable[] | undefined): PermissionTestResult {
    if (!users?.some(user => resolveUserId(user) === userId)) {
        return { passed: false, reason: MissingPermissionReason.UserNotAllowed };
    }

    return { passed: true };
}

function testClientPermissions(
    permissions: PermissionsBitField | null,
    requiredPermissions: PermissionResolvable[] | undefined
): PermissionTestResult {
    if (!requiredPermissions?.length) return { passed: true };
    if (!permissions) {
        return { passed: false, reason: MissingPermissionReason.Client, missingClientPermissions: requiredPermissions };
    }

    const missing = requiredPermissions.filter(permission => !permissions.has(permission));
    return missing.length
        ? { passed: false, reason: MissingPermissionReason.Client, missingClientPermissions: missing }
        : { passed: true };
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

function getBypassesStaff(staff: StaffGlobals, commandName: string) {
    const normalizedCommandName = commandName.trim().toLowerCase();
    return staff.bypassesStaff.filter(entry => entry.commandName.trim().toLowerCase() === normalizedCommandName);
}

async function hasStaffBypassRole(
    entries: StaffGlobals["bypassesStaff"],
    getStaffRoleIds: () => Promise<string[]>
): Promise<boolean> {
    if (!entries.some(entry => entry.roleIds?.length)) return false;

    const roleIds = await getStaffRoleIds();
    return entries.some(entry => entry.roleIds?.some(id => roleIds.includes(id)));
}

function resolveCommandSource<K extends CommandModuleType>(ctx: CommandModuleHookContext<K>) {
    return "message" in ctx ? ctx.message : ctx.interaction;
}

/** Returns the user who invoked the command, whether it came in as a message or an interaction. */
export function resolveInvokingUser<K extends CommandModuleType>(ctx: CommandModuleHookContext<K>): User {
    const source = resolveCommandSource(ctx);
    return "author" in source ? source.author : source.user;
}

function hasConfiguredGrants(permissions: CommandModulePermissions): boolean {
    return Boolean(
        permissions.user?.length ||
        permissions.users?.length ||
        permissions.roles?.length ||
        permissions.guildOwner ||
        permissions.botOwner ||
        permissions.botStaff
    );
}

/**
 * Tests hard command restrictions before checking whether any configured access grant applies.
 * Hard restrictions use AND. User permissions, users, roles, guild owner, bot owner, and bot staff use OR.
 *
 * @param ctx The command invocation.
 * @param permissions The command permission settings.
 */
export async function testCommandPermissions<K extends CommandModuleType>(
    ctx: CommandModuleHookContext<K>,
    permissions: CommandModulePermissions
): Promise<PermissionTestResult> {
    const source = resolveCommandSource(ctx);
    const isMessage = "author" in source;
    const user = isMessage ? source.author : source.user;
    const guildId = source.guildId;
    const member = source.member as CommandMember;
    const staff = ctx.client.globals.staff;

    // --- Hard restrictions ---
    let result = testGuildContext(guildId, permissions.guildOnly, permissions.guildWhitelist, permissions.guildBlacklist);
    if (!result.passed) return result;

    result = testBotPresence(user, permissions.allowBots);
    if (!result.passed) return result;

    result = testUserBlacklist(user.id, permissions.userBlacklist);
    if (!result.passed) return result;

    result = testRoles(member, undefined, permissions.roleBlacklist);
    if (!result.passed) return result;

    if (guildId && permissions.client?.length) {
        const clientPermissions = isMessage
            ? getPrefixChannelPermissions(source, source.guild?.members.me ?? null)
            : source.appPermissions;
        result = testClientPermissions(clientPermissions, permissions.client);
        if (!result.passed) return result;
    }

    if (!hasConfiguredGrants(permissions)) return { passed: true };

    // --- Cheap access grants ---
    const userPermissions = permissions.user?.length
        ? isMessage
            ? getPrefixChannelPermissions(source, member as GuildMember | null)
            : source.memberPermissions
        : null;
    const userPermissionResult = testUserPermissions(userPermissions, permissions.user);
    if (userPermissionResult.passed && permissions.user?.length) return userPermissionResult;

    let firstFailure: FailedPermissionTest | undefined;
    if (!userPermissionResult.passed) firstFailure = userPermissionResult;

    if (permissions.users?.length) {
        result = testUsers(user.id, permissions.users);
        if (result.passed) return result;
        firstFailure ??= result;
    }

    if (permissions.roles?.length) {
        result = testRoles(member, permissions.roles);
        if (result.passed) return result;
        firstFailure ??= result;
    }

    const staffBypassEntries = getBypassesStaff(staff, ctx.module.name);
    const isStaffBypasserById = staffBypassEntries.some(entry => entry.userIds?.includes(user.id));
    const isKnownBotStaff = staff.ownerId === user.id || staff.superUsers.includes(user.id);
    const cachedGuild = source.guild;

    if (permissions.guildOwner && !guildId) {
        firstFailure ??= { passed: false, reason: MissingPermissionReason.NotInGuild };
    }

    if (permissions.guildOwner && cachedGuild) {
        if (cachedGuild.ownerId === user.id) return { passed: true };
        firstFailure ??= { passed: false, reason: MissingPermissionReason.NotGuildOwner };
    }

    const botOwnerFailed = Boolean(permissions.botOwner && staff.ownerId !== user.id);
    if (permissions.botOwner && !botOwnerFailed) return { passed: true };
    if (permissions.botStaff && (isKnownBotStaff || isStaffBypasserById)) return { passed: true };

    const administratorRequired = !userPermissionResult.passed && requiresAdministrator(permissions.user);
    let staffRoleIds: Promise<string[]> | undefined;
    const getStaffRoleIds = () => (staffRoleIds ??= ctx.client.getStaffGuildRoleIds(user.id));
    const getBotStaff = async () => {
        if (isKnownBotStaff) return true;
        if (!staff.superUserRoles.length) return false;

        const roleIds = await getStaffRoleIds();
        return staff.superUserRoles.some(id => roleIds.includes(id));
    };

    if (administratorRequired) {
        const bypasses = staff.bypassesGuildAdmin;
        let bypassAdministrator =
            (bypasses.botOwner && staff.ownerId === user.id) ||
            (bypasses.superUsers && staff.superUsers.includes(user.id)) ||
            (bypasses.allBotStaff && isKnownBotStaff) ||
            (bypasses.bypassers && isStaffBypasserById);
        if (!bypassAdministrator && bypasses.allBotStaff) bypassAdministrator = await getBotStaff();
        if (!bypassAdministrator && bypasses.bypassers && staffBypassEntries.length) {
            bypassAdministrator = isStaffBypasserById || (await hasStaffBypassRole(staffBypassEntries, getStaffRoleIds));
        }
        if (bypassAdministrator) {
            result = testUserPermissions(userPermissions, permissions.user, true);
            if (result.passed) return result;
            firstFailure = result;
        }
    }

    if (permissions.guildOwner && guildId && !cachedGuild) {
        const guild = await ctx.client.fetchGuild(guildId);
        if (guild?.ownerId === user.id) return { passed: true };
        firstFailure ??= { passed: false, reason: MissingPermissionReason.NotGuildOwner };
    }

    if (botOwnerFailed) {
        firstFailure ??= { passed: false, reason: MissingPermissionReason.NotBotOwner };
    }

    if (permissions.botStaff) {
        if (await getBotStaff()) return { passed: true };
        if (staffBypassEntries.length && (await hasStaffBypassRole(staffBypassEntries, getStaffRoleIds))) {
            return { passed: true };
        }
        firstFailure ??= { passed: false, reason: MissingPermissionReason.NotBotStaff };
    }

    return firstFailure ?? { passed: true };
}
