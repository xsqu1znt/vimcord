import type { AnyCommandModuleHooks, CommandModuleHooks, CommandModuleType } from "@/abstracts/index.js";

/**
 * Hooks shared by every module of a command type, set through the client's `hooks` option.
 * `before` runs `all`, then the type's hook, then the module's. `onBlocked` and `onError` use the module's, else the type's, else `all`.
 */
export interface GlobalCommandHooks {
    /** Hooks for every command kind. */
    all?: AnyCommandModuleHooks;
    /** Hooks for prefix commands. */
    prefix?: CommandModuleHooks<CommandModuleType.Prefix>;
    /** Hooks for slash commands. */
    slash?: CommandModuleHooks<CommandModuleType.Slash>;
    /** Hooks for message and user context commands. */
    context?: CommandModuleHooks<CommandModuleType.MessageContext | CommandModuleType.UserContext>;
}
