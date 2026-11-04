import type { ClientOptions, FetchGuildOptions, Guild, User, UserResolvable } from "discord.js";
import type { GlobalCommandHooks } from "@/commands/commandHooks.js";
import type { VimcordPlugin } from "@/plugins/Plugin.js";
import type { PartialDeep } from "@/types/helpers.js";
import type { AppGlobals, StaffGlobals, VimcordGlobals } from "./globals.js";
import type { CommandPrefix, CommandRoutingOptions } from "./managers/CommandManager.js";
import type { AppModuleImports } from "./managers/ModuleManager.js";
import type { VimcordStartupBannerHandle } from "./VimcordLogger.js";

import EventEmitter from "node:events";
import { Client } from "discord.js";
import { ModuleManager } from "@/client/managers/ModuleManager.js";
import { VimcordError } from "@/errors/VimcordError.js";
import { PluginManager } from "@/plugins/index.js";
import { fetchGuild, fetchUser } from "@/utils/clientUtils.js";
import { mergeDeep } from "@/utils/obj.js";
import { defineGlobalUxConfig } from "@/ux/uxConfig.js";
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

/** Discord.js client options plus Vimcord's own settings, all flat. */
export interface VimcordClientOptions extends ClientOptions, Partial<AppGlobals> {
    /** Bot staff, read back through `client.globals.staff`. */
    staff?: PartialDeep<StaffGlobals>;
    /** Plugins installed by `login()`, dependencies first. */
    plugins?: VimcordPlugin[];
    /** Module directories imported by `login()`. */
    modules?: AppModuleImports;
    /** Message prefixes. Omit to listen only for application commands. */
    prefix?: CommandPrefix;
    /** Treat a mention of the bot as a prefix. @default false */
    allowMention?: boolean;
    /** Push application commands once the client is ready. A failure is logged and the bot keeps running. @default true */
    syncCommands?: boolean;
    /** Command hooks shared by every module of a command type. */
    hooks?: GlobalCommandHooks;
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

    readonly globals: VimcordGlobals;

    readonly plugins: PluginManager;
    readonly modules: ModuleManager;
    readonly status: StatusManager;

    private readonly awaitReadyWaiters = new Set<(ready: boolean) => void>();
    private readonly handleAwaitReady = (): void => this.resolveAwaitReady(true);
    private startupBannerHandle: VimcordStartupBannerHandle | undefined;
    private warnedMissingStaffGuild = false;
    private readonly pendingStaffRoleLookups = new Map<string, Promise<string[]>>();
    private readonly moduleImports: AppModuleImports | undefined;
    private readonly commandRouting: CommandRoutingOptions;
    private loginStarted = false;

