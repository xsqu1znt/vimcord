import type { ClientOptions, FetchGuildOptions, Guild, User, UserResolvable } from "discord.js";
import type { LogLevel, PartialDeep } from "@vimcord/internal";
import type { VimcordPlugin } from "@/plugins/Plugin.js";
import type { VimcordFeatures } from "./features.js";
import type { VimcordGlobals } from "./globals.js";

import EventEmitter from "node:events";
import { Client, Status as GatewayStatus, Routes } from "discord.js";
import { createHumanId, mergeDeep, VimcordError } from "@vimcord/internal";
import { ModuleManager } from "@/client/managers/ModuleManager.js";
import { PluginManager } from "@/plugins/index.js";
import { fetchGuild, fetchUser } from "@/utils/clientUtils.js";
import { defaultAppGlobals, defaultStaffGlobals } from "./globals.js";
import { StatusManager } from "./StatusManager.js";
import { VimcordLogger, vimcordLogger } from "./VimcordLogger.js";

export type VimcordEvents = {
    /** Returns the new Vimcord instance. */
    create: [Vimcord];
    /** Returns clientId. */
    destroy: [string];
    /** Returns the Vimcord instance. */
    ready: [Vimcord];
};

export interface VimcordConnectionRefreshOptions {
    /** Whether automatic Discord connection refresh checks are enabled. */
    enabled: boolean;
    /** Milliseconds between Discord health checks. */
    interval: number;
    /** Milliseconds to wait for a health check before treating it as failed. */
    requestTimeout: number;
    /** Consecutive failed health checks required before refreshing the connection. */
    maxFailures: number;
    /** Maximum relogin attempts per refresh cycle. */
    maxRefreshAttempts: number;
}

const DEFAULT_CONNECTION_REFRESH_OPTIONS: VimcordConnectionRefreshOptions = {
    enabled: true,
    interval: 60_000,
    requestTimeout: 10_000,
    maxFailures: 2,
    maxRefreshAttempts: 3
};

function resolveConnectionRefreshOptions(
    options: VimcordClientOptions["connectionRefresh"]
): VimcordConnectionRefreshOptions {
    if (options === false) return { ...DEFAULT_CONNECTION_REFRESH_OPTIONS, enabled: false };
    if (options === true || options === undefined) return { ...DEFAULT_CONNECTION_REFRESH_OPTIONS };

    return {
        ...DEFAULT_CONNECTION_REFRESH_OPTIONS,
        ...options,
        interval: Math.max(1_000, options.interval ?? DEFAULT_CONNECTION_REFRESH_OPTIONS.interval),
        requestTimeout: Math.max(1_000, options.requestTimeout ?? DEFAULT_CONNECTION_REFRESH_OPTIONS.requestTimeout),
        maxFailures: Math.max(1, options.maxFailures ?? DEFAULT_CONNECTION_REFRESH_OPTIONS.maxFailures),
        maxRefreshAttempts: Math.max(1, options.maxRefreshAttempts ?? DEFAULT_CONNECTION_REFRESH_OPTIONS.maxRefreshAttempts)
    };
}

export interface VimcordClientOptions {
    /** Custom client id. Otherwise powered by [human-id](https://www.npmjs.com/package/human-id). */
    customId?: string;

    /** Discord.js client options. */
    client: ClientOptions;
    /** Client features. */
    features?: VimcordFeatures;
    /** Global bot configs. */
    globals?: PartialDeep<VimcordGlobals>;
    /** Automatic Discord connection health checks and relogin refresh behavior. @default true */
    connectionRefresh?: boolean | Partial<VimcordConnectionRefreshOptions>;

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
    readonly status: StatusManager;

    private awaitReadyPromise: Promise<boolean> | null | undefined;
    private resolveStartupBanner: (() => void) | undefined;
    private connectionRefresh: VimcordConnectionRefreshOptions;
    private connectionRefreshFailures = 0;
    private connectionRefreshTimer: ReturnType<typeof setInterval> | null = null;
    private refreshingConnectionPromise: Promise<void> | null = null;
    private loginToken: string | null = null;

