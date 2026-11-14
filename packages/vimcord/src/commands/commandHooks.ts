import type { AnyCommandModuleHooks, CommandModuleHooks, CommandModuleType } from "@/abstracts/index.js";

/**
 * Command hooks set through the client's `hooks` option. The top-level hooks cover every command type; a type key adds its own.
 * `before` runs the shared hook, then the type's, then the module's. `onBlocked` and `onError` use the module's, else the type's, else the shared one.
 */
export interface GlobalCommandHooks extends AnyCommandModuleHooks {
    /** Hooks for prefix commands. */
    prefix?: CommandModuleHooks<CommandModuleType.Prefix>;
    /** Hooks for slash commands. */
    slash?: CommandModuleHooks<CommandModuleType.Slash>;
    /** Hooks for message and user context commands. */
    context?: CommandModuleHooks<CommandModuleType.MessageContext | CommandModuleType.UserContext>;
}
