import {
    PermissionResolvable,
    SlashCommandBuilder,
    SlashCommandOptionsOnlyBuilder,
    SlashCommandSubcommandBuilder,
    SlashCommandSubcommandGroupBuilder,
    SlashCommandSubcommandsOnlyBuilder
} from "discord.js";
import { MissingPermissionReason, RateLimitScope } from "@ctypes/command.base";

export type AnySlashCommandBuilder =
    | SlashCommandBuilder
    | SlashCommandOptionsOnlyBuilder
    | SlashCommandSubcommandBuilder
    | SlashCommandSubcommandsOnlyBuilder
    | SlashCommandSubcommandGroupBuilder;

export interface CommandPermissions {
    /** Permissions the user is required to have to use this command
     * @remarks If this is a slash command, use the builder's `setDefaultMemberPermissions` option instead */
    user?: PermissionResolvable[];
    /** Permissions the bot is required to have to execute this command */
    bot?: PermissionResolvable[];
    /** Roles allowed to use this command by ID */
    roles?: string[];
    /** Only allow these users to use this command by ID */
    userWhitelist?: string[];
    /** Users blacklisted from using this command by ID */
    userBlacklist?: string[];
    /** Roles blacklisted from using this command by ID */
    roleBlacklist?: string[];
    /** Should this command only be usable in guilds?
     * @remarks If this is a slash command, use the builder's `setContexts` option instead */
    guildOnly?: boolean;
    /** Should only the guild owner be allowed to use this command? */
    guildOwnerOnly?: boolean;
    /** Should only the bot owner be allowed to use this command? */
    botOwnerOnly?: boolean;
    /** Should only the bot staff (including bot owner) be allowed to use this command? */
    botStaffOnly?: boolean;
}

export interface CommandMetadata {
    /** Command category for categorizing commands */
    category?: string;
    /** Command category emoji
     * @remarks I recommend mapping your own category emojis separately instead of using this
     */
    categoryEmoji?: string;
    /** Command tags for categorizing commands */
    tags?: string[];
    /** Command usage examples */
    examples?: string[];
    /** Command emoji */
    emoji?: string;
    /** Will this command show up in help commands? @defaultValue `false` */
    hidden?: boolean;
}

export interface AppCommandDeployment {
    /** Specific guild IDs to deploy to */
    guilds?: string[];
    /** Whether to deploy globally */
    global?: boolean;
    /** Deployment environments */
    environments?: ("development" | "production")[];
}

export interface CommandRateLimitOptions<OnRateLimitParams extends (...args: any) => any = (...args: any) => any> {
    /** Max executions per interval */
    max: number;
    /** Interval in milliseconds */
    interval: number;
    /** Rate limit scope */
    scope: RateLimitScope;
    /** What to do when rate limited */
    onRateLimit?: OnRateLimitParams;
}

export interface CommandPermissionResults {
    validated: boolean;
    failReason?: MissingPermissionReason;
    missingUserPermissions?: PermissionResolvable[];
    missingBotPermissions?: PermissionResolvable[];
    missingRoles?: string[];
    blacklistedUser?: string;
    blacklistedRole?: string;
}
