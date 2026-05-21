import type { ClientOptions } from "discord.js";
import type { PartialDeep } from "@vimcord/internal";
import type { LogLevel } from "@vimcord/logger";
import type { VimcordPlugin } from "@/plugins/Plugin.js";
import type { VimcordFeatures } from "./features.js";
import type { VimcordGlobals } from "./globals.js";

import { EventEmitter } from "node:stream";
import { Client } from "discord.js";
import { createHumanId, mergeDeep, VimcordError } from "@vimcord/internal";
import { ModuleManager } from "@/client/managers/ModuleManager.js";
import { PluginManager } from "@/plugins/index.js";
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
    readonly features: VimcordFeatures;
    readonly globals: VimcordGlobals;

    readonly plugins: PluginManager;
    readonly modules: ModuleManager;

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

        this.id = customId ?? createHumanId();

        this.client = client;
        this.features = features;
        this.globals = {
            app: mergeDeep(defaultAppGlobals(), globals?.app),
            staff: mergeDeep(defaultStaffGlobals(), globals?.staff)
        };

        this.$verboseMode = verbose;
        this.logger.setLevel(logLevel);
        this.logger.setVerbose(this.$verboseMode);

        this.plugins = new PluginManager(this);
        this.modules = new ModuleManager(this);

        Vimcord.$instances.set(this.id, this);
        Vimcord.$events.emit("create", this);

        this.once("clientReady", () => {
            Vimcord.$events.emit("ready", this);
            this.resolveStartupBanner?.();
            this.logger.clientReady(this as Vimcord<true>);
        });
    }

    // --- Getter/Setter Aliases ---
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
    /**
     * Registers a plugin. Alias for `client.plugins.use`.
     * @param plugin The plugin to register.
     */
    use(plugin: VimcordPlugin): this {
        this.plugins.use(plugin);
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
     * @param globals The options to set.
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

    // --- Main ---
    /**
     * Loads plugins and modules then logs in to Discord.
     * @param token The token to log in with.
     */
    override async login(token?: string): Promise<string> {
        try {
            const { setLoader, resolveBanner } = this.logger.startupBanner(this);
            this.resolveStartupBanner = resolveBanner;

            setLoader("Loading plugins and modules...");
            await this.plugins.load();
            await this.modules.load();

            token ??= this.$devMode ? process.env.TOKEN_DEV : process.env.TOKEN;
            if (!token) {
                throw new Error(
                    `TOKEN Missing; ${this.$devMode ? "devMode is enabled, but TOKEN_DEV is not set" : "TOKEN not set"}`
                );
            }

            setLoader("Logging in to Discord...");
            const result = await super.login(token);
            setLoader("Waiting for the client to be ready...");

            return result;
        } catch (err) {
            throw new VimcordError(`Failed to login\n╰ ${(err as Error).message}`, "CLIENT_ERROR");
        }
    }

    /** Unloads modules and plugins then destroys the client. */
    override async destroy(): Promise<void> {
        this.modules.unload();
        await this.plugins.unload();
        await super.destroy();
        Vimcord.$instances.delete(this.id);
        Vimcord.$events.emit("destroy", this.id);
    }
}
