import type { PermissionResolvable } from "discord.js";

export enum CommandType {
    Slash = "Slash",
    Prefix = "Prefix",
    Context = "Context"
}

export enum MissingPermissionReason {
    User = "User",
    Bot = "Bot",
    Role = "Role",
    UserBlacklisted = "UserBlacklisted",
    RoleBlacklisted = "RoleBlacklisted",
    NotInGuild = "NotInGuild",
    NotGuildOwner = "NotGuildOwner",
    NotBotOwner = "NotBotOwner",
    NotBotStaff = "NotBotStaff"
}

export enum RateLimitScope {
    User = "User",
    Guild = "Guild",
    Channel = "Channel",
    Global = "Global"
}

export interface BaseCommandConfig {
    /**
     * Is this command enabled?
     * @default true
     */
    enabled?: boolean;
    /** Command permission requirements. */
    permissions?: CommandPermissions;
    /** Command metadata configuration. */
    metadata?: CommandMetadata;
    /**
     * Log whenever this command is executed?
     * @default true
     */
    logExecution?: boolean;
}

export interface CommandPermissions {
    /**
     * Permissions the user is required to have to use this command.
     * @remarks If this is a slash command, use the builder's `setDefaultMemberPermissions` option instead.
     */
    user?: PermissionResolvable[];
    /** Permissions the bot is required to have to execute this command. */
    bot?: PermissionResolvable[];
    /** Roles allowed to use this command by ID. */
    roles?: string[];
    /** Only allow these users to use this command by ID. */
    userWhitelist?: string[];
    /** Users blacklisted from using this command by ID. */
    userBlacklist?: string[];
    /** Roles blacklisted from using this command by ID. */
    roleBlacklist?: string[];
    /**
     * Should this command only be usable in guilds?
     * @remarks If this is a slash command, use the builder's `setContexts` option instead.
     */
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
    /**
     * Command category emoji.
     * @remarks I recommend mapping your own category emojis separately instead of using this.
     */
    categoryEmoji?: string;
    /** Command tags for categorizing commands */
    tags?: string[];
    /** Command usage examples */
    examples?: string[];
    /** Command emoji */
    emoji?: string;
    /** Will this command show up in help commands? @default `false` */
    hidden?: boolean;
}

export interface CommandRateLimitOptions<OnRateLimitParams = (...args: unknown[]) => unknown> {
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
