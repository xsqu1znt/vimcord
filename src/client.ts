import { Client, ClientOptions, Guild, User } from "discord.js";
import dotEnv, { DotenvConfigOptions } from "dotenv";

import { DatabaseManager } from "@ctypes/database";
import { PartialDeep } from "type-fest";

import { globalToolsConfig } from "@configs/tools.config";
import { createAppConfig, AppConfig } from "@/configs/app.config";
import { createStaffConfig, StaffConfig } from "@configs/staff.config";
import { createSlashCommandConfig, SlashCommandConfig } from "@configs/slashCommand.config";
import { createPrefixCommandConfig, PrefixCommandConfig } from "@configs/prefixCommand.config";
import { createContextCommandConfig, ContextCommandConfig } from "@configs/contextCommand.config";

import { BUILTIN_SlashCommandHandler } from "@/modules/builtins/builtin.slashCommandHandler";
import { BUILTIN_PrefixCommandHandler } from "@/modules/builtins/builtin.prefixCommandHandler";
import { BUILTIN_ContextCommandHandler } from "@/modules/builtins/builtin.contextCommandHandler";

import { StatusManager } from "@/modules/status.manager";
import { CommandManager } from "@modules/command.manager";
import { EventManager } from "@modules/event.manager";

import { sendCommandErrorEmbed } from "@utils/sendCommandErrorEmbed";
import { fetchGuild, fetchUser } from "./tools/utils";
import { BetterEmbed } from "./tools/BetterEmbed";
import { version } from "../package.json";
import { randomUUID } from "node:crypto";
import { Logger } from "./tools/Logger";
import { $ } from "qznt";
import * as VimcordCLI from "@utils/VimcordCLI";
import chalk from "chalk";

export interface CommandErrorMessageConfig {
    /** Use a custom embed */
    embed?: (embed: BetterEmbed, error: Error, guild: Guild | null | undefined) => BetterEmbed;
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

    /** Update the state of {@link globalToolsConfig.devMode} whenever {@link AppConfig.devMode} is updated in the client. This is mainly useful for {@link BetterEmbed} to switch between devMode and production colors during runtime without having to update the global config manually @defaultValue `false` */
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
    app: AppConfig;
    staff: StaffConfig;
    slashCommands: SlashCommandConfig;
    prefixCommands: PrefixCommandConfig;
    contextCommands: ContextCommandConfig;
}

export class Vimcord<Ready extends boolean = boolean> extends Client<Ready> {
    static instances = new Map<number, Vimcord>();

    readonly uuid: string = randomUUID();
    readonly clientId: number = Vimcord.instances.size;

    readonly clientOptions: ClientOptions;
    readonly features: VimcordFeatures;
    readonly config: VimcordConfig;

    readonly status: StatusManager;
    readonly events: EventManager;
    readonly commands: CommandManager;
    db?: DatabaseManager;

    // Configure custom logger
    logger = new Logger({ prefixEmoji: "⚡", prefix: `vimcord (i${this.clientId})` }).extend({
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
                        `  # Powered by Vimcord v${version}`.padEnd(50 - 3 - `${client.clientId}`.length)
                    ) +
                    chalk.hex(this.colors.primary)(`${chalk.hex(this.colors.muted)(`i${client.clientId}`)}  ║`)
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

        this.config = {
            app: createAppConfig(config.app),
            staff: createStaffConfig(config.staff),
            slashCommands: createSlashCommandConfig(config.slashCommands),
            prefixCommands: createPrefixCommandConfig(config.prefixCommands),
            contextCommands: createContextCommandConfig(config.contextCommands)
        };

        // Configure the status manager
        this.status = new StatusManager(this);
        // Configure the event manager
        this.events = new EventManager(this);
        // Configure the command manager
        this.commands = new CommandManager(this);

        /* - - - - - { Client } - - - - - */
        this.logger.clientBanner(this);

        // Handle client ready
        this.once("clientReady", client => {
            this.logger.clientReady(client.user.tag, client.guilds.cache.size);
        });

        // Add to global instances
        Vimcord.instances.set(this.clientId, this);

        // Initialize the VimcordCLI
        VimcordCLI.initCLI();
    }

