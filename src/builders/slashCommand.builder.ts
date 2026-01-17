import { BaseAppCommandConfig, BaseCommandConfig, CommandType } from "@ctypes/command.base";
import { ChatInputCommandInteraction, SlashCommandBuilder as DJSSlashCommandBuilder } from "discord.js";
import { AnySlashCommandBuilder, AppCommandDeployment } from "@ctypes/command.options";
import { BaseCommandBuilder } from "@builders/baseCommand.builder";
import { type Vimcord } from "@/client";
import _ from "lodash";

export interface SlashCommandConfig extends BaseCommandConfig<CommandType.Slash>, BaseAppCommandConfig {
    builder: AnySlashCommandBuilder | ((builder: DJSSlashCommandBuilder) => AnySlashCommandBuilder);
    deferReply?: boolean | { ephemeral?: boolean };
    routes?: Array<{ name: string; handler: (client: Vimcord<true>, interaction: ChatInputCommandInteraction) => any }>;
    onUnknownRouteHandler?: (client: Vimcord<true>, interaction: ChatInputCommandInteraction) => any;
}

export class SlashCommandBuilder extends BaseCommandBuilder<CommandType.Slash, SlashCommandConfig> {
    public builder!: AnySlashCommandBuilder;
    private readonly routes: Map<string, (client: Vimcord<true>, interaction: ChatInputCommandInteraction) => any> =
        new Map();

    constructor(config: SlashCommandConfig) {
        super(CommandType.Slash, config);
        this.setBuilder(config.builder);
        if (config.routes) this.addRoutes(...config.routes);

        const originalExecute = this.options.execute;
        this.options.execute = async (client, interaction) => {
            return await this.handleExecution(client, interaction, originalExecute);
        };
    }

    private async handleExecution(
        client: Vimcord<true>,
        interaction: ChatInputCommandInteraction,
        originalExecute?: SlashCommandConfig["execute"]
    ) {
        const config = this.resolveConfig(client);

        if (config.deferReply && !interaction.replied && !interaction.deferred) {
            await interaction.deferReply(typeof config.deferReply === "object" ? config.deferReply : undefined);
        }

        const subCommand = interaction.options.getSubcommand(false);
        if (subCommand) {
            const handler = this.routes.get(subCommand.toLowerCase());
            if (handler) return await handler(client, interaction);
            if (config.onUnknownRouteHandler) return await config.onUnknownRouteHandler(client, interaction);
        }

        return await originalExecute?.(client, interaction);
    }

    private validateBuilder() {
        if (!this.builder.name) throw new Error(`[Vimcord] SlashCommandBuilder: Command name is required.`);
        if (!this.builder.description) throw new Error(`[Vimcord] SlashCommandBuilder: Command description is required.`);
        this.builder.toJSON();
    }

    // --- Specialized Fluent API ---

    setBuilder(builder: SlashCommandConfig["builder"]): this {
        this.builder = typeof builder === "function" ? builder(new DJSSlashCommandBuilder()) : builder;
        this.validateBuilder();
        return this;
    }

    setDeferReply(defer: SlashCommandConfig["deferReply"]): this {
        this.options.deferReply = defer;
        return this;
    }

    setDeployment(deployment: AppCommandDeployment): this {
        this.options.deployment = _.merge(this.options.deployment || {}, deployment);
        return this;
    }

    setRoutes(...routes: NonNullable<SlashCommandConfig["routes"]>): this {
        this.routes.clear();
        this.addRoutes(...routes);
        return this;
    }

    addRoutes(...routes: NonNullable<SlashCommandConfig["routes"]>): this {
        if (!this.options.routes) this.options.routes = [];
        for (const route of routes) {
            const name = route.name.toLowerCase();
            this.routes.set(name, route.handler);
            const existingIndex = this.options.routes.findIndex(r => r.name.toLowerCase() === name);
            if (existingIndex > -1) this.options.routes[existingIndex] = route;
            else this.options.routes.push(route);
        }
        return this;
    }

    setUnknownRouteHandler(handler: SlashCommandConfig["onUnknownRouteHandler"]): this {
        this.options.onUnknownRouteHandler = handler;
        return this;
    }

    setExecute(fn: SlashCommandConfig["execute"]): this {
        const originalExecute = fn;
        this.options.execute = async (client, interaction) => {
            return await this.handleExecution(client, interaction, originalExecute);
        };
        return this;
    }

    toConfig(): SlashCommandConfig {
        return {
            ...this.options,
            builder: this.builder,
            routes: Array.from(this.routes.entries()).map(([name, handler]) => ({ name, handler }))
        };
    }
}
