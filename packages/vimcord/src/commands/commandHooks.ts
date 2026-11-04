import type { CommandModuleHooks, CommandModuleType } from "@/abstracts/index.js";

/** Hooks shared by every module of a command type, set through the client's `hooks` option. */
export interface GlobalCommandHooks {
    /** Hooks for prefix commands. */
    prefix?: CommandModuleHooks<CommandModuleType.Prefix>;
    /** Hooks for slash commands. */
    slash?: CommandModuleHooks<CommandModuleType.Slash>;
    /** Hooks for message and user context commands. */
    context?: CommandModuleHooks<CommandModuleType.MessageContext | CommandModuleType.UserContext>;
}
