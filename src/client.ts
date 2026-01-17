import { Client, ClientOptions, Guild, User, userMention } from "discord.js";
import dotEnv, { DotenvConfigOptions } from "dotenv";

import { VimcordDatabaseManager } from "@ctypes/database";
import { PartialDeep } from "type-fest";

import { globalVimcordToolsConfig } from "@configs/tools.config";
import { createVimcordAppConfig, VimcordAppConfig } from "@/configs/app.config";
import { createVimcordStaffConfig, VimcordStaffConfig } from "@configs/staff.config";
import { createVimcordSlashCommandConfig, VimcordSlashCommandConfig } from "@configs/slashCommand.config";
import { createVimcordPrefixCommandConfig, VimcordPrefixCommandConfig } from "@configs/prefixCommand.config";
import { createVimcordContextCommandConfig, VimcordContextCommandConfig } from "@configs/contextCommand.config";

import { VimcordStatusManager } from "./modules/status.manager";
import { VimcordCommandManager } from "@modules/command.manager";
import { VimcordEventManager } from "@modules/event.manager";
import { EventBuilder } from "@builders/event.builder";

import { sendCommandErrorEmbed } from "./utils/sendCommandErrorEmbed";
import { retryExponentialBackoff } from "@utils/async";
import { fetchGuild, fetchUser } from "./tools/utils";
import { BetterEmbed } from "./tools/BetterEmbed";
import { version } from "../package.json";
import { randomUUID } from "node:crypto";
import { Logger } from "./tools/Logger";
import chalk from "chalk";

export interface CommandErrorMessageConfig {
    /** Use a custom embed */
    embed?: (embed: BetterEmbed, error: Error, guild: Guild | null | undefined) => BetterEmbed;
    /** @default config.staff.mainServer.inviteUrl */
    inviteUrl?: string;
    /** The support server invite button label @default "Support Server" */
    inviteButtonLabel?: string;
    /** The error details button label @default "Details" */
    detailButtonLabel?: string;
    /** @default 30_000 // 30 seconds */
    detailButtonIdleTimeout?: number;
    /** Should the message be ephemeral? */
    ephemeral?: boolean;
    /** Should the message be deleted after a certain amount of time? */
    deleteAfter?: number;
}

export interface VimcordFeatures {
    /** Use global process error handlers @defaultValue `false` */
    useGlobalErrorHandlers?: boolean;
    /** Use our default prefix command handler @defaultValue `true` */
    useDefaultPrefixCommandHandler?: boolean;
    /** Use our default slash command handler @defaultValue `true` */
    useDefaultSlashCommandHandler?: boolean;
    /** Use our default context command handler @defaultValue `true` */
    useDefaultContextCommandHandler?: boolean;

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

    /** Update the state of {@link globalVimcordToolsConfig.devMode} whenever {@link VimcordAppConfig.devMode} is updated in the client. This is mainly useful for {@link BetterEmbed} to switch between devMode and production colors during runtime without having to update the global config manually @defaultValue `false` */
    hookToolsDevMode?: boolean;

    /** Setup and configure `dotenv` @defaultValue `false` */
    useEnv?: boolean | DotenvConfigOptions;

    /** The maximum number of attempts to log into Discord @defaultValue `3` */
    loginAttempts?: number;

    /** Import modules from directories */
    importModules?: {
        events?: string | string[];
        slashCommands?: string | string[];
        prefixCommands?: string | string[];
        contextCommands?: string | string[];
    };
}

export interface VimcordConfig {
    app: VimcordAppConfig;
    staff: VimcordStaffConfig;
    slashCommands: VimcordSlashCommandConfig;
    prefixCommands: VimcordPrefixCommandConfig;
    contextCommands: VimcordContextCommandConfig;
}

export const clientInstances: Vimcord[] = [];

