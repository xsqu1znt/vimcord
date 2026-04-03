import type { ClientOptions } from "discord.js";
import type { PartialDeep } from "@vimcord/internal";
import type { CommandHooks } from "@/commands/hooks.js";
import type { VimcordPlugin } from "@/plugins/Plugin.js";
import type { VimcordFeatures } from "./features.js";
import type { AppOptions, StaffOptions } from "./options.js";

import { Client } from "discord.js";
import { mergeDeep } from "@vimcord/internal";
import { PluginManager } from "@/plugins/PluginManager.js";
import { defaultAppOptions, defaultStaffOptions } from "./options.js";

interface VimcordOptions {
    /** App options. */
    app?: PartialDeep<AppOptions>;
    /** Staff options. */
    staff?: PartialDeep<StaffOptions>;
    /** Command hooks. */
    hooks?: CommandHooks;
}

export interface VimcordClientOptions extends ClientOptions, VimcordOptions {
    /** Vimcord features. */
    features?: VimcordFeatures;
}

export class Vimcord extends Client {
    private pluginManager = new PluginManager();

    private appOptions: AppOptions;
    private staffOptions: StaffOptions;
    private djsOptions: ClientOptions;
    private features: VimcordFeatures;
    hooks: CommandHooks;

    constructor(options: VimcordClientOptions) {
        const { app, staff, features, hooks, ...djsOptions } = options;
        super(djsOptions);

        this.appOptions = mergeDeep(defaultAppOptions(), app);
        this.staffOptions = mergeDeep(defaultStaffOptions(), staff);
        this.djsOptions = djsOptions;
        this.features = features ?? {};
        this.hooks = hooks ?? {};
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
        await this.pluginManager.use(plugin, this);
        return this;
    }

    getPlugin(name: string): VimcordPlugin | undefined {
        return this.pluginManager.get(name);
    }

    async removePlugin(name: string): Promise<this> {
        await this.pluginManager.remove(name, this);
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
}
