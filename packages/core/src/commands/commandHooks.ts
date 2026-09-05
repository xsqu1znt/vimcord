import type { CommandModuleHooks, CommandModuleType } from "@/abstracts/index.js";

import { mergeDeep } from "@/utils/obj.js";

export interface GlobalCommandHooks {
    /** Global hooks for prefix commands. */
    prefix?: CommandModuleHooks<CommandModuleType.Prefix>;
    /** Global hooks for slash commands. */
    slash?: CommandModuleHooks<CommandModuleType.Slash>;
    /** Global hooks for message and user context commands. */
    context?: CommandModuleHooks<CommandModuleType.MessageContext | CommandModuleType.UserContext>;
}

const GLOBAL_COMMAND_HOOKS: GlobalCommandHooks = {};

/**
 * Updates the global command hook configuration.
 * @param hooks Partial command hooks to merge into the global config
 */
export function defineGlobalCommandHooks(hooks: GlobalCommandHooks): void {
    mergeDeep(GLOBAL_COMMAND_HOOKS, hooks);
}

/**
 * Returns the package-level hook configuration for the command module base class.
 * @internal
 */
export function getGlobalCommandHooks(): GlobalCommandHooks {
    return GLOBAL_COMMAND_HOOKS;
}
