import type { ClientOptions, FetchGuildOptions, Guild, User, UserResolvable } from "discord.js";
import type { VimcordPlugin } from "@/plugins/Plugin.js";
import type { PartialDeep } from "@/types/helpers.js";
import type { VimcordFeatures } from "./features.js";
import type { VimcordGlobals } from "./globals.js";
import type { VimcordStartupBannerHandle } from "./VimcordLogger.js";

import EventEmitter from "node:events";
import { Client } from "discord.js";
import { syncCLIClient } from "@/cli/clientState.js";
import { ModuleManager } from "@/client/managers/ModuleManager.js";
import { defineGlobalCommandHooks } from "@/commands/commandHooks.js";
import { VimcordError } from "@/errors/VimcordError.js";
import { PluginManager } from "@/plugins/index.js";
import { fetchGuild, fetchUser } from "@/utils/clientUtils.js";
import { mergeDeep } from "@/utils/obj.js";
import { defaultAppGlobals, defaultStaffGlobals } from "./globals.js";
import { StatusManager } from "./StatusManager.js";
import { VimcordLogger } from "./VimcordLogger.js";

export type VimcordEvents = {
    /** Returns the new Vimcord client. */
    create: [Vimcord];
    /** Returns the destroyed Vimcord instance. */
    destroy: [Vimcord];
    /** Returns the ready Vimcord client. */
    ready: [Vimcord];
};

export interface VimcordClientOptions {
    /** Discord.js client options. */
    client: ClientOptions;
    /** Client features. */
    features?: VimcordFeatures;
    /** Global bot configs. */
    globals?: PartialDeep<VimcordGlobals>;
    /** Custom logger instance. A new `VimcordLogger` is created by default. */
    logger?: VimcordLogger;

    // --- Debugging ---
    /** Enables diagnostic `debug()` logging. */
    verbose?: boolean;
}

export class Vimcord<Ready extends boolean = boolean> extends Client<Ready> {
    /** The one live Vimcord client for this process. */
    private static instance: Vimcord | undefined;
    /** Global event emitter for Vimcord client lifecycle events. */
    static $events = new EventEmitter<VimcordEvents>();

    /** Gets the live Vimcord client for this process. */
    static getInstance(): Vimcord | undefined {
        return Vimcord.instance;
    }

    readonly logger: VimcordLogger;

    private client: ClientOptions;
    readonly features: VimcordFeatures;
    readonly globals: VimcordGlobals;

    readonly plugins: PluginManager;
    readonly modules: ModuleManager;
    readonly status: StatusManager;

    private readonly awaitReadyWaiters = new Set<(ready: boolean) => void>();
    private readonly handleAwaitReady = (): void => this.resolveAwaitReady(true);
    private startupBannerHandle: VimcordStartupBannerHandle | undefined;
    private warnedMissingStaffGuild = false;

