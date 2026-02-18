import { type Vimcord } from "@/client";
import { validateCommandPermissions } from "@/modules/validators/permissions.validator";
import {
    BaseCommandConfig,
    BaseCommandParameters,
    CommandInternalRateLimitData,
    CommandType,
    RateLimitScope
} from "@ctypes/command.base";
import {
    CommandMetadata,
    CommandPermissionResults,
    CommandPermissions,
    CommandRateLimitOptions
} from "@ctypes/command.options";
import { Guild, GuildMember, TextBasedChannel, User } from "discord.js";
import { deepMerge } from "@/utils/merge.utils";
import { randomUUID } from "node:crypto";

export abstract class BaseCommandBuilder<T extends CommandType, O extends BaseCommandConfig<T> = BaseCommandConfig<T>> {
    readonly uuid: string = randomUUID();
    readonly commandType: T;

    /** Local command configuration and hooks */
    readonly options: O;

    /** Internal state for rate limiting across different scopes */
    private readonly rlStores = {
        [RateLimitScope.Global]: { executions: 0, timestamp: 0 } as CommandInternalRateLimitData,
        [RateLimitScope.User]: new Map<string, CommandInternalRateLimitData>(),
        [RateLimitScope.Guild]: new Map<string, CommandInternalRateLimitData>(),
        [RateLimitScope.Channel]: new Map<string, CommandInternalRateLimitData>()
    };

    /** Mapping of CommandTypes to their respective config keys in the Vimcord client */
    private readonly typeConfigMapping: Record<CommandType, string> = {
        [CommandType.Slash]: "slashCommands",
        [CommandType.Prefix]: "prefixCommands",
        [CommandType.Context]: "contextCommands"
    };

    constructor(type: T, options: O = {} as O) {
        this.commandType = type;
        this.options = { enabled: true, ...options };
    }

    private validateBaseConfig() {
        if (this.options.rateLimit) {
            const { max, interval } = this.options.rateLimit;
            if (max <= 0 || interval <= 0) {
                throw new Error(`[Vimcord:${this.constructor.name}] Rate limit values must be positive.`);
            }
        }
    }

    /**
     * Resolves the final configuration by merging layers:
     * Client Defaults < Client Type-Specific < Local Command Options
     */
    protected resolveConfig(client: Vimcord): O {
        const typeKey = this.typeConfigMapping[this.commandType];
        const typeSpecificGlobals = (client.config as any)?.[typeKey] || {};

        return deepMerge({}, typeSpecificGlobals, this.options) as O;
    }

    /**
     * Executes the command lifecycle.
     * Merges global client config with local command options at runtime.
     */
    async run(client: Vimcord<true>, ...args: BaseCommandParameters<T>): Promise<void> {
        const config = this.resolveConfig(client);
        const ctx = this.extractContext(args);

        try {
            // 1. Availability
            if (!config.enabled) {
                return await config.onUsedWhenDisabled?.(...args);
            }

            // 2. Rate Limiting
            if (this.isRateLimited(config, ctx)) {
                return await config.onRateLimit?.(...args);
            }

            // 3. Permissions
            const perms = this.checkPermissions(client, ctx.member || ctx.user, args[1] as any);
            if (!perms.validated) {
                return await config.onMissingPermissions?.(perms, ...args);
            }

            // 4. Custom Conditions
            if (!(await this.checkConditions(config, ...args))) {
                return await config.onConditionsNotMet?.(...args);
            }

            // 5. Execution Pipeline
            await config.beforeExecute?.(...args);

            if (config.logExecution !== false) {
                // Resolve name based on builder type
                const cmdName = (this.options as any).name || (this as any).builder?.name || "Unknown";
                const location = ctx.guild ? `${ctx.guild.name} (${ctx.guild.id})` : "Direct Messages";

                client.logger.commandExecuted(cmdName, ctx.user.username, location);
            }

            const result = await config.execute?.(...args);
            await config.afterExecute?.(result, ...args);
        } catch (error) {
            await this.handleError(error as Error, config, ...args);
        }
    }

