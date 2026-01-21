import {
    AppCommandDeployment,
    CommandMetadata,
    CommandPermissionResults,
    CommandPermissions,
    CommandRateLimitOptions
} from "./command.options";
import { ChatInputCommandInteraction, ContextMenuCommandInteraction, Message } from "discord.js";
import { type Vimcord } from "@/client";

export enum CommandType {
    Slash = 0,
    Prefix = 1,
    Context = 2
}

export enum MissingPermissionReason {
    User = 0,
    Bot = 1,
    Role = 2,
    UserBlacklisted = 3,
    RoleBlacklisted = 4,
    NotInGuild = 5,
    NotGuildOwner = 6,
    NotBotOwner = 7,
    NotBotStaff = 8
}

export enum RateLimitScope {
    User = 0,
    Guild = 1,
    Channel = 2,
    Global = 3
}

export type BaseCommandParameters<T extends CommandType> = T extends CommandType.Slash
    ? [client: Vimcord<true>, interaction: ChatInputCommandInteraction]
    : T extends CommandType.Prefix
      ? [client: Vimcord<true>, message: Message]
      : T extends CommandType.Context
        ? [client: Vimcord<true>, interaction: ContextMenuCommandInteraction]
        : never;

export interface BaseCommandConfig<T extends CommandType> {
    /** Is this command enabled? @defaultValue true */
    enabled?: boolean;
    /** Custom conditions that must be met for this command to execute */
    conditions?: Array<(...args: BaseCommandParameters<T>) => boolean | Promise<boolean>>;
    /** Command permission requirements */
    permissions?: CommandPermissions;
    /** Command metadata configuration */
    metadata?: CommandMetadata;
    /** Rate limiting options */
    rateLimit?: CommandRateLimitOptions<(...args: BaseCommandParameters<T>) => any>;
    /** Log whenever a command is executed? @defaultValue true */
    logExecution?: boolean;

    /** Executed before the main command logic */
    beforeExecute?: (...args: BaseCommandParameters<T>) => any;
    /** The main command function that will be executed */
    execute?: (...args: BaseCommandParameters<T>) => any;
    /** Executed after successful execution */
    afterExecute?: (result: any, ...args: BaseCommandParameters<T>) => any;
    /** Executed when the required permissions are not met */
    onMissingPermissions?: (results: CommandPermissionResults, ...args: BaseCommandParameters<T>) => any;
    /** Executed when the required conditions are not met */
    onConditionsNotMet?: (...args: BaseCommandParameters<T>) => any;
    /** Executed when this command is used when its disabled */
    onUsedWhenDisabled?: (...args: BaseCommandParameters<T>) => any;
    /** Executed when the rate limit is hit */
    onRateLimit?: (...args: BaseCommandParameters<T>) => any;
    /** Custom error handler */
    onError?: (error: Error, ...args: BaseCommandParameters<T>) => any;
}

export interface BaseAppCommandConfig {
    /** Command deployment configuration */
    deployment?: AppCommandDeployment;
}

export interface CommandInternalRateLimitData {
    /** Number of times executed */
    executions: number;
    /** Timestamp of latest execution */
    timestamp: number;
}
