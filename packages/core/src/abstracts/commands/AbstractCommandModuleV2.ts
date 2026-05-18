import type { ModuleHooks, ModuleOptions } from "../AbstractModule.js";
import type { CommandHookContext, CommandModuleArgs, CommandModuleType } from "./CommandModuleTypeKit.js";

export interface CommandModuleOptions<T extends CommandModuleType> extends ModuleOptions<
    CommandModuleArgs<T>,
    unknown,
    CommandHookContext<T>,
    CommandModuleHooks<T>
> {
    metadata?: CommandModuleMetadata;
    /** The permissions of the module. */
    permissions?: CommandModulePermissions;
    hooks?: CommandModuleHooks<T>;
}

export interface CommandModuleHooks<K extends CommandModuleType = CommandModuleType> extends ModuleHooks<
    CommandModuleArgs<K>,
    unknown,
    CommandHookContext<K>
> {
    /** @defaultBehavior Alias for `onError`. */
    onUsedWhenDisabled?(ctx: CommandModuleHookContext<K>): Promise<void>;
    /** @defaultBehavior Alias for `onError`. */
    onPermissionTestFail?(ctx: CommandModuleHookContext<K>): Promise<void>;
}

export abstract class AbstractCommandModuleV2<T extends CommandModuleType = CommandModuleType> {}
