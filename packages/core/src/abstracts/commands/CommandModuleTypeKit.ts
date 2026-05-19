import type { ChatInputCommandInteraction, ContextMenuCommandInteraction, GuildResolvable, Message } from "discord.js";
import type { CommandModulePermissions, PermissionTestResult } from "@/commands/commandPermissions.js";
import type { ModuleContext, ModuleHookContext, ModuleHooks, ModuleMetadata, ModuleOptions } from "../AbstractModule.js";

export enum CommandModuleType {
    Prefix = "Prefix",
    Slash = "Slash",
    Context = "Context"
}

interface CommandTypeMap {
    [CommandModuleType.Prefix]: {
        args: [message: Message];
        params: { message: Message };
        contextExtras: {
            messageContent: string;
            splitContent: (options?: { separator?: string; lowercase?: boolean; uppercase?: boolean }) => string[];
            prefixUsed: string;
        };
        hookContextExtras: Record<never, never>;
        hookExtras: Record<never, never>;
    };
    [CommandModuleType.Slash]: {
        args: [interaction: ChatInputCommandInteraction];
        params: { interaction: ChatInputCommandInteraction };
        contextExtras: Record<never, never>;
        hookContextExtras: Record<never, never>;
        hookExtras: Record<never, never>;
    };
    [CommandModuleType.Context]: {
        args: [interaction: ContextMenuCommandInteraction];
        params: { interaction: ContextMenuCommandInteraction };
        contextExtras: Record<never, never>;
        hookContextExtras: Record<never, never>;
        hookExtras: Record<never, never>;
    };
}

export type CommandModuleParams<T extends CommandModuleType> = CommandTypeMap[T]["params"];
export type CommandModuleArgs<T extends CommandModuleType> = CommandTypeMap[T]["args"];

export type CommandModuleContext<T extends CommandModuleType> = ModuleContext<CommandModuleArgs<T>> &
    CommandTypeMap[T]["contextExtras"];
export type CommandModuleHookContext<T extends CommandModuleType> = ModuleHookContext<CommandModuleArgs<T>> & {
    permissionTestResult?: PermissionTestResult;
} & CommandTypeMap[T]["hookContextExtras"];

export type CommandModuleHooks<T extends CommandModuleType> = ModuleHooks<CommandModuleArgs<T>> & {
    /** @defaultBehavior Alias for `onError`. */
    onUsedWhenDisabled?(ctx: CommandModuleHookContext<T>): Promise<void>;
    /** @defaultBehavior Alias for `onError`. */
    onPermissionTestFail?(ctx: CommandModuleHookContext<T>): Promise<void>;
} & CommandTypeMap[T]["hookExtras"];

// --- Command Module Options ---
export type CommandModuleOptions<T extends CommandModuleType> = ModuleOptions<
    CommandModuleArgs<T>,
    CommandModuleContext<T>,
    CommandModuleHookContext<T>,
    CommandModuleHooks<T>
> & {
    metadata?: CommandModuleMetadata;
    /** The permissions of the module. */
    permissions?: CommandModulePermissions;
    hooks?: CommandModuleHooks<T>;
};

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

// --- App Command Module Types ---
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