export class Vimcord<Ready extends boolean = boolean> extends Client<Ready> {
    readonly uuid: string = randomUUID();
    readonly index: number = clientInstances.length;

    readonly clientOptions: ClientOptions;
    readonly features: VimcordFeatures;
    readonly config: VimcordConfig;

    status: VimcordStatusManager;
    events: VimcordEventManager;
    commands: VimcordCommandManager;
    database?: VimcordDatabaseManager;

    // Configure custom logger
    logger = new Logger({ prefixEmoji: "⚡", prefix: `vimcord (i${this.index})` }).extend({
        clientBanner(client: Vimcord) {
            if (client.config.app.disableBanner) return;

            const border = "═".repeat(50);
            console.log(chalk.hex(this.colors.primary)(`\n╔${border}╗`));
            console.log(
                chalk.hex(this.colors.primary)("║") +
                    chalk.bold.hex(this.colors.text)(
                        `  🚀 ${client.config.app.name} v${client.config.app.appVersion}`.padEnd(
                            50 - (client.config.app.devMode ? 12 : 0)
                        )
                    ) +
                    chalk.hex(this.colors.primary)(
                        `${client.config.app.devMode ? chalk.hex(this.colors.warn)("devMode ⚠️   ") : ""}║`
                    )
            );

            console.log(chalk.hex(this.colors.primary)(`║${"".padEnd(50)}║`));

            console.log(
                chalk.hex(this.colors.primary)("║") +
                    chalk.hex(this.colors.muted)(
                        `  # Powered by Vimcord v${version}`.padEnd(50 - 3 - `${client.index}`.length)
                    ) +
                    chalk.hex(this.colors.primary)(`${chalk.hex(this.colors.muted)(`i${client.index}`)}  ║`)
            );
            console.log(chalk.hex(this.colors.primary)(`╚${border}╝\n`));
        },

        clientReady(clientTag: string, guildCount: number) {
            console.log(
                this.formatTimestamp(),
                this.formatPrefix(),
                chalk.hex(this.colors.success)("🤖 READY"),
                chalk.white(`Connected as ${chalk.bold.hex(this.colors.primary)(clientTag)}`),
                chalk.hex(this.colors.muted)(`• ${guildCount} guilds`)
            );
        },

        moduleLoaded(moduleName: string, count?: number, ignoredCount?: number): void {
            const countText = count ? chalk.hex(this.colors.muted)(`(${count} items)`) : "";
            console.log(
                this.formatTimestamp(),
                this.formatPrefix(),
                chalk.hex("#9B59B6")("📦 MODULE"),
                chalk.hex(this.colors.warn)(`${moduleName} loaded`),
                ignoredCount ? chalk.hex(this.colors.muted)(`(${ignoredCount} ignored)`) : "",
                countText
            );
        },

        commandExecuted(commandName: string, username: string, guildName?: string) {
            const location = guildName ? `in ${chalk.hex(this.colors.muted)(guildName)}` : "in DMs";
            console.log(
                this.formatTimestamp(),
                this.formatPrefix(),
                chalk.hex("#87CEEB")("📝 COMMAND"),
                chalk.hex(this.colors.warn)(`/${commandName}`),
                chalk.white(`used by ${chalk.bold(username)}`),
                chalk.hex(this.colors.muted)(location)
            );
        },

        database(action: string, details?: string) {
            console.log(
                this.formatTimestamp(),
                this.formatPrefix(),
                chalk.hex("#FF6B9D")("🗄️  DATABASE"),
                chalk.white(action),
                details ? chalk.hex(this.colors.muted)(details) : ""
            );
        }
    });

    private clientStartingPromise: Promise<string | null> | null = null;

