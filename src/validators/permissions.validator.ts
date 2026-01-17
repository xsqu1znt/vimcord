import { BaseInteraction, CommandInteraction, GuildMember, PermissionResolvable, User } from "discord.js";
import { CommandPermissionResults, CommandPermissions } from "@ctypes/command.options";
import { MissingPermissionReason } from "@ctypes/command.base";
import { type Vimcord } from "@/client";

function __existsAndTrue(value: boolean | undefined) {
    return value !== undefined && value;
}

export function validateCommandPermissions(
    permissions: CommandPermissions,
    client: Vimcord<true>,
    user: GuildMember | User,
    command: CommandInteraction | string
): CommandPermissionResults {
    const inGuild = "guild" in user;

    const missingUserPermissions: PermissionResolvable[] = [];
    const missingBotPermissions: PermissionResolvable[] = [];
    const missingRoles: string[] = [];

    if (permissions.user?.length && inGuild) {
        for (const permission of permissions.user) {
            if (!user.permissions.has(permission)) {
                missingUserPermissions.push(permission);
            }
        }

        if (missingUserPermissions.length) {
            return { validated: false, failReason: MissingPermissionReason.User, missingUserPermissions };
        }
    }

    if (permissions.bot?.length && inGuild && user.guild.members.me) {
        for (const permission of permissions.bot) {
            if (!user.guild.members.me!.permissions.has(permission)) {
                missingBotPermissions.push(permission);
            }
        }

        if (missingBotPermissions.length) {
            return { validated: false, failReason: MissingPermissionReason.Bot, missingBotPermissions };
        }
    }

    if (permissions.roles?.length && inGuild) {
        for (const role of permissions.roles) {
            if (!user.roles.cache.has(role)) {
                missingRoles.push(role);
            }
        }

        if (missingRoles.length) {
            return { validated: false, failReason: MissingPermissionReason.Role, missingRoles };
        }
    }

    if (permissions.userBlacklist?.length) {
        if (permissions.userBlacklist.includes(user.id)) {
            return { validated: false, failReason: MissingPermissionReason.UserBlacklisted, blacklistedUser: user.id };
        }
    }

    if (permissions.roleBlacklist?.length && inGuild) {
        if (user.roles.cache.some(role => permissions.roleBlacklist!.includes(role.id))) {
            return { validated: false, failReason: MissingPermissionReason.RoleBlacklisted, blacklistedRole: user.id };
        }
    }

    if (__existsAndTrue(permissions.guildOnly) && !inGuild) {
        return { validated: false, failReason: MissingPermissionReason.NotInGuild };
    }

    if (__existsAndTrue(permissions.guildOwnerOnly) && inGuild && user.id !== user.guild.ownerId) {
        return { validated: false, failReason: MissingPermissionReason.NotGuildOwner };
    }

    if (__existsAndTrue(permissions.botOwnerOnly) && user.id !== client.config.staff.ownerId) {
        return { validated: false, failReason: MissingPermissionReason.NotBotOwner };
    }

    if (__existsAndTrue(permissions.botStaffOnly)) {
        if (!client.config.staff.superUsers.includes(user.id)) {
            return { validated: false, failReason: MissingPermissionReason.NotBotStaff };
        }

        if (inGuild) {
            for (const [k, role] of user.roles.cache) {
                if (!user.roles.cache.has(role.id)) {
                    missingRoles.push(role.id);
                }
            }

            if (missingRoles.length) {
                return { validated: false, failReason: MissingPermissionReason.NotBotStaff, missingRoles };
            }
        }

        if (command instanceof BaseInteraction && command.isCommand()) {
            let commandName: string | null = null;

            if (command.isChatInputCommand()) {
                const subcommand = command.options.getSubcommand();
                commandName = `${command.commandName}${subcommand ? ` ${subcommand}` : ""}`;
            } else {
                commandName = command.commandName;
            }

            if (
                !client.config.staff.bypassers.some(
                    bypass =>
                        bypass.commandName.toLowerCase() === commandName.toLowerCase() && bypass.userIds.includes(user.id)
                )
            ) {
                return { validated: false, failReason: MissingPermissionReason.NotBotStaff };
            }
        }

        if (
            typeof command === "string" &&
            !client.config.staff.bypassers.some(
                bypass => bypass.commandName.toLowerCase() === command.toLowerCase() && bypass.userIds.includes(user.id)
            )
        ) {
            return { validated: false, failReason: MissingPermissionReason.NotBotStaff };
        }
    }

    return { validated: true };
}
