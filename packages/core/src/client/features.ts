// TODO: Implement command configs as `hooks`

export interface VimcordFeatures {
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
    enableCommandErrorMessage?: boolean | CommandErrorMessageOptions;

    /** The maximum number of attempts to log into Discord @defaultValue `3` */
    maxLoginAttempts?: number;
}

export interface CommandErrorMessageOptions {
    // TODO: Reimplement this when tools are added
    /** Use a custom embed. */
    // embed?: (embed: EmbedResolvable, error: Error, guild: Guild | null | undefined) => EmbedResolvable;
    /** @defaultValue config.staff.mainServer.inviteUrl */
    inviteUrl?: string;
    /** The support server invite button label. @defaultValue "Support Server" */
    inviteButtonLabel?: string;
    /** The error details button label. @defaultValue "Details" */
    detailButtonLabel?: string;
    /** @defaultValue 30_000 // 30 seconds */
    detailButtonIdleTimeout?: number;
    /** Should the message be ephemeral? */
    ephemeral?: boolean;
    /** Should the message be deleted after a certain amount of time? */
    deleteAfter?: number;
}