    constructor(options: VimcordClientOptions) {
        const {
            customId,

            client,
            features = {},
            globals,
            connectionRefresh,

            // --- Debugging ---
            logLevel = "debug",
            verbose = false
        } = options;

        super(client);

        this.id = customId ?? createHumanId();

        this.client = client;
        this.features = features;
        this.connectionRefresh = resolveConnectionRefreshOptions(connectionRefresh);
        this.globals = {
            app: mergeDeep(defaultAppGlobals(), globals?.app),
            staff: mergeDeep(defaultStaffGlobals(), globals?.staff),
            hooks: globals?.hooks ? mergeDeep({}, globals.hooks) : undefined
        };

        this.$verboseMode = verbose;
        this.logger.setLevel(logLevel);
        this.logger.setVerbose(this.$verboseMode);

        this.plugins = new PluginManager(this);
        this.modules = new ModuleManager(this);
        this.status = new StatusManager(this);

        Vimcord.$instances.set(this.id, this);
        Vimcord.$events.emit("create", this);

        this.once("clientReady", () => {
            Vimcord.$events.emit("ready", this);
            this.resolveStartupBanner?.();
            this.resolveStartupBanner = undefined;
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
        return this;
    }

    /** Serializes the Vimcord client options. */
    toOptions(): VimcordClientOptions {
        return {
            client: this.client,

            customId: this.id,
            features: this.features,
            globals: this.globals,
            connectionRefresh: this.connectionRefresh,

            logLevel: this.logger.options.minLevel,
            verbose: this.logger.options.verbose
        };
    }

    /**
     * Makes a clone of this client.
     * @param options Override options.
     */
    clone(options?: VimcordClientOptions): Vimcord {
        return new Vimcord(mergeDeep(this.toOptions(), options));
    }

    // --- Connection Health ---
    private startConnectionRefreshMonitor(): void {
        if (!this.connectionRefresh.enabled || this.connectionRefreshTimer) return;

        this.connectionRefreshTimer = setInterval(
            () => void this.runConnectionRefreshCheck(),
            this.connectionRefresh.interval
        );
        this.connectionRefreshTimer.unref?.();
        this.logger.debugVerbose("[Connection] Started Discord connection health monitor");
    }

    private stopConnectionRefreshMonitor(): void {
        if (!this.connectionRefreshTimer) return;

        clearInterval(this.connectionRefreshTimer);
        this.connectionRefreshTimer = null;
        this.logger.debugVerbose("[Connection] Stopped Discord connection health monitor");
    }

    private async testDiscordConnection(): Promise<boolean> {
        if (!this.isReady() || !this.user) return false;
        if (this.ws.status !== GatewayStatus.Ready || this.ws.ping < 0) return false;

        const timeout = new Promise<boolean>(resolve => {
            const timeoutRef = setTimeout(() => resolve(false), this.connectionRefresh.requestTimeout);
            timeoutRef.unref?.();
        });
        const request = this.rest
            .get(Routes.user())
            .then(() => true)
            .catch(() => false);

        return await Promise.race([request, timeout]);
    }

    private async runConnectionRefreshCheck(): Promise<void> {
        if (this.refreshingConnectionPromise) return;

        const healthy = await this.testDiscordConnection();
        if (healthy) {
            this.connectionRefreshFailures = 0;
            return;
        }

        this.connectionRefreshFailures++;
        this.logger.warn(
            `[Connection] Discord health check failed (${this.connectionRefreshFailures}/${this.connectionRefresh.maxFailures})`
        );

        if (this.connectionRefreshFailures >= this.connectionRefresh.maxFailures) {
            await this.refreshDiscordConnection("health checks failed");
        }
    }

    private async refreshDiscordConnection(reason: string): Promise<void> {
        if (this.refreshingConnectionPromise) return this.refreshingConnectionPromise;

        this.refreshingConnectionPromise = (async () => {
            if (!this.loginToken) {
                this.logger.warn("[Connection] Cannot refresh Discord connection because no login token is cached");
                return;
            }

            this.logger.warn(`[Connection] Refreshing Discord connection: ${reason}`);
            this.stopConnectionRefreshMonitor();

            for (const attempt of Array.from(
                { length: this.connectionRefresh.maxRefreshAttempts },
                (_, index) => index + 1
            )) {
                try {
                    await super.destroy();
                    await super.login(this.loginToken);
                    this.connectionRefreshFailures = 0;
                    this.logger.info(`[Connection] Discord connection refreshed on attempt ${attempt}`);
                    return;
                } catch (err) {
                    this.logger.error(
                        `[Connection] Discord refresh attempt ${attempt}/${this.connectionRefresh.maxRefreshAttempts} failed`,
                        err as Error
                    );
                }
            }

            this.logger.error(
                `[Connection] Failed to refresh Discord connection after ${this.connectionRefresh.maxRefreshAttempts} attempt${this.connectionRefresh.maxRefreshAttempts === 1 ? "" : "s"}`
            );
        })();

        try {
            await this.refreshingConnectionPromise;
        } finally {
            this.refreshingConnectionPromise = null;
            this.startConnectionRefreshMonitor();
        }
    }

    // --- Main ---
    /**
     * Loads plugins and modules then logs in to Discord.
     * @param token The token to log in with.
     * @default process.env.TOKEN | process.env.TOKEN_DEV
     */
    override async login(token?: string): Promise<string> {
        try {
            const resolveBanner = this.logger.startupBanner(this);
            this.resolveStartupBanner = resolveBanner;

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
            this.loginToken = token;
            const result = await super.login(token);
            this.startConnectionRefreshMonitor();

            return result;
        } catch (err) {
            this.resolveStartupBanner?.();
            this.resolveStartupBanner = undefined;
            throw new VimcordError(`Failed to login\n╰ ${(err as Error).message}`, "CLIENT_ERROR");
        }
    }

    /** Unloads modules and plugins then destroys the client. */
    override async destroy(): Promise<void> {
        this.stopConnectionRefreshMonitor();
        await this.status.destroy();
        this.modules.unload();
        await this.plugins.unload();
        await super.destroy();
        Vimcord.$instances.delete(this.id);
        Vimcord.$events.emit("destroy", this.id);
    }

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
     * Checks whether a user is configured as bot staff.
     * @param userId The ID of the user to test
     */
    async isBotStaff(userId: string): Promise<boolean> {
        const staff = this.globals.staff;
        if (staff.ownerId === userId || staff.superUsers.includes(userId)) return true;
        if (!staff.guild.id || !staff.superUserRoles.length) return false;

        const guild = await this.fetchGuild(staff.guild.id);
        const member = await guild?.members.fetch(userId).catch(() => null);
        if (!member) return false;

        return staff.superUserRoles.some(roleId => member.roles.cache.has(roleId));
    }
}
