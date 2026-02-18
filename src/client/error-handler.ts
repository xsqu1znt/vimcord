import { sendCommandErrorEmbed } from "@/utils/command-error.utils";
import { CommandInteraction, Guild, Message } from "discord.js";
import { Vimcord } from "./Vimcord";

export class ErrorHandler {
    readonly client: Vimcord;

    constructor(client: Vimcord) {
        this.client = client;
    }

    /** Handles command errors - sends error embed to user, then rethrows. */
    async handleCommandError(
        error: Error,
        guild: Guild | null,
        messageOrInteraction: Message | CommandInteraction
    ): Promise<void> {
        await sendCommandErrorEmbed(this.client, error, guild, messageOrInteraction);
        throw error;
    }

    /** Handles internal Vimcord errors - logs with [Vimcord] prefix. */
    handleVimcordError(error: Error, context: string): void {
        this.client.logger.error(`[Vimcord] [${context}]`, error);
    }

    /** Sets up global process error handlers. */
    setupGlobalHandlers(): void {
        process.on("uncaughtException", err => this.handleVimcordError(err, "Uncaught Exception"));
        process.on("unhandledRejection", err => this.handleVimcordError(err as Error, "Unhandled Rejection"));
        process.on("exit", code => this.client.logger.debug(`Process exited with code ${code}`));

        this.client.on("error", err => this.handleVimcordError(err, "Client Error"));
        this.client.on("shardError", err => this.handleVimcordError(err, "Client Shard Error"));
    }
}