    constructor(options: ClientOptions, features: VimcordFeatures = {}, config: PartialDeep<VimcordConfig> = {}) {
        super(options);

        this.clientOptions = options;
        this.features = features;

        this.config = {
            app: createVimcordAppConfig(config.app),
            staff: createVimcordStaffConfig(config.staff),
            slashCommands: createVimcordSlashCommandConfig(config.slashCommands),
            prefixCommands: createVimcordPrefixCommandConfig(config.prefixCommands),
            contextCommands: createVimcordContextCommandConfig(config.contextCommands)
        };

        // Configure the status manager
        this.status = new VimcordStatusManager(this);
        // Configure the event manager
        this.events = new VimcordEventManager(this);
        // Configure the command manager
        this.commands = new VimcordCommandManager(this);

        /* - - - - - { Features } - - - - - */
        if (this.features.useEnv) {
            if (typeof this.features.useEnv === "object") {
                dotEnv.config({ quiet: true, ...this.features.useEnv });
            } else {
                dotEnv.config({ quiet: true });
            }
        }

        // Configure default error handlers
        if (this.features.useGlobalErrorHandlers) {
            process.on("uncaughtException", err => this.logger.error("Uncaught Exception", err));
            process.on("unhandledRejection", err => this.logger.error("Unhandled Rejection", err as Error));
            process.on("exit", code => this.logger.debug(`Process exited with code ${code}`));
            this.on("error", err => this.logger.error("Client Error", err));
            this.on("shardError", err => this.logger.error("Client Shard Error", err));
        }

        /* - - - - - { Client } - - - - - */
        this.logger.clientBanner(this);

        // Handle client ready
        this.once("clientReady", client => {
            this.logger.clientReady(client.user.tag, client.guilds.cache.size);
        });

        // Add to global instances
        clientInstances.push(this);
    }

    /** Returns the options, features, and config of this client */
    toJSON() {
        return {
            options: this.clientOptions,
            features: this.features,
            config: this.config
        };
    }

    /** Make a clone of this client */
    clone() {
        const { options, features, config } = this.toJSON();
        return new Vimcord(options, features, config);
    }

    configureApp(options: PartialDeep<VimcordAppConfig> = {}) {
        this.config.app = createVimcordAppConfig(options);
        if (this.features.hookToolsDevMode) {
            globalVimcordToolsConfig.devMode = this.config.app.devMode;
        }
        return this;
    }

    configureStaff(options: PartialDeep<VimcordStaffConfig> = {}) {
        this.config.staff = createVimcordStaffConfig(options);
        return this;
    }

    configureSlashCommands(options: PartialDeep<VimcordSlashCommandConfig>) {
        this.config.slashCommands = createVimcordSlashCommandConfig(options);
        return this;
    }

    configurePrefixCommands(options: PartialDeep<VimcordPrefixCommandConfig>) {
        this.config.prefixCommands = createVimcordPrefixCommandConfig(options);
        return this;
    }

    configureContextCommands(options: PartialDeep<VimcordContextCommandConfig>) {
        this.config.contextCommands = createVimcordContextCommandConfig(options);
        return this;
    }

    async addEventModules(dir: string | string[], replaceAll?: boolean) {
        await this.events.importFrom(dir, replaceAll);
        return this;
    }

    async addSlashCommandModules(dir: string | string[], replaceAll?: boolean) {
        await this.commands.slash.importFrom(dir, replaceAll);
        return this;
    }

    async addPrefixCommandModules(dir: string | string[], replaceAll?: boolean) {
        await this.commands.prefix.importFrom(dir, replaceAll);
        return this;
    }

    async addContextCommandModules(dir: string | string[], replaceAll?: boolean) {
        await this.commands.context.importFrom(dir, replaceAll);
        return this;
    }

    async useDatabase(database: VimcordDatabaseManager): Promise<boolean> {
        this.database = database;
        this.logger.database("Using", database.name);
        return this.database.connect();
    }

    async whenReady(): Promise<Vimcord<true>> {
        if (this.isReady()) return this as Vimcord<true>;

        return new Promise((resolve, reject) => {
            // Force timeout after 45 seconds
            const timeout = setTimeout(() => reject(new Error("Client is not ready")), 45_000);

            this.once("clientReady", () => {
                clearTimeout(timeout);
                resolve(this as Vimcord<true>);
            });
        });
    }

