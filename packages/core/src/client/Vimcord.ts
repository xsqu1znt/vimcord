import type { ClientOptions } from "discord.js";
import type { PartialDeep } from "@vimcord/internal";
import type { LogLevel } from "@vimcord/logger";
import type { CommandModuleHooks } from "@/abstracts/AbstractCommandModule.js";
import type { VimcordPlugin } from "@/plugins/Plugin.js";
import type { VimcordFeatures } from "./features.js";
import type { VimcordGlobals } from "./globals.js";

import { EventEmitter } from "node:stream";
import { Client } from "discord.js";
import { createHumanId, mergeDeep, VimcordError } from "@vimcord/internal";
import { PluginManager } from "@/plugins/PluginManager.js";
import { defaultAppGlobals, defaultStaffGlobals } from "./globals.js";
import { VimcordLogger, vimcordLogger } from "./logger.js";

export type VimcordEvents = {
    /** Returns the new Vimcord instance. */
    create: [Vimcord];
    /** Returns clientId. */
    destroy: [string];
    /** Returns the Vimcord instance. */
    ready: [Vimcord];
};

export interface VimcordClientOptions {
    /** Custom client id. Otherwise powered by [human-id](https://www.npmjs.com/package/human-id). */
    customId?: string;

    /** Discord.js client options. */
    client: ClientOptions;
    /** Client features. */
    features?: VimcordFeatures;
    /** Global bot configs. */
    globals?: PartialDeep<VimcordGlobals>;

    // --- Debugging ---
    /** Minimum console logging level. */
    logLevel?: LogLevel;
    /** Enable verbose logging. */
    verbose?: boolean;
}

export class Vimcord<Ready extends boolean = boolean> extends Client<Ready> {
    /** Active Vimcord instances. */
    static $instances = new Map<string, Vimcord>();
    /** Global event emitter for Vimcord instances. Use this to listen for Vimcord instance events. */
    static $events = new EventEmitter<VimcordEvents>();

    /**
     * Gets an instance of Vimcord.
     * @param clientId Defaults to the first instance if not provided.
     */
    static getInstance(clientId?: string): Vimcord | undefined {
        if (clientId === undefined) {
            return Vimcord.$instances.values().next().value;
        }
        return Vimcord.$instances.get(clientId);
    }

    readonly id: string;
    readonly logger: VimcordLogger = vimcordLogger;

    private client: ClientOptions;
    private features: VimcordFeatures;
    readonly globals: VimcordGlobals;
    readonly plugins = new PluginManager();

    private awaitReadyPromise: Promise<boolean> | null | undefined;
    private resolveStartupBanner: (() => void) | undefined;

    constructor(options: VimcordClientOptions) {
        const {
            customId,

            client,
            features = {},
            globals,

            // --- Debugging ---
            logLevel = "debug",
            verbose = false
        } = options;

        super(client);

        this.logger.setLevel(logLevel);
        this.logger.setVerbose(verbose);

        this.id = customId ?? createHumanId();

        this.client = client;
        this.features = features;
        this.globals = {
            app: mergeDeep(defaultAppGlobals(), globals?.app),
            staff: mergeDeep(defaultStaffGlobals(), globals?.staff)
        };

        Vimcord.$instances.set(this.id, this);
        Vimcord.$events.emit("create", this);

        this.once("clientReady", () => {
            Vimcord.$events.emit("ready", this);
            this.resolveStartupBanner?.();
            this.logger.clientReady(this as Vimcord<true>);
        });
    }

    // --- Shorthand Access ---
    /** Current app name. */
    get $name() {
        return this.globals.app.name;
    }
    set $name(name: string) {
        this.globals.app.name = name;
    }

    /** Current app version. */
    get $version() {
        return this.globals.app.version;
    }
    set $version(version: string) {
        this.globals.app.version = version;
    }

    /** Current dev mode state. */
    get $devMode() {
        return this.globals.app.devMode;
    }
    set $devMode(mode: boolean) {
        this.globals.app.devMode = mode;
    }

    /** Current verbose mode state. */
    get $verboseMode() {
        return this.globals.app.verbose;
    }
    set $verboseMode(mode: boolean) {
        this.globals.app.verbose = mode;
    }

    // --- Plugins ---
    async use(plugin: VimcordPlugin): Promise<this> {
        await this.plugins.use(plugin, this);
        return this;
    }

    getPlugin(name: string): VimcordPlugin | undefined {
        return this.plugins.get(name);
    }

    async removePlugin(name: string): Promise<this> {
        await this.plugins.remove(name, this);
        return this;
    }

    // --- Utility ---
    /**
     * Waits for the client to be ready.
     * @param timeout `60_000` by default.
     */
    async awaitReady(timeout: number = 60_000): Promise<boolean> {
        if (this.isReady()) return true;
        if (this.awaitReadyPromise) return this.awaitReadyPromise;

        this.awaitReadyPromise = new Promise(resolve => {
            const _timeout = setTimeout(() => {
                this.awaitReadyPromise = null;
                resolve(false);
            }, timeout);

            this.once("clientReady", () => {
                clearTimeout(_timeout);
                this.awaitReadyPromise = null;
                resolve(true);
            });
        });

        return this.awaitReadyPromise;
    }

    /**
     * Configures global client configs.
     * @param globals The options to set
     */
    configure(globals: VimcordGlobals): this {
        this.globals.app = mergeDeep(this.globals.app, globals.app);
        this.globals.staff = mergeDeep(this.globals.staff, globals.staff);
        this.globals.hooks = mergeDeep(this.globals.hooks ?? {}, globals.hooks);
        return this;
    }

    /** Serializes the Vimcord client options. */
    toOptions(): VimcordClientOptions {
        return {
            client: this.client,

            customId: this.id,
            features: this.features,
            globals: this.globals,

            logLevel: this.logger.options.minLevel,
            verbose: this.logger.options.verbose
        };
    }

    /** Makes a clone of this client. */
    clone(options?: VimcordClientOptions): Vimcord {
        return new Vimcord(mergeDeep(this.toOptions(), options));
    }

    override async login(token?: string): Promise<string> {
        token ??= this.$devMode ? process.env.TOKEN_DEV : process.env.TOKEN;
        if (!token) {
            throw new VimcordError(
                `TOKEN Missing: ${this.$devMode ? "devMode is enabled, but TOKEN_DEV is not set" : "TOKEN not set"}`,
                "CLIENT_ERROR"
            );
        }

        try {
            const { setLoader, resolveBanner } = this.logger.startupBanner(this);
            this.resolveStartupBanner = resolveBanner;
            // TODO: Make this wait for modules and plugins to be loaded
            await new Promise(resolve => setTimeout(resolve, 3000));

            setLoader("Logging in to Discord, please wait...");
            const result = await super.login(token);
            setLoader("Waiting for the client to be ready...");

            // this.logger.info("Waiting for the client to be ready...");
            return result;
        } catch (err) {
            throw new VimcordError(`Failed to login: ${err}`, "CLIENT_ERROR");
        }
    }

    override async destroy(): Promise<void> {
        await this.destroy();
        Vimcord.$instances.delete(this.id);
        Vimcord.$events.emit("destroy", this.id);
    }
}
