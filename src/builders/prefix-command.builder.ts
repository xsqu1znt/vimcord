import { BaseCommandConfig, CommandType } from "@ctypes/command.base";
import { BaseCommandBuilder } from "@/builders/base-command.builder";
import { Message } from "discord.js";
import { type Vimcord } from "@/client";

/**
 * Configuration specific to Prefix-based commands
 */
interface _PrefixCommandConfig extends BaseCommandConfig<CommandType.Prefix> {
    /** The primary name of the command */
    name: string;
    /** Alternative triggers for this command */
    aliases?: string[];
    /** A brief explanation of what the command does */
    description?: string;
}

export class PrefixCommandBuilder extends BaseCommandBuilder<CommandType.Prefix, _PrefixCommandConfig> {
    constructor(public options: _PrefixCommandConfig) {
        super(CommandType.Prefix, options);

        // Standardize the wrapping pattern:
        // We capture the original execute and wrap it with prefix-specific logic
        const originalExecute = this.options.execute;
        this.options.execute = async (client, message) => {
            return await this.handleExecution(client, message, originalExecute);
        };

        this.validatePrefixConfig();
    }

    /**
     * Specialized execution logic for Prefix Commands.
     */
    private async handleExecution(
        client: Vimcord<true>,
        message: Message,
        originalExecute?: _PrefixCommandConfig["execute"]
    ) {
        // Future hooks for prefix commands (like auto-parsing args) go here
        return await originalExecute?.(client, message);
    }

    private validatePrefixConfig() {
        if (!this.options.name) {
            throw new Error(`[Vimcord] PrefixCommandBuilder: Command name is required.`);
        }
    }

    // --- Overrides ---

    /**
     * Override setExecute to ensure handleExecution remains the entry point.
     */
    setExecute(fn: _PrefixCommandConfig["execute"]): this {
        const originalExecute = fn;
        this.options.execute = async (client, message) => {
            return await this.handleExecution(client, message, originalExecute);
        };
        return this;
    }

    /**
     * Converts the current builder state back into a config object.
     */
    toConfig(): _PrefixCommandConfig {
        return {
            ...this.options
        };
    }
}