    constructor(options: VimcordClientOptions) {
        if (Vimcord.instance) throw new VimcordError("Only one Vimcord client can exist in a process", "CLIENT_ERROR");

        const {
            name,
            version,
            devMode,
            verbose,
            commandLogging,
            enableCLI,
            disableBanner,
            staff,
            plugins,
            modules,
            prefix,
            allowMention,
            syncCommands = true,
            hooks,
            ...clientOptions
        } = options;

        super(clientOptions);

        this.globals = {
            app: mergeDeep(defaultAppGlobals(), {
                name,
                version,
                devMode,
                verbose,
                commandLogging,
                enableCLI,
                disableBanner
            }),
            staff: mergeDeep(defaultStaffGlobals(), staff),
            hooks
        };
        this.moduleImports = modules;
        this.commandRouting = { prefix, allowMention };
        defineGlobalUxConfig({ devMode: this.globals.app.devMode });

        this.logger = new VimcordLogger({ verbose: this.globals.app.verbose });

        this.plugins = new PluginManager(this, plugins);
        this.modules = new ModuleManager(this);
        this.status = new StatusManager(this);

        Vimcord.instance = this;
        Vimcord.$events.emit("create", this);

        this.once("clientReady", () => {
            Vimcord.$events.emit("ready", this);
            this.startupBannerHandle?.complete();
            this.startupBannerHandle = undefined;
            this.logger.clientReady(this as Vimcord<true>);
            if (syncCommands) void this.syncApplicationCommands();
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
        defineGlobalUxConfig({ devMode: mode });
    }

    /** Current verbose mode state. */
    get $verboseMode() {
        return this.globals.app.verbose;
    }
    set $verboseMode(mode: boolean) {
        this.globals.app.verbose = mode;
        this.logger.setVerbose(mode);
    }

    // --- Main ---
    /** Pushes application commands without letting a failure reach the running bot. */
    private async syncApplicationCommands(): Promise<void> {
        const { commands } = this.modules;
        if (!commands.getAllAppCommands().some(command => command.registration.global !== false)) return;

        try {
            await commands.push();
        } catch (error) {
            this.logger.error("[Vimcord] Failed to sync application commands", error as Error);
        }
    }

    /** Releases everything a failed login acquired so calling `login()` again starts clean. */
    private async cleanupFailedLogin(): Promise<void> {
        this.loginStarted = false;
        this.modules.unload();
        try {
            await this.plugins.unload();
        } catch (cleanupError) {
            this.logger.error("[Vimcord] Failed to clean up plugins after a failed login", cleanupError as Error);
        }

        this.startupBannerHandle?.clear();
        this.startupBannerHandle = undefined;
    }

    /**
     * Starts the bot: plugins, the plugin `onPluginsInstalled` step, modules, command listeners, then the gateway.
     * Application commands sync once the client is ready unless `syncCommands` is `false`.
     * @param token The token to log in with.
     * @default process.env.TOKEN | process.env.TOKEN_DEV
     */
    override async login(token?: string): Promise<string> {
        if (this.loginStarted) throw new VimcordError("login() was already called on this client", "CLIENT_ERROR");
        this.loginStarted = true;

        try {
            if (!this.globals.app.disableBanner) this.startupBannerHandle = this.logger.startupBanner(this);

            // --- Plugins ---
            if (this.plugins.getAll().length) this.logger.log("Loading plugins...");
            await this.plugins.load();

            // Read after plugins so DotEnvPlugin can supply it, but before migrations and other startup work.
            token ??= this.$devMode ? process.env.TOKEN_DEV : process.env.TOKEN;
            if (!token) {
                throw new Error(
                    `TOKEN Missing; ${this.$devMode ? "devMode is enabled, but TOKEN_DEV is not set" : "TOKEN not set"}`
                );
            }

            await this.plugins.runInstalledStep();

            // --- Modules ---
            if (this.moduleImports) await this.modules.load(this.moduleImports);
            this.modules.commands.installListeners(this.commandRouting);

            // --- Gateway ---
            this.logger.log("Logging in to Discord...");
            return await super.login(token);
        } catch (err) {
            await this.cleanupFailedLogin();
            throw new VimcordError(`Failed to login\n╰ ${(err as Error).message}`, "CLIENT_ERROR", { cause: err });
        }
    }

    /** Unloads modules and plugins then destroys the client. */
    override async destroy(): Promise<void> {
        this.startupBannerHandle?.clear();
        this.startupBannerHandle = undefined;
        this.resolveAwaitReady(false);
        this.loginStarted = false;

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
                    "[Staff] `staff.guild.id` is not configured, so staff-guild role checks (superUserRoles, bypassesStaff.roleIds) can never match anyone."
                );
            }
            return [];
        }

        // Concurrent command checks for one user share the pending lookup. The result is not cached.
        const pending = this.pendingStaffRoleLookups.get(userId);
        if (pending) return await pending;

        const lookup = (async () => {
            const guild = await this.fetchGuild(staff.guild.id);
            const member = await guild?.members.fetch(userId).catch(() => null);
            return member ? [...member.roles.cache.keys()] : [];
        })();

        this.pendingStaffRoleLookups.set(userId, lookup);
        try {
            return await lookup;
        } finally {
            this.pendingStaffRoleLookups.delete(userId);
        }
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
