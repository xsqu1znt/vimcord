import { REST, Routes } from "discord.js";
import { CommandType } from "@ctypes/command.base";
import { VimcordCommandBuilderByType } from "@ctypes/command.helpers";
import { importModulesFromDir } from "@utils/dir";
import { type Vimcord } from "@/client";

/**
 * Shared logic for Application Commands (Slash & Context)
 */
abstract class VimcordAppCommandManager<T extends CommandType.Slash | CommandType.Context> {
    public commands: Map<string, VimcordCommandBuilderByType<T>> = new Map();
    protected rest!: REST;

    constructor(
        protected client: Vimcord,
        protected typeName: string
    ) {
        this.client.whenReady().then(c => (this.rest = new REST().setToken(c.token)));
    }

    get(name: string) {
        return this.commands.get(name);
    }

    /**
     * Filters and returns commands based on deployment options alphabetically
     */
    getAll(options?: { names?: string[]; fuzzyNames?: string[]; globalOnly?: boolean; ignoreDeploymentOptions?: boolean }) {
        const matchedCommands = new Map<string, VimcordCommandBuilderByType<T>>();
        const isDev = this.client.config.app.devMode;

        for (const cmd of this.commands.values()) {
            const config = cmd.toConfig() as any;
            const name = (cmd.builder as any).name;

            // 1. Name Filtering
            if (options?.names || options?.fuzzyNames) {
                const nameMatched = options.names?.includes(name) || options.fuzzyNames?.some(fuzzy => name.includes(fuzzy));

                if (!nameMatched) continue;
            }

            if (options?.ignoreDeploymentOptions) {
                matchedCommands.set(name, cmd);
                continue;
            }

            // 2. Environment/Deployment Filtering
            const deployment = config.deployment || {};
            const isProperEnv =
                !deployment.environments || deployment.environments.includes(isDev ? "development" : "production");

            if (!isProperEnv) continue;

            // 3. Global Filter
            if (options?.globalOnly && deployment.global === false) continue;

            matchedCommands.set(name, cmd);
        }

        return Array.from(matchedCommands.values()).sort((a, b) => a.builder.name.localeCompare(b.builder.name));
    }

    /**
     * Groups commands by category alphabetically
     */
    sortByCategory() {
        const categories = new Map<
            string,
            { name: string; emoji: string | undefined; commands: VimcordCommandBuilderByType<T>[] }
        >();

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
                cat.commands.sort((a, b) => a.builder.name.localeCompare(b.builder.name));
                return cat;
            });
    }

    async registerGlobal(options?: { commands?: string[]; fuzzyCommands?: string[] }) {
        const client = await this.client.whenReady();
        const commands = Array.from(
            this.getAll({
                names: options?.commands,
                fuzzyNames: options?.fuzzyCommands,
                globalOnly: true
            }).values()
        ).map(cmd => cmd.builder.toJSON());

        if (!commands.length) {
            console.log(`[${this.typeName}] No commands to register`);
            return;
        }

        console.log(`[${this.typeName}] Registering ${commands.length} commands globally...`);

        try {
            await this.rest.put(Routes.applicationCommands(client.user.id), { body: commands });
            console.log(`[${this.typeName}] ✔ Registered app commands globally`);
        } catch (err) {
            console.log(`[${this.typeName}] ✖ Failed to register app commands globally`, err);
        }
    }

    async registerGuild(options?: { commands?: string[]; fuzzyCommands?: string[]; guilds?: string[] }) {
        const client = await this.client.whenReady();
        const commands = Array.from(
            this.getAll({
                names: options?.commands,
                fuzzyNames: options?.fuzzyCommands
            }).values()
        ).map(cmd => cmd.builder.toJSON());

        if (!commands.length) {
            console.log(`[${this.typeName}] No commands to register`);
            return;
        }

        const guildIds = options?.guilds || client.guilds.cache.map(g => g.id);
        console.log(`[${this.typeName}] Registering ${commands.length} commands for ${guildIds.length} guilds...`);

        await Promise.all(
            guildIds.map(guildId =>
                this.rest
                    .put(Routes.applicationGuildCommands(client.user.id, guildId), { body: commands })
                    .then(() => {
                        const gName = client.guilds.cache.get(guildId)?.name || "n/a";
                        console.log(`[${this.typeName}] ✔ Set app commands in guild: ${guildId} (${gName})`);
                    })
                    .catch(err => {
                        const gName = client.guilds.cache.get(guildId)?.name || "n/a";
                        console.log(`[${this.typeName}] ✖ Failed to set app commands in guild: ${guildId} (${gName})`, err);
                    })
            )
        );
    }

    async unregisterGuild(options?: { guilds?: string[] }) {
        const client = await this.client.whenReady();
        const guildIds = options?.guilds || client.guilds.cache.map(g => g.id);

        console.log(`[${this.typeName}] Unregistering commands from ${guildIds.length} guilds...`);

        await Promise.all(
            guildIds.map(guildId =>
                this.rest
                    .put(Routes.applicationGuildCommands(client.user.id, guildId), { body: [] })
                    .then(() => console.log(`[${this.typeName}] ✔ Removed app commands in guild: ${guildId}`))
                    .catch(err =>
                        console.log(`[${this.typeName}] ✖ Failed to remove app commands in guild: ${guildId}`, err)
                    )
            )
        );
    }

    async unregisterGlobal() {
        const client = await this.client.whenReady();
        try {
            await this.rest.put(Routes.applicationCommands(client.user.id), { body: [] });
            console.log(`[${this.typeName}] ✔ Removed app commands globally`);
        } catch (err) {
            console.log(`[${this.typeName}] ✖ Failed to remove app commands globally`, err);
        }
    }
}

