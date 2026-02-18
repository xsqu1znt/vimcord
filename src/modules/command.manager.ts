import { DEFAULT_MODULE_SUFFIXES, Vimcord } from "@/client";
import { CommandType } from "@ctypes/command.base";
import { VimcordCommandBuilderByType } from "@ctypes/command.helpers";
import { Routes } from "discord.js";
import { ModuleImporter } from "./baseModule.importer";

export interface CommandFilter {
    names?: string[];
    fuzzyNames?: string[];
    globalOnly?: boolean;
    ignoreDeploymentOptions?: boolean;
}

export interface CommandByCategory<T extends CommandType> {
    name: string;
    emoji: string | undefined;
    commands: VimcordCommandBuilderByType<T>[];
}

export class BaseCommandManager<T extends CommandType> extends ModuleImporter<VimcordCommandBuilderByType<T>> {
    readonly type: T;
    readonly items = new Map<string, VimcordCommandBuilderByType<T>>();
    readonly itemSuffix: string | undefined;

    constructor(client: Vimcord, type: T, itemSuffix?: string) {
        super(client);
        this.type = type;
        switch (type) {
            case CommandType.Slash:
                this.itemSuffix = itemSuffix ?? DEFAULT_MODULE_SUFFIXES.slashCommands;
                break;
            case CommandType.Context:
                this.itemSuffix = itemSuffix ?? DEFAULT_MODULE_SUFFIXES.contextCommands;
                break;
            case CommandType.Prefix:
                this.itemSuffix = itemSuffix ?? DEFAULT_MODULE_SUFFIXES.prefixCommands;
                break;
        }
    }

    get commands() {
        return this.items;
    }

    get itemName(): string {
        switch (this.type) {
            case CommandType.Slash:
                return "Slash Commands";
            case CommandType.Context:
                return "Context Commands";
            case CommandType.Prefix:
                return "Prefix Commands";
        }
    }

    protected getName(module: VimcordCommandBuilderByType<T>): string {
        return "builder" in module ? module.builder.name : module.options.name;
    }

    /**
     * Gets a command by name.
     */
    get(name: string) {
        if (this.type === CommandType.Prefix) {
            const config = this.client.config.prefixCommands;
            const search = config.allowCaseInsensitiveCommandNames ? name.toLowerCase() : name;

            return Array.from(this.items.values()).find(cmd => {
                const commandName = "builder" in cmd ? cmd.builder.name : cmd.options.name;
                const trigger = config.allowCaseInsensitiveCommandNames ? commandName.toLowerCase() : commandName;
                if (trigger === search) return true;

                if ("aliases" in cmd.options) {
                    return cmd.options.aliases?.some(a =>
                        config.allowCaseInsensitiveCommandNames ? a.toLowerCase() === search : a === search
                    );
                }
            });
        } else {
            return this.items.get(name);
        }
    }

    /**
     * Gets/filters commands and orders them alphabetically.
     */
    getAll(options: CommandFilter = {}) {
        const matchedCommands = new Map<string, VimcordCommandBuilderByType<T>>();
        const isDev = this.client.config.app.devMode;

        for (const cmd of this.items.values()) {
            const commandName = "builder" in cmd ? cmd.builder.name : cmd.options.name;

            // 1. Name Filtering
            if (options.names || options.fuzzyNames) {
                const nameMatched =
                    options.names?.includes(commandName) || options.fuzzyNames?.some(fuzzy => commandName.includes(fuzzy));

                if (!nameMatched) continue;
            }

            if (options.ignoreDeploymentOptions) {
                matchedCommands.set(commandName, cmd);
                continue;
            }

            // 2. Environment/Deployment Filtering
            const deployment = "deployment" in cmd.options ? (cmd.options.deployment ?? {}) : {};
            const isProperEnv =
                !deployment.environments || deployment.environments.includes(isDev ? "development" : "production");

            if (!isProperEnv) continue;

            // 3. Global Filter
            if (options.globalOnly && deployment.global === false) continue;

            matchedCommands.set(commandName, cmd);
        }

        return Array.from(matchedCommands.values()).sort((a, b) => {
            const commandNameA = "builder" in a ? a.builder.name : a.options.name;
            const commandNameB = "builder" in b ? b.builder.name : b.options.name;
            return commandNameA.localeCompare(commandNameB);
        });
    }

    /**
     * Groups commands by category alphabetically.
     */
    sortByCategory() {
        const categories = new Map<string, CommandByCategory<T>>();

        for (const cmd of this.items.values()) {
            const metadata = cmd.options.metadata;
            if (!metadata?.category) continue;

            let entry = categories.get(metadata.category);

            if (!entry) {
                entry = {
                    name: metadata.category,
                    emoji: metadata.categoryEmoji,
                    commands: []
                };
                categories.set(metadata.category, entry);
            }

            entry.commands.push(cmd);
        }

        return Array.from(categories.values())
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(cat => {
                cat.commands.sort((a, b) => {
                    const commandNameA = "builder" in a ? a.builder.name : a.options.name;
                    const commandNameB = "builder" in b ? b.builder.name : b.options.name;
                    return commandNameA.localeCompare(commandNameB);
                });
                return cat;
            });
    }
}

