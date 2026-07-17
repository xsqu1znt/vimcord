import type { CommandModuleHooks, CommandModuleType } from "@/abstracts/index.js";
import type { PartialDeep } from "@/types/helpers.js";

import { mergeDeep } from "@/utils/obj.js";

export interface GlobalCommandHooks {
    /** Global hooks for prefix commands. */
    prefix?: CommandModuleHooks<CommandModuleType.Prefix>;
    /** Global hooks for slash commands. */
    slash?: CommandModuleHooks<CommandModuleType.Slash>;
    /** Global hooks for message and user context commands. */
    context?: CommandModuleHooks<CommandModuleType.MessageContext | CommandModuleType.UserContext>;
}

export const globalCommandHooks: GlobalCommandHooks = {};

/**
 * Updates the global command hook configuration.
 * @param hooks Partial command hooks to merge into the global config
 */
export function defineGlobalCommandHooks(hooks: PartialDeep<GlobalCommandHooks>): GlobalCommandHooks {
    return mergeDeep(globalCommandHooks, hooks);
}

/**
 * Returns the current global command hook configuration.
 */
export function getGlobalCommandHooks(): GlobalCommandHooks {
    return globalCommandHooks;
}
