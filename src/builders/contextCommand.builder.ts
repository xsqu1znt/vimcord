import { BaseAppCommandConfig, BaseCommandConfig, CommandType } from "@ctypes/command.base";
import { ContextMenuCommandBuilder, ContextMenuCommandInteraction } from "discord.js";
import { BaseCommandBuilder } from "@builders/baseCommand.builder";
import { AppCommandDeployment } from "@ctypes/command.options";
import { type Vimcord } from "@/client";
import _ from "lodash";

interface _ContextCommandConfig extends BaseCommandConfig<CommandType.Context>, BaseAppCommandConfig {
    builder: ContextMenuCommandBuilder | ((builder: ContextMenuCommandBuilder) => ContextMenuCommandBuilder);
    deferReply?: boolean | { ephemeral?: boolean };
}

export class ContextCommandBuilder extends BaseCommandBuilder<CommandType.Context, _ContextCommandConfig> {
    builder!: ContextMenuCommandBuilder;

    constructor(config: _ContextCommandConfig) {
        super(CommandType.Context, config);
        this.setBuilder(config.builder);

        const originalExecute = this.options.execute;
        this.options.execute = async (client, interaction) => {
            return await this.handleExecution(client, interaction, originalExecute);
        };
    }

    private async handleExecution(
        client: Vimcord<true>,
        interaction: ContextMenuCommandInteraction,
        originalExecute?: _ContextCommandConfig["execute"]
    ) {
        const config = this.resolveConfig(client);

        if (config.deferReply && !interaction.replied && !interaction.deferred) {
            await interaction.deferReply(typeof config.deferReply === "object" ? config.deferReply : undefined);
        }

        return await originalExecute?.(client, interaction);
    }

    private validateBuilder() {
        if (!this.builder.name) throw new Error(`[Vimcord] ContextCommandBuilder: Command name is required.`);
        this.builder.toJSON();
    }

    // --- Specialized Fluent API ---

    setBuilder(builder: _ContextCommandConfig["builder"]): this {
        this.builder = typeof builder === "function" ? builder(new ContextMenuCommandBuilder()) : builder;
        this.validateBuilder();
        return this;
    }

    setDeferReply(defer: _ContextCommandConfig["deferReply"]): this {
        this.options.deferReply = defer;
        return this;
    }

    setDeployment(deployment: AppCommandDeployment): this {
        this.options.deployment = _.merge(this.options.deployment || {}, deployment);
        return this;
    }

    setExecute(fn: _ContextCommandConfig["execute"]): this {
        const originalExecute = fn;
        this.options.execute = async (client, interaction) => {
            return await this.handleExecution(client, interaction, originalExecute);
        };
        return this;
    }

    toConfig(): _ContextCommandConfig {
        return { ...this.options, builder: this.builder };
    }
}