    /**
     * Internal logic to determine if a command execution should be throttled.
     * @param config The merged configuration to use for limits.
     * @param ctx Extracted Discord context (User, Guild, Channel).
     */
    private isRateLimited(config: BaseCommandConfig<T>, ctx: ReturnType<typeof this.extractContext>): boolean {
        if (!config.rateLimit) return false;

        const { scope, interval, max } = config.rateLimit;
        const now = Date.now();
        const key = this.getScopeKey(scope, ctx);

        if (scope !== RateLimitScope.Global && !key) return false;

        let data: CommandInternalRateLimitData;
        if (scope === RateLimitScope.Global) {
            data = this.rlStores[RateLimitScope.Global];
        } else {
            const store = this.rlStores[scope] as Map<string, CommandInternalRateLimitData>;
            data = store.get(key!) ?? { executions: 0, timestamp: now };
            store.set(key!, data);
        }

        if (now - data.timestamp > interval) {
            data.executions = 0;
            data.timestamp = now;
        }

        if (data.executions >= max) return true;

        data.executions++;
        return false;
    }

    /**
     * Validates if the user has required permissions.
     */
    private checkPermissions(client: Vimcord<true>, user: GuildMember | User, target: any): CommandPermissionResults {
        if (!this.options.permissions) return { validated: true };
        return validateCommandPermissions(this.options.permissions, client, user, target);
    }

    /**
     * Evaluates all custom conditions defined for the command.
     */
    private async checkConditions(config: BaseCommandConfig<T>, ...args: BaseCommandParameters<T>): Promise<boolean> {
        if (!config.conditions?.length) return true;
        const results = await Promise.all(config.conditions.map(c => c(...args)));
        return results.every(Boolean);
    }

    /**
     * Normalizes the trigger arguments into a standard context object.
     */
    private extractContext(args: BaseCommandParameters<T>) {
        const event = args[1] as any;
        return {
            user: (event.user || event.author) as User,
            member: event.member as GuildMember | null,
            guild: event.guild as Guild | null,
            channel: event.channel as TextBasedChannel | null
        };
    }

    /**
     * Resolves the storage key based on the RateLimit scope.
     */
    private getScopeKey(scope: RateLimitScope, ctx: ReturnType<typeof this.extractContext>): string | null {
        switch (scope) {
            case RateLimitScope.User:
                return ctx.user.id;
            case RateLimitScope.Guild:
                return ctx.guild?.id ?? null;
            case RateLimitScope.Channel:
                return ctx.channel?.id ?? null;
            default:
                return null;
        }
    }

    /**
     * Handles command errors by checking local handlers before falling back to global handlers.
     */
    private async handleError(err: Error, config: BaseCommandConfig<T>, ...args: BaseCommandParameters<T>) {
        if (config.onError) return config.onError(err, ...args);
        throw err;
    }

    /** Toggle command availability */
    setEnabled(enabled: boolean): this {
        this.options.enabled = enabled;
        return this;
    }

    /** Merge new permission requirements into the existing ones */
    setPermissions(perms: CommandPermissions): this {
        this.options.permissions = deepMerge(this.options.permissions || {}, perms) as CommandPermissions;
        return this;
    }

    /** Set the custom conditions that must be met for this command to execute */
    setConditions(conditions: Array<(...args: BaseCommandParameters<T>) => boolean | Promise<boolean>>): this {
        this.options.conditions = conditions;
        return this;
    }

    /** Set the primary command execution logic */
    setExecute(fn: (...args: BaseCommandParameters<T>) => any): this {
        this.options.execute = fn;
        return this;
    }

    /** Set the command metadata configuration */
    setMetadata(metadata: CommandMetadata): this {
        this.options.metadata = deepMerge(this.options.metadata || {}, metadata) as CommandMetadata;
        return this;
    }

    /** Set the rate limiting options for this command */
    setRateLimit(options: CommandRateLimitOptions<(...args: BaseCommandParameters<T>) => any>): this {
        this.options.rateLimit = options;
        this.validateBaseConfig();
        return this;
    }
}