    async build() {
        /* Ensure updated configuration */
        this.configureApp(this.config.app);
        this.configureStaff(this.config.staff);
        this.configureSlashCommands(this.config.slashCommands);
        this.configurePrefixCommands(this.config.prefixCommands);
        this.configureContextCommands(this.config.contextCommands);

        // Automatically import external modules
        if (this.features.importModules) {
            const importModules = this.features.importModules;

            await Promise.all([
                importModules.events && this.addEventModules(importModules.events),
                importModules.slashCommands && this.addSlashCommandModules(importModules.slashCommands),
                importModules.prefixCommands && this.addPrefixCommandModules(importModules.prefixCommands),
                importModules.contextCommands && this.addContextCommandModules(importModules.contextCommands)
            ]);
        }

        // Configure default slash command handler
        if (this.features.useDefaultSlashCommandHandler) {
            this.events.register(defaultSlashCommandHandler);
        }

        // Configure default prefix command handler
        if (this.features.useDefaultPrefixCommandHandler) {
            this.events.register(defaultPrefixCommandHandler);
        }

        // Configure default context command handler
        if (this.features.useDefaultContextCommandHandler) {
            this.events.register(defaultContextCommandHandler);
        }

        return this;
    }

    /** Automatically uses `process.env.TOKEN` or `process.env.TOKEN_DEV` if token isn't provided */
    async start(token?: string): Promise<string | null>;
    async start(preHook?: (client: Vimcord) => any): Promise<string | null>;
    async start(token?: string, preHook?: (client: Vimcord) => any): Promise<string | null>;
    async start(
        tokenOrPreHook?: string | ((client: Vimcord) => any),
        preHook?: (client: Vimcord) => any
    ): Promise<string | null> {
        if (this.clientStartingPromise) return this.clientStartingPromise;

        const main = async () => {
            let token = typeof tokenOrPreHook === "string" ? tokenOrPreHook : undefined;
            token ??= this.config.app.devMode ? process.env.TOKEN_DEV : process.env.TOKEN;

            if (!token) {
                throw new Error(
                    `TOKEN Missing: ${this.config.app.devMode ? "devMode is enabled, but TOKEN_DEV is not set" : "TOKEN not set"}`
                );
            }

            // Build the client
            await this.build();

            try {
                // Run the pre-hook
                if (typeof tokenOrPreHook === "function") {
                    await tokenOrPreHook(this);
                } else {
                    await preHook?.(this as Vimcord<true>);
                }

                const stopLoader = this.logger.loader("Connecting to Discord...");
                const loginResult = await retryExponentialBackoff(
                    () => super.login(token),
                    this.features.loginAttempts ?? 3,
                    1_000
                );
                stopLoader("Connected to Discord    ");
                this.config.app.verbose && this.logger.debug("⏳ Waiting for ready...");
                return loginResult;
            } catch (err) {
                this.logger.error(
                    `Failed to log into Discord after ${this.features.loginAttempts} attempt(s))`,
                    err as Error
                );
                return null;
            } finally {
                this.clientStartingPromise = null;
            }
        };

        this.clientStartingPromise = main();
        return this.clientStartingPromise;
    }

    async kill() {
        await super.destroy();
        const idx = clientInstances.indexOf(this);
        if (idx >= 0) clientInstances.splice(idx, 1);
        this.logger.debug("🚪 Logged out of Discord");
    }

    /** Shortcut for {@link fetchUser tools.fetchUser} */
    async fetchUser(id: string | undefined | null): Promise<User | null> {
        const client = await this.whenReady();
        return fetchUser(client, id);
    }

