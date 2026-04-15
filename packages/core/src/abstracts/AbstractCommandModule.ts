import type {
    CommandInteraction,
    ContextMenuCommandInteraction,
    GuildMember,
    GuildResolvable,
    Message,
    PermissionResolvable,
    RoleResolvable,
    UserResolvable
} from "discord.js";
import type {
    ModuleContext,
    ModuleDeploymentRules,
    ModuleHooks,
    ModuleMetadata,
    ModuleOptions,
    ModuleTestResult
} from "@/abstracts/AbstractModule.js";
import type { Vimcord } from "@/client/Vimcord.js";

import { AbstractModule } from "@/abstracts/AbstractModule.js";
import { ModuleError } from "@/errors/ModuleError.js";
import {
    testBotPresence,
    testClientPermissions,
    testGuildContext,
    testGuildOwnership,
    testRoles,
    testUserBlacklist,
    testUserPermissions,
    testUserWhitelist
} from "./permissionTests.js";

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

export enum CommandModuleType {
    Prefix = "Prefix",
    Slash = "Slash",
    Context = "Context"
}

export interface CommandModuleParameters {
    Prefix: [client: Vimcord<true>, message: Message];
    Slash: [client: Vimcord<true>, interaction: CommandInteraction];
    Context: [client: Vimcord<true>, interaction: ContextMenuCommandInteraction];
}

export interface CommandModuleOptions<K extends CommandModuleType> extends ModuleOptions<
    CommandModuleParameters[K],
    Message | undefined
> {
    metadata?: CommandModuleMetadata;
    /** The permissions of the module. */
    permissions?: CommandModulePermissions;
    hooks?: CommandModuleHooks<K>;
}

export interface AppCommandModuleOptions<K extends CommandModuleType> extends CommandModuleOptions<K> {
    deployment?: AppCommandModuleDeploymentRules;
}

export interface AppCommandModuleDeploymentRules extends ModuleDeploymentRules {
    /** Only register this command to these guilds.
     * @remarks This only applies when registering locally.
     */
    guilds?: GuildResolvable[];
    /**
     * Allow registering globally.
     * @default true
     */
    global?: boolean;
}

export interface CommandModuleMetadata extends ModuleMetadata {
    /**
     * Command category emoji.
     * @remarks I recommend mapping your own category emojis separately instead of using this.
     */
    categoryEmoji?: string;
    /** Command emoji. */
    emoji?: string;
    /** Command usage examples. */
    examples?: string[];
    /**
     * Hide this command.
     * @default false
     */
    hidden?: boolean;
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

export interface CommandModuleContext<K extends CommandModuleType = CommandModuleType> extends ModuleContext<
    CommandModuleParameters[K],
    Message | undefined
> {
    permissionTestResult?: PermissionTestResult;
}

export interface CommandModuleHooks<K extends CommandModuleType = CommandModuleType> extends ModuleHooks<
    CommandModuleParameters[K],
    Message | undefined,
    CommandModuleContext<K>
> {
    /** @defaultBehavior Alias for `onError`. */
    onUsedWhenDisabled?(ctx: CommandModuleContext<K>): Promise<void>;
    /** @defaultBehavior Alias for `onError`. */
    onPermissionTestFail?(ctx: CommandModuleContext<K>): Promise<void>;
}

export abstract class AbstractCommandModule<K extends CommandModuleType> extends AbstractModule<
    CommandModuleParameters[K],
    Message | undefined,
    CommandModuleHooks<K>
> {
    abstract readonly type: K;
    protected readonly permissions: CommandModulePermissions;
    protected override readonly hooks: CommandModuleHooks<K>;

    constructor(options: CommandModuleOptions<K>) {
        super(options);

        this.permissions = options.permissions ?? {};
        this.hooks = options.hooks ?? {};
    }

    // --- Tests & Rules ---
    protected async testPermissions(ctx: CommandModuleContext<K>): Promise<PermissionTestResult> {
        const [, source] = ctx.args;
        const guild = source.guild;
        const member = source.member as GuildMember | null;
        const user = "author" in source ? source.author : source.user;

        let result = await testGuildContext(
            guild,
            this.permissions.guildOnly ?? false,
            this.permissions.guildWhitelist,
            this.permissions.guildBlacklist
        );
        if (!result.passed) return result;

        result = await testBotPresence(user, this.permissions.allowBots ?? false);
        if (!result.passed) return result;

        result = await testUserWhitelist(user.id, this.permissions.userWhitelist);
        if (!result.passed) return result;

        result = await testUserBlacklist(user.id, this.permissions.userBlacklist);
        if (!result.passed) return result;

        result = await testGuildOwnership(guild, user.id, this.permissions.guildOwnerOnly ?? false);
        if (!result.passed) return result;

        result = await testRoles(member, this.permissions.roles, this.permissions.roleBlacklist);
        if (!result.passed) return result;

        result = await testUserPermissions(member, this.permissions.user);
        if (!result.passed) return result;

        result = await testClientPermissions(guild, this.permissions.client);
        if (!result.passed) return result;

        // TODO: test bot owner/staff

        return { passed: true };
    }

    protected override async performTests(ctx: CommandModuleContext<K>): Promise<boolean> {
        if (!this.enabled) {
            await this.runHook("onUsedWhenDisabled", ctx, () => this.runHook("onError", ctx));
            return false;
        }

        const superPassed = await super.performTests(ctx);
        if (!superPassed) return false;

        const permissionTestResult = await this.testPermissions(ctx);
        if (!permissionTestResult.passed) {
            ctx.permissionTestResult = permissionTestResult;
            await this.runHook("onPermissionTestFail", ctx, async ctx => {
                if (!ctx.permissionTestResult?.passed) {
                    ctx.error ??= ctx.permissionTestResult?.error ?? new ModuleError(ctx.permissionTestResult!.reason);
                }
                await this.runHook("onError", ctx);
            });
            return false;
        }

        return true;
    }
}
