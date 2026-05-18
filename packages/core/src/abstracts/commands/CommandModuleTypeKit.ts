import type { ChatInputCommandInteraction, ContextMenuCommandInteraction, Message } from "discord.js";
import type { PermissionTestResult } from "@/commands/commandPermissions.js";

// --- Main Types ---
export enum CommandModuleType {
    Prefix = "Prefix",
    Slash = "Slash",
    Context = "Context"
}

export type CommandModuleParams<T extends CommandModuleType> = T extends CommandModuleType.Prefix
    ? { message: Message }
    : T extends CommandModuleType.Slash
      ? { interaction: ChatInputCommandInteraction }
      : { interaction: ContextMenuCommandInteraction };

export type CommandModuleArgs<T extends CommandModuleType> = T extends CommandModuleType.Prefix
    ? [message: Message]
    : T extends CommandModuleType.Slash
      ? [interaction: ChatInputCommandInteraction]
      : [interaction: ContextMenuCommandInteraction];

// --- Contexts ---
export type CommandHookContext<T extends CommandModuleType> = CommandModuleParams<T> & {
    permissionTestResult?: PermissionTestResult;
};

type BaseCommandContext<T extends CommandModuleType> = CommandModuleParams<T> & {};

export type PrefixCommandContext = BaseCommandContext<CommandModuleType.Prefix> & {
    messageContent: string;
    splitContent: (options?: { separator?: string; lowercase?: boolean; uppercase?: boolean }) => string[];
    prefixUsed: string;
};

export type SlashCommandContext = BaseCommandContext<CommandModuleType.Slash> & {};

export type ContextCommandContext = BaseCommandContext<CommandModuleType.Context> & {};