    constructor(options: VimcordClientOptions) {
        if (Vimcord.instance) throw new VimcordError("Only one Vimcord client can exist in a process", "CLIENT_ERROR");

        const {
            client,
            features = {},
            globals,
            logger,

            // --- Debugging ---
            verbose
        } = options;

        super(client);

        this.client = client;
        this.features = features;
        this.globals = {
            app: mergeDeep(defaultAppGlobals(), globals?.app),
            staff: mergeDeep(defaultStaffGlobals(), globals?.staff),
            hooks: globals?.hooks ? mergeDeep({}, globals.hooks) : undefined
        };

        const verboseMode = verbose ?? globals?.app?.verbose ?? logger?.options.verbose ?? false;
        this.logger = logger ?? new VimcordLogger({ verbose: verboseMode });
        this.$verboseMode = verboseMode;

        this.plugins = new PluginManager(this);
        this.modules = new ModuleManager(this);
        this.status = new StatusManager(this);

        Vimcord.instance = this;
        Vimcord.$events.emit("create", this);

        this.once("clientReady", () => {
            Vimcord.$events.emit("ready", this);
            this.startupBannerHandle?.complete();
            this.startupBannerHandle = undefined;
            this.logger.clientReady(this as Vimcord<true>);
        });
    }

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
        this.logger.setVerbose(mode);
    }

    /**
     * Registers a plugin. Alias for `client.plugins.use`.
     * @param plugin The plugin to register.
     */
    use(plugin: VimcordPlugin): this {
        this.plugins.use(plugin);
        return this;
    }

    /**
     * Configures global client configs.
     * @param globals The options to set.
     */
    configure(globals: PartialDeep<VimcordGlobals>): this {
        this.globals.app = mergeDeep(this.globals.app, globals.app);
        this.globals.staff = mergeDeep(this.globals.staff, globals.staff);
        this.globals.hooks = mergeDeep(this.globals.hooks ?? {}, globals.hooks);
        this.logger.setVerbose(this.globals.app.verbose);
        syncCLIClient(this);
        return this;
    }

    /** Serializes the Vimcord client options. */
    toOptions(): VimcordClientOptions {
        return {
            client: this.client,

            features: this.features,
            globals: this.globals,

            verbose: this.logger.options.verbose
        };
    }

    // --- Main ---
    /**
     * Loads plugins and modules then logs in to Discord.
     * @param token The token to log in with.
     * @default process.env.TOKEN | process.env.TOKEN_DEV
     */
    override async login(token?: string): Promise<string> {
        try {
            if (!this.globals.app.disableBanner) this.startupBannerHandle = this.logger.startupBanner(this);

            if (this.plugins.getAll().length) {
                this.logger.log("Loading plugins...");
                await this.plugins.load();
            }

            token ??= this.$devMode ? process.env.TOKEN_DEV : process.env.TOKEN;
            if (!token) {
                throw new Error(
                    `TOKEN Missing; ${this.$devMode ? "devMode is enabled, but TOKEN_DEV is not set" : "TOKEN not set"}`
                );
            }

            this.logger.log("Logging in to Discord...");
            return await super.login(token);
        } catch (err) {
            this.startupBannerHandle?.clear();
            this.startupBannerHandle = undefined;
            throw new VimcordError(`Failed to login\n╰ ${(err as Error).message}`, "CLIENT_ERROR");
        }
    }

    /** Unloads modules and plugins then destroys the client. */
    override async destroy(): Promise<void> {
        this.startupBannerHandle?.clear();
        this.startupBannerHandle = undefined;
        this.resolveAwaitReady(false);

        const errors: unknown[] = [];
        try {
            await this.status.destroy();
        } catch (error) {
            errors.push(error);
        }
        try {
            this.modules.unload();
        } catch (error) {
            errors.push(error);
        }
        try {
            await this.plugins.unload();
        } catch (error) {
            errors.push(error);
        }
        try {
            await super.destroy();
        } catch (error) {
            errors.push(error);
        }

        if (Vimcord.instance === this) Vimcord.instance = undefined;
        Vimcord.$events.emit("destroy", this);

        if (errors.length) throw new AggregateError(errors, "Failed to destroy Vimcord cleanly");
    }

    /**
     * Waits for the client to be ready.
     * @param timeout `60_000` by default.
     */
    async awaitReady(timeout: number = 60_000): Promise<boolean> {
        if (this.isReady()) return true;

        return new Promise(resolve => {
            let settled = false;
            const finish = (ready: boolean): void => {
                if (settled) return;

                settled = true;
                clearTimeout(timer);
                this.awaitReadyWaiters.delete(finish);
                if (!this.awaitReadyWaiters.size) this.off("clientReady", this.handleAwaitReady);
                resolve(ready);
            };
            const timer = setTimeout(() => finish(false), timeout);

            const listen = !this.awaitReadyWaiters.size;
            this.awaitReadyWaiters.add(finish);
            if (listen) this.on("clientReady", this.handleAwaitReady);
        });
    }

    private resolveAwaitReady(ready: boolean): void {
        for (const finish of [...this.awaitReadyWaiters]) finish(ready);
    }

    /**
     * Fetches a guild, first checking if the guild is cached.
     *
     * *Alias for {@link fetchGuild}.*
     *
     * @param options The ID or options to fetch
     */
    async fetchGuild(options: string | FetchGuildOptions | null | undefined): Promise<Guild | null> {
        return fetchGuild(this, options);
    }

    /**
     * Fetches a user, first checking if the user is cached.
     *
     * *Alias for {@link fetchUser}.*
     *
     * @param user The ID or user to fetch
     */
    async fetchUser(user: UserResolvable | null | undefined): Promise<User | null> {
        return fetchUser(this, user);
    }

    /**
     * Fetches the role IDs a user holds in the configured staff guild, regardless of the guild
     * a command is invoked in.
     * @param userId The ID of the user to check
     */
    async getStaffGuildRoleIds(userId: string): Promise<string[]> {
        const staff = this.globals.staff;
        if (!staff.guild.id) {
            if (!this.warnedMissingStaffGuild) {
                this.warnedMissingStaffGuild = true;
                this.logger.warn(
                    "[Staff] `staff.guild.id` is not configured, so staff-guild role checks (superUserRoles, bypasser roleIds) can never match anyone."
                );
            }
            return [];
        }

        const guild = await this.fetchGuild(staff.guild.id);
        const member = await guild?.members.fetch(userId).catch(() => null);
        if (!member) return [];

        return [...member.roles.cache.keys()];
    }

    /**
     * Checks whether a user is configured as bot staff.
     * @param userId The ID of the user to test
     */
    async isBotStaff(userId: string): Promise<boolean> {
        const staff = this.globals.staff;
        if (staff.ownerId === userId || staff.superUsers.includes(userId)) return true;
        if (!staff.superUserRoles.length) return false;

        const staffGuildRoleIds = await this.getStaffGuildRoleIds(userId);
        return staff.superUserRoles.some(roleId => staffGuildRoleIds.includes(roleId));
    }
}