export class SlashCommandManager extends BaseCommandManager<CommandType.Slash> {
    constructor(client: Vimcord) {
        super(client, CommandType.Slash);
    }
}

export class ContextCommandManager extends BaseCommandManager<CommandType.Context> {
    constructor(client: Vimcord) {
        super(client, CommandType.Context);
    }
}

export class PrefixCommandManager extends BaseCommandManager<CommandType.Prefix> {
    constructor(client: Vimcord) {
        super(client, CommandType.Prefix);
    }
}

export class CommandManager {
    readonly client: Vimcord;
    readonly slash: SlashCommandManager;
    readonly prefix: PrefixCommandManager;
    readonly context: ContextCommandManager;

    constructor(client: Vimcord) {
        this.client = client;
        this.slash = new SlashCommandManager(client);
        this.prefix = new PrefixCommandManager(client);
        this.context = new ContextCommandManager(client);
    }

    getAllAppCommands(options: CommandFilter = {}) {
        return [...this.slash.getAll(options), ...this.context.getAll(options)];
    }

    async registerGlobal(options: CommandFilter = {}) {
        const client = await Vimcord.getReadyInstance(this.client.clientId);
        if (!client.rest) {
            console.error(`[CommandManager] ✖ Failed to register app commands globally: REST is not initialized`);
            return;
        }

        const commands = this.getAllAppCommands(options).map(cmd => cmd.builder.toJSON());
        if (!commands.length) {
            console.log("[CommandManager] No commands to register globally");
            return;
        }

        console.log(
            `[CommandManager] Registering (${commands.length}) ${commands.length === 1 ? "command" : "commands"} globally...`
        );

        try {
            await client.rest.put(Routes.applicationCommands(client.user.id), { body: commands });
            console.log(`[CommandManager] ✔ Registered app ${commands.length === 1 ? "command" : "commands"} globally`);
        } catch (err) {
            console.error(
                `[CommandManager] ✖ Failed to register app ${commands.length === 1 ? "command" : "commands"} globally`,
                err
            );
        }
    }

    async unregisterGlobal() {
        const client = await Vimcord.getReadyInstance(this.client.clientId);
        if (!client.rest) {
            console.error(`[CommandManager] ✖ Failed to remove app commands globally: REST is not initialized`);
            return;
        }

        try {
            await client.rest.put(Routes.applicationCommands(client.user.id), { body: [] });
            console.log(`[CommandManager] ✔ Removed app commands globally`);
        } catch (err) {
            console.error(`[CommandManager] ✖ Failed to remove app commands globally`, err);
        }
    }

    async registerGuild(options: CommandFilter & { guilds?: string[] } = {}) {
        const client = await Vimcord.getReadyInstance(this.client.clientId);
        if (!client.rest) {
            console.error(`[CommandManager] ✖ Failed to register app commands by guild: REST is not initialized`);
            return;
        }

        const commands = this.getAllAppCommands(options).map(cmd => cmd.builder.toJSON());
        if (!commands.length) {
            console.log("[CommandManager] No commands to register by guild");
            return;
        }

        const guildIds = options.guilds || client.guilds.cache.map(g => g.id);
        console.log(
            `[CommandManager] Registering (${commands.length}) ${commands.length === 1 ? "command" : "commands"} for ${guildIds.length} guilds...`
        );

        await Promise.all(
            guildIds.map(guildId =>
                client.rest
                    .put(Routes.applicationGuildCommands(client.user.id, guildId), { body: commands })
                    .then(() => {
                        const gName = client.guilds.cache.get(guildId)?.name || "n/a";
                        console.log(
                            `[CommandManager] ✔ Set app ${commands.length === 1 ? "command" : "commands"} in guild: ${guildId} (${gName})`
                        );
                    })
                    .catch(err => {
                        const gName = client.guilds.cache.get(guildId)?.name || "n/a";
                        console.log(
                            `[CommandManager] ✖ Failed to set app ${commands.length === 1 ? "command" : "commands"} in guild: ${guildId} (${gName})`,
                            err
                        );
                    })
            )
        );
    }

    async unregisterGuild(options: { guilds?: string[] } = {}) {
        const client = await Vimcord.getReadyInstance(this.client.clientId);
        if (!client.rest) {
            console.error(`[CommandManager] ✖ Failed to register app commands by guild: REST is not initialized`);
            return;
        }

        const guildIds = options.guilds || client.guilds.cache.map(g => g.id);
        console.log(`[CommandManager] Unregistering commands from ${guildIds.length} guilds...`);

        await Promise.all(
            guildIds.map(guildId =>
                client.rest
                    .put(Routes.applicationGuildCommands(client.user.id, guildId), { body: [] })
                    .then(() => console.log(`[CommandManager] ✔ Removed app commands in guild: ${guildId}`))
                    .catch(err => console.log(`[CommandManager] ✖ Failed to remove app commands in guild: ${guildId}`, err))
            )
        );
    }
}
