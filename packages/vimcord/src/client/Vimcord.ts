import type { ClientOptions, FetchGuildOptions, Guild, User, UserResolvable } from "discord.js";
import type { GlobalCommandHooks } from "@/commands/commandHooks.js";
import type { VimcordPlugin } from "@/plugins/Plugin.js";
import type { PartialDeep } from "@/types/helpers.js";
import type { UxConfig } from "@/ux/uxConfig.js";
import type { AppGlobals, StaffOptions, VimcordGlobals } from "./globals.js";
import type { CommandPrefix, CommandRoutingOptions } from "./managers/CommandManager.js";
import type { AppModules } from "./managers/ModuleManager.js";
import type { VimcordStartupBannerHandle } from "./VimcordLogger.js";

import EventEmitter from "node:events";
import { Client } from "discord.js";
import { ModuleManager } from "@/client/managers/ModuleManager.js";
import { VimcordError } from "@/errors/VimcordError.js";
import { PluginManager } from "@/plugins/index.js";
import { fetchGuild, fetchUser } from "@/utils/clientUtils.js";
import { mergeDeep } from "@/utils/obj.js";
import { applyUxConfig, resetUxConfig, uxConfig } from "@/ux/uxConfig.js";
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
    staff?: StaffOptions;
    /** Plugins installed by login in dependency order. @default [] */
    plugins?: VimcordPlugin[];
    /** Module directories imported by `login()`. A string such as `"./src"` loads `.slash`, `.prefix`, `.mctx`, `.uctx`, and `.event` files under it. */
    modules?: AppModules;
    /** Message prefixes. Omit to listen only for application commands. */
    prefix?: CommandPrefix;
    /** Treat a mention of the bot as a prefix. @default false */
    allowMention?: boolean;
    /** Sync application commands once the client is ready: global commands, plus guild commands in the guilds modules name. Stale remote commands in those scopes are deleted. A failure is logged and the bot keeps running. @default true */
    syncCommands?: boolean;
    /** Command hooks: top-level ones run for every command, `prefix`, `slash`, and `context` for one command type. */
    hooks?: GlobalCommandHooks;
    /** UX defaults for embeds, prompts, paginators, and command replies, merged over the built-in ones. `devMode` follows the client's. */
    ux?: PartialDeep<Omit<UxConfig, "devMode">>;
}

/** Discord.js client with modules, plugins, command routing, and shared bot settings. */
export class Vimcord<Ready extends boolean = boolean> extends Client<Ready> {
    /** The one live Vimcord client for this process. */
    private static instance: Vimcord | undefined;
    /** Global event emitter for Vimcord client lifecycle events. */
    static $events = new EventEmitter<VimcordEvents>();

    /** Gets the live Vimcord client for this process. */
    static getInstance(): Vimcord | undefined {
        return Vimcord.instance;
    }

    /** Logger for this client's lifecycle and commands. */
    readonly logger: VimcordLogger;

    /** Mutable application, staff, and command hook settings. */
    readonly globals: VimcordGlobals;

    /** Plugin registration and lifecycle manager. */
    readonly plugins: PluginManager;
    /** Loaded commands, events, and their managers. */
    readonly modules: ModuleManager;
    /** Presence profile and rotation manager. */
    readonly status: StatusManager;

    private readonly awaitReadyWaiters = new Set<(ready: boolean) => void>();
    private readonly handleAwaitReady = (): void => this.resolveAwaitReady(true);
    private startupBannerHandle: VimcordStartupBannerHandle | undefined;
    private readonly pendingStaffRoleLookups = new Map<string, Promise<string[]>>();
    private readonly moduleImports: AppModules | undefined;
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
            cli,
            banner,
            staff,
            plugins,
            modules,
            prefix,
            allowMention,
            syncCommands = true,
            hooks,
            ux,
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
                cli,
                banner
            }),
            staff: { ...defaultStaffGlobals(), ...staff },
            hooks
        };
        this.moduleImports = modules;
        this.commandRouting = { prefix, allowMention };
        applyUxConfig({ ...ux, devMode: this.globals.app.devMode });

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
        uxConfig.devMode = mode;
    }

    /** Current verbose mode state. */
    get $verbose() {
        return this.globals.app.verbose;
    }
    set $verbose(mode: boolean) {
        this.globals.app.verbose = mode;
        this.logger.setVerbose(mode);
    }

    // --- Main ---
    /** Fully syncs global commands, and guild commands in the guilds modules name. Each scope logs its own failure, so neither can stop the bot or the other scope. */
    private async syncApplicationCommands(): Promise<void> {
        const { commands } = this.modules;
        const appCommands = commands.getAllAppCommands();
        if (!appCommands.length) return;

        const sync = async (scope: string, run: () => Promise<boolean>): Promise<void> => {
            try {
                await run();
            } catch (error) {
                this.logger.error(`[Vimcord] Failed to sync ${scope} application commands`, error as Error);
            }
        };
        await sync("global", () => commands.push());
        if (appCommands.some(command => command.registration.guilds?.length)) {
            await sync("guild", () => commands.pushByGuild());
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
     * Starts plugins, startup hooks, modules, routing, and the Discord gateway.
     * @param token Discord bot token. Defaults to `TOKEN_DEV` in dev mode, otherwise `TOKEN`.
     */
    override async login(token?: string): Promise<string> {
        if (this.loginStarted) throw new VimcordError("login() was already called on this client", "CLIENT_ERROR");
        this.loginStarted = true;

        try {
            if (this.globals.app.banner) this.startupBannerHandle = this.logger.startupBanner(this);

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

    /** Unloads modules and plugins, restores the default UX config, then destroys the client. */
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

        if (Vimcord.instance === this) {
            Vimcord.instance = undefined;
            resetUxConfig();
        }
        Vimcord.$events.emit("destroy", this);

        if (errors.length) throw new AggregateError(errors, "Failed to destroy Vimcord cleanly");
    }

    /**
     * Waits for the client to be ready.
     * @param timeout Maximum wait in milliseconds. Defaults to `60_000`.
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
     * @param options The ID or options to fetch
     */
    async fetchGuild(options: string | FetchGuildOptions | null | undefined): Promise<Guild | null> {
        return fetchGuild(this, options);
    }

    /**
     * Fetches a user, first checking if the user is cached.
     * @param user The ID or user to fetch
     */
    async fetchUser(user: UserResolvable | null | undefined): Promise<User | null> {
        return fetchUser(this, user);
    }

    /**
     * Fetches the role IDs a user holds in the configured staff guild, regardless of the guild a command is invoked in.
     * @param userId The ID of the user to check
     */
    async getStaffGuildRoleIds(userId: string): Promise<string[]> {
        const staff = this.globals.staff;
        if (!staff.guildId) return [];

        // Concurrent command checks for one user share the pending lookup. The result is not cached.
        const pending = this.pendingStaffRoleLookups.get(userId);
        if (pending) return await pending;

        const lookup = (async () => {
            const guild = await this.fetchGuild(staff.guildId);
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
        if (staff.users.includes(userId)) return true;
        if (!staff.roles.length) return false;

        const staffGuildRoleIds = await this.getStaffGuildRoleIds(userId);
        return staff.roles.some(roleId => staffGuildRoleIds.includes(roleId));
    }
}