    /** Returns the options, features, and config of this client. */
    toJSON() {
        return {
            options: this.clientOptions,
            features: this.features,
            config: this.config
        };
    }

    /** Makes a clone of this client. */
    clone() {
        const { options, features, config } = this.toJSON();
        return new Vimcord(options, features, config);
    }

    configureApp(options: PartialDeep<AppConfig> = {}) {
        this.config.app = createAppConfig(options);
        if (this.features.hookToolsDevMode) {
            globalToolsConfig.devMode = this.config.app.devMode;
        }
        return this;
    }

    configureStaff(options: PartialDeep<StaffConfig> = {}) {
        this.config.staff = createStaffConfig(options);
        return this;
    }

    configureSlashCommands(options: PartialDeep<SlashCommandConfig> = {}) {
        this.config.slashCommands = createSlashCommandConfig(options);
        return this;
    }

    configurePrefixCommands(options: PartialDeep<PrefixCommandConfig> = {}) {
        this.config.prefixCommands = createPrefixCommandConfig(options);
        return this;
    }

    configureContextCommands(options: PartialDeep<ContextCommandConfig> = {}) {
        this.config.contextCommands = createContextCommandConfig(options);
        return this;
    }

    async importEventModules(dir: string | string[], replaceAll?: boolean) {
        await this.events.importFrom(dir, replaceAll);
        return this;
    }

    async importSlashCommandModules(dir: string | string[], replaceAll?: boolean) {
        await this.commands.slash.importFrom(dir, replaceAll);
        return this;
    }

    async importPrefixCommandModules(dir: string | string[], replaceAll?: boolean) {
        await this.commands.prefix.importFrom(dir, replaceAll);
        return this;
    }

    async importContextCommandModules(dir: string | string[], replaceAll?: boolean) {
        await this.commands.context.importFrom(dir, replaceAll);
        return this;
    }

    async useDatabase(db: DatabaseManager): Promise<boolean> {
        this.db = db;
        this.logger.database("Using", db.moduleName);
        return this.db.connect();
    }

    async waitForReady(): Promise<Vimcord<true>> {
        if (this.isReady()) return this as Vimcord<true>;

        return new Promise((resolve, reject) => {
            // Force timeout after 1 minute
            const timeout = setTimeout(
                () => reject(new Error(`Client (i${this.clientId}) timed out waiting for ready`)),
                60_000
            );

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
                importModules.events && this.importEventModules(importModules.events),
                importModules.slashCommands && this.importSlashCommandModules(importModules.slashCommands),
                importModules.prefixCommands && this.importPrefixCommandModules(importModules.prefixCommands),
                importModules.contextCommands && this.importContextCommandModules(importModules.contextCommands)
            ]);
        }

        // Configure default slash command handler
        if (this.features.useDefaultSlashCommandHandler) {
            this.events.register(BUILTIN_SlashCommandHandler);
        }

        // Configure default context command handler
        if (this.features.useDefaultContextCommandHandler) {
            this.events.register(BUILTIN_ContextCommandHandler);
        }

        // Configure default prefix command handler
        if (this.features.useDefaultPrefixCommandHandler) {
            this.events.register(BUILTIN_PrefixCommandHandler);
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
                const loginResult = await $.async.retry(() => super.login(token), this.features.loginAttempts ?? 3, 1_000);
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
        Vimcord.instances.delete(this.clientId);
        this.logger.debug("🚪 Logged out of Discord");
    }

    /** Shortcut for {@link fetchUser tools.fetchUser} */
    async fetchUser(id: string | undefined | null): Promise<User | null> {
        const client = await this.waitForReady();
        return fetchUser(client, id);
    }

    /** Shortcut for {@link fetchGuild tools.fetchGuild} */
    async fetchGuild(id: string | undefined | null): Promise<Guild | null> {
        const client = await this.waitForReady();
        return fetchGuild(client, id);
    }
}