    /** Shortcut for {@link fetchGuild tools.fetchGuild} */
    async fetchGuild(id: string | undefined | null): Promise<Guild | null> {
        const client = await this.whenReady();
        return fetchGuild(client, id);
    }
}

const defaultPrefixCommandHandler = new EventBuilder({
    event: "messageCreate",
    name: "PrefixCommandHandler",
    async execute(client, message) {
        if (message.author.bot || !message.guild) return;

        const config = client.config.prefixCommands;

        // 1. Resolve the active prefix for this guild
        let activePrefix = config.defaultPrefix;

        if (config.guildPrefixResolver) {
            try {
                const customPrefix = await config.guildPrefixResolver(client, message.guild.id);
                if (customPrefix) activePrefix = customPrefix;
            } catch (err) {
                client.logger.error(`Error in guildPrefixResolver for guild ${message.guild.id}:`, err as Error);
                // Fallback to defaultPrefix on error
            }
        }

        let prefixUsed: string | undefined;

        // 2. Determine if a valid prefix was used (Custom/Default vs Mention)
        if (message.content.startsWith(activePrefix)) {
            prefixUsed = activePrefix;
        } else if (config.allowMentionAsPrefix) {
            const mention = userMention(client.user.id);
            if (message.content.startsWith(mention)) {
                prefixUsed = message.content.startsWith(`${mention} `) ? `${mention} ` : mention;
            }
        }

        if (!prefixUsed) return;

        // 3. Extract trigger and raw arguments
        const contentWithoutPrefix = message.content.slice(prefixUsed.length).trim();
        const args = contentWithoutPrefix.split(/\s+/);
        const trigger = args.shift();

        if (!trigger) return;

        // 4. Resolve the builder
        const command = client.commands.prefix.resolve(trigger);
        if (!command) return;

        // 5. Cleanup content and Run
        message.content = args.join(" ");

        try {
            return await command.run(client, client, message);
        } catch (err) {
            await sendCommandErrorEmbed(client, err as Error, message.guild, message);
            throw err;
        }
    }
});

const defaultSlashCommandHandler = new EventBuilder({
    event: "interactionCreate",
    name: "SlashCommandHandler",
    async execute(client, interaction) {
        // 1. Ensure it's a Chat Input (Slash) command
        if (!interaction.isChatInputCommand()) return;

        // 2. Fetch the builder from our refactored manager
        const command = client.commands.slash.get(interaction.commandName);

        // 3. Handle unknown commands
        if (!command) {
            const content = `**/\`${interaction.commandName}\`** is not a registered command.`;

            // Safety check: if the interaction was somehow already deferred/replied
            if (interaction.replied || interaction.deferred) {
                return interaction.followUp({ content, flags: "Ephemeral" });
            }
            return interaction.reply({ content, flags: "Ephemeral" });
        }

        try {
            return await command.run(client, client, interaction);
        } catch (err) {
            await sendCommandErrorEmbed(client, err as Error, interaction.guild, interaction);
            throw err;
        }
    }
});

const defaultContextCommandHandler = new EventBuilder({
    event: "interactionCreate",
    name: "ContextCommandHandler",
    async execute(client, interaction) {
        // 1. Ensure it is a Context Menu interaction (User or Message)
        if (!interaction.isContextMenuCommand()) return;

        // 2. Resolve the builder from our Context Manager
        const command = client.commands.context.get(interaction.commandName);

        // 3. Handle unknown context commands
        if (!command) {
            const content = `**${interaction.commandName}** is not a registered context command.`;

            // Standard safety check for deferred/replied states
            if (interaction.replied || interaction.deferred) {
                return interaction.followUp({ content, flags: "Ephemeral" });
            }
            return interaction.reply({ content, flags: "Ephemeral" });
        }

        try {
            return await command.run(client, client, interaction);
        } catch (err) {
            await sendCommandErrorEmbed(client, err as Error, interaction.guild, interaction);
            throw err;
        }
    }
});
