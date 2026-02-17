import { CommandManager } from "@/modules/command.manager";
import { EventManager } from "@/modules/event.manager";
import { StatusManager } from "@/modules/status.manager";
import { DatabaseManager } from "@/types/database";
import { VimcordCLI } from "@/utils/VimcordCLI";
import { Client, ClientOptions } from "discord.js";
import { configDotenv } from "dotenv";
import { randomUUID } from "node:crypto";
import { PartialDeep } from "type-fest";
import { clientLoggerFactory } from "./client.logger";
import { AppModuleImports, VimcordConfig, VimcordFeatures } from "./client.types";
import { configSetters as configCreators, createVimcordConfig, moduleImporters } from "./client.utils";

export class Vimcord<Ready extends boolean = boolean> extends Client<Ready> {
    static instances = new Map<number, Vimcord>();
    private clientStartingPromise: Promise<string | null> | null = null;

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

    constructor(options: ClientOptions, features: VimcordFeatures = {}, config: PartialDeep<VimcordConfig> = {}) {
        super(options);

        // Configure dotenv immediately, if enabled
        if (features.useEnv) {
            if (typeof features.useEnv === "object") {
                configDotenv({ quiet: true, ...features.useEnv });
            } else {
                configDotenv({ quiet: true });
            }
        }

        this.clientOptions = options;
        this.features = features;
        this.config = createVimcordConfig(config);

        /* - - - - - { Features } - - - - - */
        // Configure default error handlers
        if (this.features.useGlobalErrorHandlers) {
            process.on("uncaughtException", err => this.logger.error("Uncaught Exception", err));
            process.on("unhandledRejection", err => this.logger.error("Unhandled Rejection", err as Error));
            process.on("exit", code => this.logger.debug(`Process exited with code ${code}`));
            this.on("error", err => this.logger.error("Client Error", err));
            this.on("shardError", err => this.logger.error("Client Shard Error", err));
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

    // prettier-ignore
    get $name() { return this.config.app.name; }
    // prettier-ignore
    set $name(name: string) { this.config.app.name = name; }

    // prettier-ignore
    get $version() { return this.config.app.version; }
    // prettier-ignore
    set $version(version: string) { this.config.app.version = version; }

    // prettier-ignore
    get $devMode() { return this.config.app.devMode; }
    // prettier-ignore
    set $devMode(mode: boolean) { this.config.app.devMode = mode; }

    // prettier-ignore
    get $verboseMode() { return this.config.app.verbose; }
    // prettier-ignore
    set $verboseMode(mode: boolean) { this.config.app.verbose = mode; }

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

    /**
     * Imports modules into the client.
     * @param type The type of modules to import.
     * @param options The options to import the module with.
     * @param set Replaces already imported modules with the ones found.
     */
    importModules<T extends keyof AppModuleImports>(type: T, options: AppModuleImports[T], set?: boolean): this {
        moduleImporters[type](this, options, set);
        return this;
    }
}

// const client = new Vimcord({ intents: [] });
// client.configure("app", {});
// client.importModules("events", { dir: [""], suffix: ".ev" });
