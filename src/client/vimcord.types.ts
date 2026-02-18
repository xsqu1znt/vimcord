import { AppConfig } from "@/configs/app.config";
import { ContextCommandConfig } from "@/configs/context-command.config";
import { PrefixCommandConfig } from "@/configs/prefix-command.config";
import { SlashCommandConfig } from "@/configs/slash-command.config";
import { StaffConfig } from "@/configs/staff.config";
import { EmbedResolvable } from "@/tools/types";
import { ClientOptions, Guild } from "discord.js";
import { PartialDeep } from "@/types/helpers";

export interface ModuleImportOptions {
    /** The directories to import from. */
    dir: string | string[];
    /** Recursively imports modules from subdirectories.
     * @defaultValue true
     **/
    recursive?: boolean;
    /** Only import modules that end with these suffixes.
     *
     * If set to `null` all files in the directory will be imported, which may lead to import errors if you have modules not related to commands in the same directory.
     *
     * Respectively, the default suffixes are `.slash`, `.ctx`, `.prefix`, and `.event`.
     *
     * @example
     * // Example module filenames using the default suffixes
     * "ping.slash.ts"
     * "avatar.ctx.ts"
     * "help.prefix.ts"
     * "ready.event.ts"
     */
    suffix?: string | string[] | null;
}

export interface AppModuleImports {
    /** Default suffix: slash
     * @example
     * // Example module filename
     * "ping.slash.ts"
     */
    slashCommands?: string | string[] | ModuleImportOptions;
    /** Default suffix: ctx
     * @example
     * // Example module filename
     * "avatar.ctx.ts"
     */
    contextCommands?: string | string[] | ModuleImportOptions;
    /** Default suffix: prefix
     * @example
     * // Example module filename
     * "help.prefix.ts"
     */
    prefixCommands?: string | string[] | ModuleImportOptions;
    /** Default suffix: event
     * @example
     * // Example module filename
     * "ready.event.ts"
     */
    events?: string | string[] | ModuleImportOptions;
}

export interface VimcordFeatures {
    /** Use our default prefix command handler.
     * @defaultValue false */
    useDefaultPrefixCommandHandler?: boolean;
    /** Use our default context command handler.
     * @defaultValue false */
    useDefaultContextCommandHandler?: boolean;
    /** Use our default slash command handler.
     * @defaultValue false */
    useDefaultSlashCommandHandler?: boolean;
    /** Use global process error handlers.
     * @defaultValue false */
    useGlobalErrorHandlers?: boolean;

    /** Reply to the user with an Uh-oh! embed when a command fails. If not using our default command handlers, you will have to implement this yourself using {@link sendCommandErrorEmbed}
     * @example
     * ```ts
     * try {
     *     // Execute the command
     *     return command.executeCommand(client, message);
     * } catch (err) {
     *     // Send the error embed, this already handles the feature configuration
     *     sendCommandErrorEmbed(client, err as Error, message.guild, message);
     *     // Re-throw the error so it can be handled by an error handler
     *     throw err;
     * }
     * ``` */
    enableCommandErrorMessage?: boolean | CommandErrorMessageConfig;

    /** The maximum number of attempts to log into Discord @defaultValue `3` */
    maxLoginAttempts?: number;

    /** Automatically imports modules from these directories. */
    importModules?: AppModuleImports;
}

export interface VimcordConfig {
    app: AppConfig;
    staff: StaffConfig;
    slashCommands: SlashCommandConfig;
    prefixCommands: PrefixCommandConfig;
    contextCommands: ContextCommandConfig;
}

export interface VimcordCreateConfig {
    options: ClientOptions;
    features?: VimcordFeatures;
    config?: PartialDeep<VimcordConfig>;
}

export interface CommandErrorMessageConfig {
    /** Use a custom embed */
    embed?: (embed: EmbedResolvable, error: Error, guild: Guild | null | undefined) => EmbedResolvable;
    /** @defaultValue config.staff.mainServer.inviteUrl */
    inviteUrl?: string;
    /** The support server invite button label @defaultValue "Support Server" */
    inviteButtonLabel?: string;
    /** The error details button label @defaultValue "Details" */
    detailButtonLabel?: string;
    /** @defaultValue 30_000 // 30 seconds */
    detailButtonIdleTimeout?: number;
    /** Should the message be ephemeral? */
    ephemeral?: boolean;
    /** Should the message be deleted after a certain amount of time? */
    deleteAfter?: number;
}
