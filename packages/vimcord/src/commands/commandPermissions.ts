import type {
    APIInteractionGuildMember,
    GuildMember,
    Message,
    PermissionResolvable,
    RoleResolvable,
    UserResolvable
} from "discord.js";
import type { ModuleTestResult } from "@/abstracts/AbstractModule.js";
import type { CommandModuleHookContext, CommandModuleType } from "@/abstracts/index.js";
import type { StaffGlobals } from "@/client/globals.js";

import { PermissionFlagsBits, PermissionsBitField } from "discord.js";

export enum MissingPermissionReason {
    User = "User",
    UserNotAllowed = "UserNotAllowed",

    Role = "Role",

    Client = "Client",
    IsBot = "IsBot",

    NotInGuild = "NotInGuild",

    NotGuildOwner = "NotGuildOwner",
    NotBotOwner = "NotBotOwner",
    NotBotStaff = "NotBotStaff"
}

/** Who may use a command. Meeting any one grants access; an empty or omitted object lets everyone through. */
export interface CommandAccess {
    /** User permissions in the invoking channel.
     * @remarks If this is a slash command, use the builder's `setDefaultMemberPermissions` option instead.
     */
    permissions?: PermissionResolvable[];
    /** Specific users. */
    users?: UserResolvable[];
    /** Holders of these roles. */
    roles?: RoleResolvable[];
    /** The owner of the invoking guild. */
    guildOwner?: boolean;
    /** The bot owner. */
    botOwner?: boolean;
    /** Configured bot staff. */
    staff?: boolean;
}

/** Restrictions on who can run a command or subcommand. Everything except `access` must pass. */
export interface CommandRestrictions {
    /** Only allow this command inside a guild.
     * @remarks For slash commands, use the builder's `setContexts()` option instead.
     */
    guildOnly?: boolean;
    /** Permissions the bot must have in the invoking channel. Checked in guilds. */
    botPermissions?: PermissionResolvable[];
    /** Allow other bots to use this command. */
    allowBots?: boolean;
    /** Who may use this command. */
    access?: CommandAccess;
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

function testRoles(member: CommandMember, requiredRoles: RoleResolvable[] | undefined): PermissionTestResult {
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

function hasConfiguredGrants(access: CommandAccess): boolean {
    return Boolean(
        access.permissions?.length ||
        access.users?.length ||
        access.roles?.length ||
        access.guildOwner ||
        access.botOwner ||
        access.staff
    );
}

/**
 * Returns the restrictions a command or subcommand actually sets, or `undefined` when it sets none.
 * `allowBots` isn't one: it only matters for bots, which skip the fast path on their own.
 * @param options The command or subcommand options
 */
export function pickRestrictions(options: CommandRestrictions): CommandRestrictions | undefined {
    const { guildOnly, botPermissions, access } = options;
    if (!guildOnly && !botPermissions?.length && !access) return undefined;
    return { guildOnly, botPermissions, access };
}

/**
 * Tests hard restrictions before checking whether any configured access grant applies.
 * `guildOnly`, `botPermissions`, and the bot check all must pass; any one `access` entry grants access.
 *
 * @param ctx The command invocation.
 * @param restrictions The command's restrictions.
 * @param allowBots Whether bots may run this; defaults to `restrictions.allowBots`.
 */
export function testCommandPermissions<K extends CommandModuleType>(
    ctx: CommandModuleHookContext<K>,
    restrictions: CommandRestrictions,
    allowBots = restrictions.allowBots
): PermissionTestResult | Promise<PermissionTestResult> {
    const source = resolveCommandSource(ctx);
    const isMessage = "author" in source;
    const user = isMessage ? source.author : source.user;
    const guildId = source.guildId;
    const member = source.member as CommandMember;
    const staff = ctx.client.globals.staff;
    const access = restrictions.access ?? {};

    // --- Hard restrictions ---
    if (!guildId && restrictions.guildOnly) return { passed: false, reason: MissingPermissionReason.NotInGuild };
    if (!allowBots && user.bot) return { passed: false, reason: MissingPermissionReason.IsBot };

    let result: PermissionTestResult;
    if (guildId && restrictions.botPermissions?.length) {
        const clientPermissions = isMessage
            ? getPrefixChannelPermissions(source, source.guild?.members.me ?? null)
            : source.appPermissions;
        result = testClientPermissions(clientPermissions, restrictions.botPermissions);
        if (!result.passed) return result;
    }

    if (!hasConfiguredGrants(access)) return { passed: true };

    // --- Cheap access grants ---
    const userPermissions = access.permissions?.length
        ? isMessage
            ? getPrefixChannelPermissions(source, member as GuildMember | null)
            : source.memberPermissions
        : null;
    const userPermissionResult = testUserPermissions(userPermissions, access.permissions);
    if (userPermissionResult.passed && access.permissions?.length) return userPermissionResult;

    let firstFailure: FailedPermissionTest | undefined;
    if (!userPermissionResult.passed) firstFailure = userPermissionResult;

    if (access.users?.length) {
        result = testUsers(user.id, access.users);
        if (result.passed) return result;
        firstFailure ??= result;
    }

    if (access.roles?.length) {
        result = testRoles(member, access.roles);
        if (result.passed) return result;
        firstFailure ??= result;
    }

    const staffBypassEntries = getBypassesStaff(staff, ctx.module.name);
    const isStaffBypasserById = staffBypassEntries.some(entry => entry.userIds?.includes(user.id));
    const isKnownBotStaff = staff.ownerId === user.id || staff.superUsers.includes(user.id);
    const cachedGuild = source.guild;

    if (access.guildOwner && !guildId) {
        firstFailure ??= { passed: false, reason: MissingPermissionReason.NotInGuild };
    }

    if (access.guildOwner && cachedGuild) {
        if (cachedGuild.ownerId === user.id) return { passed: true };
        firstFailure ??= { passed: false, reason: MissingPermissionReason.NotGuildOwner };
    }

    const botOwnerFailed = Boolean(access.botOwner && staff.ownerId !== user.id);
    if (access.botOwner && !botOwnerFailed) return { passed: true };
    if (access.staff && (isKnownBotStaff || isStaffBypasserById)) return { passed: true };

    return testRemoteGrants();

    async function testRemoteGrants(): Promise<PermissionTestResult> {
        const administratorRequired = !userPermissionResult.passed && requiresAdministrator(access.permissions);
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
                result = testUserPermissions(userPermissions, access.permissions, true);
                if (result.passed) return result;
                firstFailure = result;
            }
        }

        if (access.guildOwner && guildId && !cachedGuild) {
            const guild = await ctx.client.fetchGuild(guildId);
            if (guild?.ownerId === user.id) return { passed: true };
            firstFailure ??= { passed: false, reason: MissingPermissionReason.NotGuildOwner };
        }

        if (botOwnerFailed) {
            firstFailure ??= { passed: false, reason: MissingPermissionReason.NotBotOwner };
        }

        if (access.staff) {
            if (await getBotStaff()) return { passed: true };
            if (staffBypassEntries.length && (await hasStaffBypassRole(staffBypassEntries, getStaffRoleIds))) {
                return { passed: true };
            }
            firstFailure ??= { passed: false, reason: MissingPermissionReason.NotBotStaff };
        }

        return firstFailure ?? { passed: true };
    }
}