export class VimcordSlashCommandManager extends VimcordAppCommandManager<CommandType.Slash> {
    constructor(client: Vimcord) {
        super(client, "SlashCommandManager");
    }

    async importFrom(dir: string | string[], replaceAll = false) {
        if (replaceAll) this.commands.clear();
        const dirs = Array.isArray(dir) ? dir : [dir];

        // Map over directories since the utility only takes a string
        const modules = (
            await Promise.all(
                dirs.map(d => importModulesFromDir<{ default: VimcordCommandBuilderByType<CommandType.Slash> }>(d, "slash"))
            )
        ).flat();

        for (const { module } of modules) {
            this.commands.set(module.default.builder.name, module.default);
        }
        this.client.logger.moduleLoaded("Slash Commands", modules.length);
        return this.commands;
    }
}

export class VimcordContextCommandManager extends VimcordAppCommandManager<CommandType.Context> {
    constructor(client: Vimcord) {
        super(client, "ContextCommandManager");
    }

    async importFrom(dir: string | string[], replaceAll = false) {
        if (replaceAll) this.commands.clear();
        const dirs = Array.isArray(dir) ? dir : [dir];

        const modules = (
            await Promise.all(
                dirs.map(d => importModulesFromDir<{ default: VimcordCommandBuilderByType<CommandType.Context> }>(d, "ctx"))
            )
        ).flat();

        for (const { module } of modules) {
            this.commands.set(module.default.builder.name, module.default);
        }
        this.client.logger.moduleLoaded("Context Commands", modules.length);
        return this.commands;
    }
}

export class VimcordPrefixCommandManager {
    public commands: Map<string, VimcordCommandBuilderByType<CommandType.Prefix>> = new Map();

    constructor(private client: Vimcord) {}

    resolve(trigger: string) {
        const config = this.client.config.prefixCommands;
        const search = config.allowCaseInsensitiveCommandNames ? trigger.toLowerCase() : trigger;

        return Array.from(this.commands.values()).find(cmd => {
            const opts = cmd.toConfig();
            const name = config.allowCaseInsensitiveCommandNames ? opts.name.toLowerCase() : opts.name;
            if (name === search) return true;
            return opts.aliases?.some(a =>
                config.allowCaseInsensitiveCommandNames ? a.toLowerCase() === search : a === search
            );
        });
    }

    /**
     * Groups commands by category alphabetically
     */
    sortByCategory() {
        const categories = new Map<
            string,
            { name: string; emoji: string | undefined; commands: VimcordCommandBuilderByType<CommandType.Prefix>[] }
        >();

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
                cat.commands.sort((a, b) => a.options.name.localeCompare(b.options.name));
                return cat;
            });
    }

    async importFrom(dir: string | string[], replaceAll = false) {
        if (replaceAll) this.commands.clear();
        const dirs = Array.isArray(dir) ? dir : [dir];

        const modules = (
            await Promise.all(
                dirs.map(d =>
                    importModulesFromDir<{ default: VimcordCommandBuilderByType<CommandType.Prefix> }>(d, "prefix")
                )
            )
        ).flat();

        for (const { module } of modules) {
            this.commands.set(module.default.toConfig().name, module.default);
        }
        this.client.logger.moduleLoaded("Prefix Commands", modules.length);
        return this.commands;
    }
}

export class VimcordCommandManager {
    public readonly slash: VimcordSlashCommandManager;
    public readonly prefix: VimcordPrefixCommandManager;
    public readonly context: VimcordContextCommandManager;

    constructor(client: Vimcord) {
        this.slash = new VimcordSlashCommandManager(client);
        this.prefix = new VimcordPrefixCommandManager(client);
        this.context = new VimcordContextCommandManager(client);
    }
}
