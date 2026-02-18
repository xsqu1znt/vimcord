import { contextCommandHandler } from "@/modules/builtins/contextCommand.builtin";
import { prefixCommandHandler } from "@/modules/builtins/prefixCommand.builtin";
import { slashCommandHandler } from "@/modules/builtins/slashCommand.builtin";
import { CommandManager } from "@/modules/command.manager";
import { EventManager } from "@/modules/event.manager";
import { StatusManager } from "@/modules/status.manager";
import { fetchGuild, fetchUser } from "@/tools/utils";
import { DatabaseManager } from "@/types/database";
import { VimcordCLI } from "@/client/vimcord.cli";
import { Client, ClientOptions } from "discord.js";
import { configDotenv, DotenvConfigOptions } from "dotenv";
import { randomUUID } from "node:crypto";
import EventEmitter from "node:events";
import { $ } from "qznt";
import { PartialDeep } from "@/types/helpers";
import { ErrorHandler } from "./vimcord.errorHandler";
import { clientLoggerFactory } from "./vimcord.logger";
import { AppModuleImports, VimcordConfig, VimcordCreateConfig, VimcordFeatures } from "./vimcord.types";
import { configSetters as configCreators, defineVimcordConfig, moduleImporters } from "./vimcord.utils";

export class Vimcord<Ready extends boolean = boolean> extends Client<Ready> {
    static instances = new Map<number, Vimcord>();
    private static emitter = new EventEmitter<{ ready: [Vimcord] }>();
    private clientStartingPromise: Promise<string | null> | null = null;

    static create(options: ClientOptions, features?: VimcordFeatures, config?: PartialDeep<VimcordConfig>): Vimcord;
    static create(config: VimcordCreateConfig): Vimcord;
    static create(
        optionsOrConfig: ClientOptions | VimcordCreateConfig,
        features?: VimcordFeatures,
        config?: PartialDeep<VimcordConfig>
    ): Vimcord {
        if ("options" in optionsOrConfig) {
            const { options, features, config } = optionsOrConfig;
            return new Vimcord(options, features, config);
        } else {
            return new Vimcord(optionsOrConfig, features, config);
        }
    }

    /**
     * Returns an instance of Vimcord.
     * @param clientId [default: 0]
     */
    static getInstance(clientId?: number): Vimcord | undefined {
        if (clientId === undefined) {
            return Vimcord.instances.values().next().value;
        }
        return Vimcord.instances.get(clientId);
    }

    /**
     * Waits for a Vimcord instance to be ready.
     * @param clientId [default: 0]
     * @param timeoutMs [default: 60000]
     */
    static async getReadyInstance(clientId?: number, timeoutMs: number = 60_000): Promise<Vimcord<true>> {
        const client = Vimcord.getInstance(clientId);

        if (client?.isReady()) {
            Vimcord.emitter.emit("ready", client);
            return client as Vimcord<true>;
        }

        if (client) {
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    Vimcord.emitter.off("ready", listener);
                    reject(new Error(`Client (i${clientId ?? 0}) timed out waiting for ready`));
                }, timeoutMs);

                const listener = (c: Vimcord) => {
                    if (c.clientId === (clientId ?? 0)) {
                        clearTimeout(timeout);
                        Vimcord.emitter.off("ready", listener);
                        resolve(c as Vimcord<true>);
                    }
                };

