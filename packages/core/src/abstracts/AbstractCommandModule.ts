import type { ChatInputCommandInteraction, ContextMenuCommandInteraction, GuildResolvable, Message } from "discord.js";
import type {
    ModuleHookContext,
    ModuleHookContext,
    ModuleHooks,
    ModuleMetadata,
    ModuleOptions
} from "@/abstracts/AbstractModule.js";
import type { CommandModulePermissions, PermissionTestResult } from "@/commands/commandPermissions.js";

import { AbstractModule } from "@/abstracts/AbstractModule.js";
import { testCommandPermissions } from "@/commands/commandPermissions.js";
import { ModuleError } from "@/errors/ModuleError.js";

export type CommandModuleParameters<K extends CommandModuleType = CommandModuleType> = K extends CommandModuleType.Prefix
    ? { message: Message }
    : K extends CommandModuleType.Slash
      ? { interaction: ChatInputCommandInteraction }
      : { interaction: ContextMenuCommandInteraction };

export type CommandModuleArguments<K extends CommandModuleType = CommandModuleType> = K extends CommandModuleType.Prefix
    ? [message: Message]
    : K extends CommandModuleType.Slash
      ? [interaction: ChatInputCommandInteraction]
      : [interaction: ContextMenuCommandInteraction];

export interface CommandModuleOptions<K extends CommandModuleType> extends ModuleOptions<
    CommandModuleArguments<K>,
    unknown,
    CommandModuleHookContext<K>,
    CommandModuleHooks<K>
> {
    metadata?: CommandModuleMetadata;
    /** The permissions of the module. */
    permissions?: CommandModulePermissions;
    hooks?: CommandModuleHooks<K>;
}

export interface AppCommandModuleOptions<K extends CommandModuleType> extends CommandModuleOptions<K> {
    registration?: AppCommandRegistrationRules;
}

export interface AppCommandRegistrationRules {
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

export type CommandModuleHookContext<K extends CommandModuleType = CommandModuleType> = ModuleHookContext<
    CommandModuleArguments<K>,
    unknown
> &
    CommandModuleParameters<K> & {
        permissionTestResult?: PermissionTestResult;
    };

export interface CommandModuleHooks<K extends CommandModuleType = CommandModuleType> extends ModuleHooks<
    CommandModuleArguments<K>,
    unknown,
    CommandModuleHookContext<K>
> {
    /** @defaultBehavior Alias for `onError`. */
    onUsedWhenDisabled?(ctx: CommandModuleHookContext<K>): Promise<void>;
    /** @defaultBehavior Alias for `onError`. */
    onPermissionTestFail?(ctx: CommandModuleHookContext<K>): Promise<void>;
}

export type CommandModuleExecuteContext<K extends CommandModuleType = CommandModuleType> = ModuleHookContext<
    CommandModuleArguments<K>
> &
    CommandModuleParameters<K>;

export abstract class AbstractCommandModule<K extends CommandModuleType = CommandModuleType> extends AbstractModule<
    CommandModuleArguments<K>,
    unknown,
    CommandModuleHookContext<K>,
    CommandModuleHooks<K>
> {
    abstract readonly type: K;
    protected readonly permissions: CommandModulePermissions;
    override readonly hooks: CommandModuleHooks<K>;

    constructor(options: CommandModuleOptions<K>) {
        super(options);

        this.permissions = options.permissions ?? {};
        this.hooks = options.hooks ?? {};
    }

    protected override createModuleCTX(args: CommandModuleArguments<K>): CommandModuleHookContext<K> {
        const ctx = super.createModuleCTX(args);
        const source = args[0];

        if (this.type === CommandModuleType.Prefix) {
            return { ...ctx, message: source as Message } as unknown as CommandModuleHookContext<K>;
        }

        return {
            ...ctx,
            interaction: source as ChatInputCommandInteraction | ContextMenuCommandInteraction
        } as unknown as CommandModuleHookContext<K>;
    }

    // --- Tests & Rules ---
    protected async testPermissions(ctx: CommandModuleHookContext<K>): Promise<PermissionTestResult> {
        return testCommandPermissions(ctx, this.permissions);
    }

    protected override async performTests(ctx: CommandModuleHookContext<K>): Promise<boolean> {
        if (!this.enabled) {
            await this.runHook("onUsedWhenDisabled", ctx, () => this.runHook("onError", ctx));
            return false;
        }

        // testDeployment -> testConditions
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
