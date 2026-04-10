import type { ClientOptions } from "discord.js";
import type { PartialDeep } from "@vimcord/internal";
import type { LogLevel } from "@vimcord/logger";
import type { CommandHooks } from "@/commands/hooks.js";
import type { VimcordPlugin } from "@/plugins/Plugin.js";
import type { VimcordFeatures } from "./features.js";
import type { AppOptions, StaffOptions } from "./options.js";

import { EventEmitter } from "node:stream";
import { Client } from "discord.js";
import { createHumanId, mergeDeep } from "@vimcord/internal";
import { PluginManager } from "@/plugins/PluginManager.js";
import { VimcordLogger, vimcordLogger } from "./logger.js";
import { defaultAppOptions, defaultStaffOptions } from "./options.js";

export type VimcordEvents = {
    /** Returns the new Vimcord instance. */
    create: [Vimcord];
    /** Returns clientId. */
    destroy: [string];
    /** Returns the Vimcord instance. */
    ready: [Vimcord];
};

interface VimcordOptions {
    /** App options. */
    app?: PartialDeep<AppOptions>;
    /** Staff options. */
    staff?: PartialDeep<StaffOptions>;
    /** Command hooks. */
    hooks?: CommandHooks;
}

export interface VimcordClientOptions extends ClientOptions, VimcordOptions {
    /** Custom client id. Otherwise powered by [human-id](https://www.npmjs.com/package/human-id). */
    customId?: string;

    /** Vimcord features. */
    features?: VimcordFeatures;

    // --- Debugging ---
    /** Minimum console logging level. */
    logLevel?: LogLevel;
    /** Enable verbose logging. */
    verbose?: boolean;
}

// TODO: Add jsDoc and implement client options?
export class Vimcord extends Client {
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

    private plugins = new PluginManager();

    private appOptions: AppOptions;
    private staffOptions: StaffOptions;
    private djsOptions: ClientOptions;
    private features: VimcordFeatures;
    hooks: CommandHooks;

    constructor(options: VimcordClientOptions) {
        const {
            customId,

            app,
            staff,
            features,
            hooks,

            // --- Debugging ---
            logLevel = "debug",
            verbose = false,

            ...djsOptions
        } = options;

        super(djsOptions);

        this.logger.setLevel(logLevel);
        this.logger.setVerbose(verbose);

        this.id = customId ?? createHumanId();

        this.appOptions = mergeDeep(defaultAppOptions(), app);
        this.staffOptions = mergeDeep(defaultStaffOptions(), staff);
        this.djsOptions = djsOptions;
        this.features = features ?? {};
        this.hooks = hooks ?? {};

        Vimcord.$instances.set(this.id, this);
        Vimcord.$events.emit("create", this);

        this.once("clientReady", client => {
            Vimcord.$events.emit("ready", this);
        });
    }

    // --- Shorthand Access ---
    /** Current app name. */
    get $name() {
        return this.appOptions.name;
    }
    set $name(name: string) {
        this.appOptions.name = name;
    }

    /** Current app version. */
    get $version() {
        return this.appOptions.version;
    }
    set $version(version: string) {
        this.appOptions.version = version;
    }

    /** Current dev mode state. */
    get $devMode() {
        return this.appOptions.devMode;
    }
    set $devMode(mode: boolean) {
        this.appOptions.devMode = mode;
    }

    /** Current verbose mode state. */
    get $verboseMode() {
        return this.appOptions.verbose;
    }
    set $verboseMode(mode: boolean) {
        this.appOptions.verbose = mode;
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
     * Modifies special client options.
     * @param options The options to set
     */
    configure(options: VimcordOptions): this {
        this.appOptions = mergeDeep(this.appOptions, options.app);
        this.staffOptions = mergeDeep(this.staffOptions, options.staff);
        this.hooks = mergeDeep(this.hooks, options.hooks);
        return this;
    }

    /** Serializes the Vimcord client options. */
    toOptions(): VimcordClientOptions {
        return {
            ...this.djsOptions,
            customId: this.id,
            logLevel: this.logger.options.minLevel,
            verbose: this.logger.options.verbose,
            app: this.appOptions,
            staff: this.staffOptions,
            features: this.features,
            hooks: this.hooks
        };
    }

    /** Makes a clone of this client. */
    clone(): Vimcord {
        return new Vimcord(this.toOptions());
    }

    override async destroy(): Promise<void> {
        await this.destroy();
        Vimcord.$instances.delete(this.id);
        Vimcord.$events.emit("destroy", this.id);
    }
}