                client.once("clientReady", () => {
                    clearTimeout(timeout);
                    Vimcord.emitter.emit("ready", client);
                    resolve(client as Vimcord<true>);
                });
            });
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                Vimcord.emitter.off("ready", listener);
                reject(new Error(`Vimcord instance (i${clientId ?? 0}) failed to initialize within ${timeoutMs / 1000}s.`));
            }, timeoutMs);

            const listener = (c: Vimcord) => {
                if (c.clientId === (clientId ?? 0)) {
                    clearTimeout(timeout);
                    Vimcord.emitter.off("ready", listener);
                    resolve(c as Vimcord<true>);
                }
            };

            Vimcord.emitter.on("ready", listener);
        });
    }

    readonly uuid: string = randomUUID();
    readonly clientId: number = Vimcord.instances.size;

    readonly clientOptions: ClientOptions;
    readonly features: VimcordFeatures;
    readonly config: VimcordConfig;

    readonly status: StatusManager;
    readonly events: EventManager;
    readonly commands: CommandManager;
    db?: DatabaseManager;

    readonly logger = clientLoggerFactory(this);
    readonly error: ErrorHandler;

    constructor(options: ClientOptions, features: VimcordFeatures = {}, config: PartialDeep<VimcordConfig> = {}) {
        super(options);

        this.clientOptions = options;
        this.features = features;
        this.config = defineVimcordConfig(config);

        // Initialize error handler
        this.error = new ErrorHandler(this);

        /* - - - - - { Features } - - - - - */
        // Configure default error handlers
        if (this.features.useGlobalErrorHandlers) {
            this.error.setupGlobalHandlers();
        }

        /* - - - - - { Initialize } - - - - - */
        // Configure the status manager
        this.status = new StatusManager(this);
        // Configure the event manager
        this.events = new EventManager(this);
        // Configure the command manager
        this.commands = new CommandManager(this);

        /* - - - - - { Client } - - - - - */
        this.logger.clientBanner(this);

        // Log client ready
        this.once("clientReady", client => this.logger.clientReady(client.user.tag, client.guilds.cache.size));

        // Add to global instances
        Vimcord.instances.set(this.clientId, this);

        // Initialize the VimcordCLI
        if (this.config.app.enableCLI) {
            VimcordCLI.setMode("on");
        }
    }

    /** Current app name */
    // prettier-ignore
    get $name() { return this.config.app.name; }
    // prettier-ignore
    set $name(name: string) { this.config.app.name = name; }

    /** Current app version */
    // prettier-ignore
    get $version() { return this.config.app.version; }
    // prettier-ignore
    set $version(version: string) { this.config.app.version = version; }

    /** Current dev mode state */
    // prettier-ignore
    get $devMode() { return this.config.app.devMode; }
    // prettier-ignore
    set $devMode(mode: boolean) { this.config.app.devMode = mode; }

    /** Current verbose mode state */
    // prettier-ignore
    get $verboseMode() { return this.config.app.verbose; }
    // prettier-ignore
    set $verboseMode(mode: boolean) { this.config.app.verbose = mode; }

    /** Returns the options, features, and config of this client. */
    toJSON() {
        return { options: this.clientOptions, features: this.features, config: this.config };
    }

    /** Makes a clone of this client. */
    clone(): Vimcord {
        const { options, features, config } = this.toJSON();
        return new Vimcord(options, features, config);
    }

    /**
     * Modifies a client config.
     * @param type The type of config to modify.
     * @param options The options to set for the config.
     */
    configure<T extends keyof VimcordConfig>(
        type: T,
        options: PartialDeep<VimcordConfig[T]> = {} as PartialDeep<VimcordConfig[T]>
    ): this {
        this.config[type] = configCreators[type](options, this.config[type]) as VimcordConfig[T];
        return this;
    }

    /** Builds the client by importing modules and registering builtin handlers. */
    async build(): Promise<this> {
        this.configure("app", this.config.app);
        this.configure("staff", this.config.staff);
        this.configure("slashCommands", this.config.slashCommands);
        this.configure("prefixCommands", this.config.prefixCommands);
        this.configure("contextCommands", this.config.contextCommands);

        if (this.features.importModules) {
            const importModules = this.features.importModules;

            await Promise.all([
                importModules.events && this.importModules("events", importModules.events),
                importModules.slashCommands && this.importModules("slashCommands", importModules.slashCommands),
                importModules.prefixCommands && this.importModules("prefixCommands", importModules.prefixCommands),
                importModules.contextCommands && this.importModules("contextCommands", importModules.contextCommands)
            ]);
        }

        if (this.features.useDefaultSlashCommandHandler) {
            this.events.register(slashCommandHandler);
        }

        if (this.features.useDefaultContextCommandHandler) {
            this.events.register(contextCommandHandler);
        }

        if (this.features.useDefaultPrefixCommandHandler) {
            this.events.register(prefixCommandHandler);
        }

        return this;
    }

    /**
     * Imports modules into the client.
     * @param type The type of modules to import.
     * @param options The options to import the module with.
     * @param set Replaces already imported modules with the ones found.
     */
    async importModules<T extends keyof AppModuleImports>(
        type: T,
        options: AppModuleImports[T],
        set?: boolean
    ): Promise<this> {
        await moduleImporters[type](this, options, set);
        return this;
    }

    /**
     * Allows Vimcord to handle environment variables using [dotenv](https://www.npmjs.com/package/dotenv).
     * @param options Options for dotenv
     * @see https://www.npmjs.com/package/dotenv
     */
    useEnv(options?: DotenvConfigOptions): this {
        this.logger.database("Using", "dotenv");
        configDotenv({ quiet: true, ...options });
        return this;
    }

    /**
     * Connects to a database.
     * @param db The database manager to use.
     */
    async useDatabase(db: DatabaseManager): Promise<boolean> {
        this.db = db;
        this.logger.database("Using", db.moduleName);
        return this.db.connect();
    }

    /**
     * Fetches a user from the client, checking the cache first.
     * @param userId The ID of the user to fetch.
     */
    async fetchUser(userId: string | undefined | null) {
        const client = await Vimcord.getReadyInstance(this.clientId);
        return fetchUser(client, userId);
    }

    /**
     * Fetches a guild from the client, checking the cache first.
     * @param guildId The ID of the guild to fetch.
     */
    async fetchGuild(guildId: string | undefined | null) {
        const client = await Vimcord.getReadyInstance(this.clientId);
        return fetchGuild(client, guildId);
    }

    /**
     * Starts the client and connects to Discord.
     * Automatically uses `process.env.TOKEN` or `process.env.TOKEN_DEV` if token isn't provided.
     * @param token The Discord bot token.
     * @param callback Runs after logging in.
     */
    async start(token?: string): Promise<string | null>;
    async start(callback?: (client: Vimcord) => unknown): Promise<string | null>;
    async start(token?: string, callback?: (client: Vimcord) => unknown): Promise<string | null>;
    async start(
        tokenOrPreHook?: string | ((client: Vimcord) => unknown),
        callback?: (client: Vimcord) => unknown
    ): Promise<string | null> {
        if (this.clientStartingPromise) return this.clientStartingPromise;

        const execute = async () => {
            let token = typeof tokenOrPreHook === "string" ? tokenOrPreHook : undefined;
            token ??= this.$devMode ? process.env.TOKEN_DEV : process.env.TOKEN;

            if (!token) {
                throw new Error(
                    `TOKEN Missing: ${this.$devMode ? "devMode is enabled, but TOKEN_DEV is not set" : "TOKEN not set"}`
                );
            }

            await this.build();

            try {
                const stopLoader = this.logger.loader("Connecting to Discord...");
                const loginResult = await $.async.retry(() => super.login(token), {
                    retries: this.features.maxLoginAttempts ?? 3,
                    delay: 1_000
                });
                stopLoader("Connected to Discord    ");
                this.$verboseMode && this.logger.debug("Waiting for ready...");

                if (typeof tokenOrPreHook === "function") {
                    await tokenOrPreHook(this);
                } else {
                    await callback?.(this as Vimcord<true>);
                }

                return loginResult;
            } catch (err) {
                this.logger.error(
                    `Failed to log into Discord after ${this.features.maxLoginAttempts} attempt(s)`,
                    err as Error
                );
                return null;
            } finally {
                this.clientStartingPromise = null;
            }
        };

        this.clientStartingPromise = execute();
        return this.clientStartingPromise;
    }

    /** Destroys the client and disconnects from Discord. */
    async kill(): Promise<void> {
        await super.destroy();
        Vimcord.instances.delete(this.clientId);
        this.logger.debug("Logged out of Discord");
    }
}
