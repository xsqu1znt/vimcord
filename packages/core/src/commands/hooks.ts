import type { ChatInputCommandInteraction, ContextMenuCommandInteraction, Message } from "discord.js";
import type { Vimcord } from "@/client/Vimcord.js";
import type { BaseCommandBuilder } from "./builders.js";
import type { CommandPermissionResults } from "./configs.js";

export interface CommandHooks {
    prefix?: PrefixCommandHooks;
    slash?: SlashCommandHooks;
    context?: ContextCommandHooks;
}

interface BaseExecutionContext {
    command: BaseCommandBuilder;
}

interface BeforeExecutionContext extends BaseExecutionContext {
    cancel(): void;
    isCancelled(): boolean;
}

interface AfterExecutionContext extends BaseExecutionContext {
    /** Whatever was returned from the executed command. */
    result: unknown;
}

export interface BaseCommandHooks {}

export interface PrefixCommandHooks extends BaseCommandHooks {
    beforeExecute?(ctx: BeforeExecutionContext, client: Vimcord, message: Message): Promise<void>;
    afterExecute?(ctx: AfterExecutionContext, client: Vimcord, message: Message): Promise<void>;

    onConditionsNotMet?: (client: Vimcord, message: Message) => void | Promise<void>;
    onError?(error: Error, client: Vimcord, message: Message): Promise<void>;
    onMissingPermissions?: (results: CommandPermissionResults, client: Vimcord, message: Message) => void | Promise<void>;
    onRateLimit?: (client: Vimcord, message: Message) => void | Promise<void>;
}

export interface SlashCommandHooks extends BaseCommandHooks {
    beforeExecute?(ctx: BeforeExecutionContext, client: Vimcord, interaction: ChatInputCommandInteraction): Promise<void>;
    afterExecute?(ctx: AfterExecutionContext, client: Vimcord, interaction: ChatInputCommandInteraction): Promise<void>;

    onConditionsNotMet?: (client: Vimcord, message: ChatInputCommandInteraction) => void | Promise<void>;
    onError?(error: Error, client: Vimcord, interaction: ChatInputCommandInteraction): Promise<void>;
    onMissingPermissions?: (
        results: CommandPermissionResults,
        client: Vimcord,
        message: ChatInputCommandInteraction
    ) => void | Promise<void>;
    onRateLimit?: (client: Vimcord, message: ChatInputCommandInteraction) => void | Promise<void>;
}

export interface ContextCommandHooks extends BaseCommandHooks {
    beforeExecute?(ctx: BeforeExecutionContext, client: Vimcord, interaction: ContextMenuCommandInteraction): Promise<void>;
    afterExecute?(ctx: AfterExecutionContext, client: Vimcord, interaction: ContextMenuCommandInteraction): Promise<void>;

    onConditionsNotMet?: (client: Vimcord, message: ContextMenuCommandInteraction) => void | Promise<void>;
    onError?(error: Error, client: Vimcord, interaction: ContextMenuCommandInteraction): Promise<void>;
    onMissingPermissions?: (
        results: CommandPermissionResults,
        client: Vimcord,
        message: ContextMenuCommandInteraction
    ) => void | Promise<void>;
    onRateLimit?: (client: Vimcord, message: ContextMenuCommandInteraction) => void | Promise<void>;
}
