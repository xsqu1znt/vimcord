import { Routes } from "discord.js";
import { CommandType } from "@ctypes/command.base";
import { VimcordCommandBuilderByType } from "@ctypes/command.helpers";
import { importModulesFromDir } from "@utils/dir";
import { type Vimcord } from "@/client";

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

export class BaseCommandManager<T extends CommandType> {
    readonly type: T;
    readonly client: Vimcord;
    readonly commands = new Map<string, VimcordCommandBuilderByType<T>>();
    readonly moduleSuffix?: string;

    constructor(client: Vimcord, type: T, moduleSuffix?: string) {
        this.type = type;
        this.client = client;
        this.moduleSuffix = moduleSuffix;
    }

    /**
     * Gets a command by name.
     */
    get(name: string) {
        if (this.type === CommandType.Prefix) {
            const config = this.client.config.prefixCommands;
            const search = config.allowCaseInsensitiveCommandNames ? name.toLowerCase() : name;

            return Array.from(this.commands.values()).find(cmd => {
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
            return this.commands.get(name);
        }
    }

    /**
     * Gets/filters commands and orders them alphabetically
     */
    getAll(options: CommandFilter = {}) {
        const matchedCommands = new Map<string, VimcordCommandBuilderByType<T>>();
        const isDev = this.client.config.app.devMode;

        for (const cmd of this.commands.values()) {
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

        for (const cmd of this.commands.values()) {
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

    /**
     * Imports command modules from a directory.
     * @param dir Path of one or more folders.
     * @param set Replaces imported command modules with the ones found.
     */
    async importFrom(dir: string | string[], set = false) {
        if (set) this.commands.clear();

        const dirs = Array.isArray(dir) ? dir : [dir];
        const modules: VimcordCommandBuilderByType<T>[] = [];

        for (const _dir of dirs) {
            const results = await importModulesFromDir<{ default: VimcordCommandBuilderByType<T> }>(_dir, this.moduleSuffix);
            modules.push(...results.map(({ module }) => module.default));
        }

        for (const module of modules) {
            const commandName = "builder" in module ? module.builder.name : module.options.name;
            this.commands.set(commandName, module);
        }

        let moduleType: string;
        switch (this.type) {
            case CommandType.Slash:
                moduleType = "Prefix Commands";
                break;
            case CommandType.Context:
                moduleType = "Context Commands";
                break;
            case CommandType.Prefix:
                moduleType = "Prefix Commands";
                break;
        }
        this.client.logger.moduleLoaded(moduleType, modules.length);

        return this.commands;
    }
}

export class SlashCommandManager extends BaseCommandManager<CommandType.Slash> {
    constructor(client: Vimcord) {
        super(client, CommandType.Slash, client.config.app.moduleSuffixes.slashCommand);
    }
}

export class ContextCommandManager extends BaseCommandManager<CommandType.Context> {
    constructor(client: Vimcord) {
        super(client, CommandType.Context, client.config.app.moduleSuffixes.contextCommand);
    }
}

export class PrefixCommandManager extends BaseCommandManager<CommandType.Prefix> {
    constructor(client: Vimcord) {
        super(client, CommandType.Prefix, client.config.app.moduleSuffixes.prefixCommand);
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
        const client = await this.client.whenReady();
        if (!client.rest) {
            console.error(`[CommandManager] ✖ Failed to register app commands globally: REST is not initialized`);
            return;
        }

        const commands = this.getAllAppCommands(options);
        if (!commands.length) {
            console.log("[CommandManager] No commands to register globally");
            return;
        }

        console.log(`[CommandManager] Registering (${commands.length}) commands globally...`);

        try {
            await client.rest.put(Routes.applicationCommands(client.user.id), { body: commands });
            console.log(`[CommandManager] ✔ Registered app commands globally`);
        } catch (err) {
            console.error(`[CommandManager] ✖ Failed to register app commands globally`, err);
        }
    }

    async unregisterGlobal() {
        const client = await this.client.whenReady();
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
        const client = await this.client.whenReady();
        if (!client.rest) {
            console.error(`[CommandManager] ✖ Failed to register app commands by guild: REST is not initialized`);
            return;
        }

        const commands = this.getAllAppCommands(options);
        if (!commands.length) {
            console.log("[CommandManager] No commands to register by guild");
            return;
        }

        const guildIds = options.guilds || client.guilds.cache.map(g => g.id);
        console.log(`[CommandManager] Registering (${commands.length}) commands for ${guildIds.length} guilds...`);

        await Promise.all(
            guildIds.map(guildId =>
                client.rest
                    .put(Routes.applicationGuildCommands(client.user.id, guildId), { body: commands })
                    .then(() => {
                        const gName = client.guilds.cache.get(guildId)?.name || "n/a";
                        console.log(`[CommandManager] ✔ Set app commands in guild: ${guildId} (${gName})`);
                    })
                    .catch(err => {
                        const gName = client.guilds.cache.get(guildId)?.name || "n/a";
                        console.log(`[CommandManager] ✖ Failed to set app commands in guild: ${guildId} (${gName})`, err);
                    })
            )
        );
    }

    async unregisterGuild(options: { guilds?: string[] } = {}) {
        const client = await this.client.whenReady();
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
