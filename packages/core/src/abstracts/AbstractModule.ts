import type { Vimcord } from "@/client/Vimcord.js";

import { ModuleError } from "@/errors/ModuleError.js";
import { createHumanId } from "@/utils/str.js";

export type ModuleTestResult<Passed extends boolean = boolean> = Passed extends true
    ? { passed: true }
    : { passed: false; reason: string; error?: Error };
export type ModuleConditionFn<CTX = ModuleHookContext> = (ctx: CTX) => Promise<ModuleTestResult> | ModuleTestResult;

export interface ModuleRunResult {
    /** Whether the module's main execute function was reached. */
    executed: boolean;
    /** Value returned by the module's main execute function. */
    response: unknown;
    /** Error thrown by the module's main execute function, if any. */
    error?: Error;
}

// - - - - - - - - - - - - - - -

export interface ModuleContext<Ready extends boolean = true> {
    client: Vimcord<Ready>;
}

export interface ModuleHookContext<Args extends unknown[] = unknown[], Ready extends boolean = true> {
    module: AbstractModule<Args>;
    client: Vimcord<Ready>;
    args: Args;
    error?: Error;
    deploymentTestResult?: ModuleTestResult;
    conditionTestResult?: ModuleTestResult;
}

// --- Module Options ---
export interface ModuleOptions<
    Args extends unknown[] = unknown[],
    ModuleCTX extends ModuleContext<boolean> = ModuleContext,
    HookCTX extends ModuleHookContext<Args, boolean> = ModuleHookContext<Args>,
    Hooks extends ModuleHooks<Args, HookCTX> = ModuleHooks<Args, HookCTX>
> {
    /** Custom module id. Otherwise powered by [human-id](https://www.npmjs.com/package/human-id). */
    customId?: string;
    /** The name of the module. */
    name: string;
    /** Optional description of the module. */
    description?: string;
    /** Optional metadata of the module. */
    metadata?: ModuleMetadata;

    // --- Tests & Rules ---
    /**
     * Whether this module is enabled.
     * @default true
     */
    enabled?: boolean;
    /**
     * Whether this module should wait for the client to be ready before being runnable.
     * @default true
     */
    requiresReady?: boolean;
    /** Optional deployment rules of the module. */
    deployment?: ModuleDeploymentRules;
    /** Optional condition rules of the module. Conditions are tested in the order they are defined. */
    conditions?: ModuleConditionFn<HookCTX>[];
    /**
     * Skip a new invocation while a matching one (same key) is still running. Off by default.
     * @remarks Coordinates work in-memory, within this process only.
     */
    singleInvocation?: {
        /** Returns the identity key for an invocation. Invocations sharing a key never run concurrently. */
        key(ctx: HookCTX): string;
    };

    // --- Hooks ---
    /** Optional hooks of the module. */
    hooks?: Hooks;

    // --- Main ---
    /** The main function of the module. */
    execute(ctx: ModuleCTX): unknown;
}

export interface ModuleMetadata {
    /** Category for categorizing modules. */
    category?: string[];
    /** Tags for categorizing modules. */
    tags?: string[];
}

export interface ModuleDeploymentRules {
    /**
     * The environment the module is allowed to be executed in.
     * Tests against the Vimcord client's `$devMode` property.
     * @default "both"
     */
    environment?: "development" | "production" | "both";
}

export interface ModuleHooks<
    Args extends unknown[] = unknown[],
    HookCTX extends ModuleHookContext<Args, boolean> = ModuleHookContext<Args>
> {
    /** @defaultBehavior Alias for `onError`. */
    onDeploymentTestFail?(ctx: HookCTX): Promise<void>;
    /** @defaultBehavior Alias for `onError`. */
    onConditionTestFail?(ctx: HookCTX): Promise<void>;
    /** @defaultBehavior Does nothing. */
    onError?(ctx: HookCTX): Promise<void>;
    /** @defaultBehavior Does nothing. */
    preExecute?(
        ctx: HookCTX,
        /** Continues execution. If not called, execution halts. */
        next: () => void
    ): Promise<void>;
    /** @defaultBehavior Does nothing. */
    postExecute?(ctx: HookCTX, executeResponse: unknown): Promise<void>;
    /** Runs when an invocation is skipped because a matching `singleInvocation` invocation is already running.
     * @defaultBehavior Does nothing; the invocation is silently skipped. */
    onAlreadyRunning?(ctx: HookCTX): Promise<void>;
}

// --- Abstract Module ---
export abstract class AbstractModule<
    Args extends unknown[] = unknown[],
    ModuleCTX extends ModuleContext<boolean> = ModuleContext,
    HookCTX extends ModuleHookContext<Args, boolean> = ModuleHookContext<Args>,
    Hooks extends ModuleHooks<Args, HookCTX> = ModuleHooks<Args, HookCTX>
> {
    readonly client: Vimcord | null = null;

    abstract readonly moduleType: string;
    readonly id: string;
    readonly name: string;
    readonly metadata: ModuleMetadata;

    readonly enabled: boolean;
    readonly requiresReady: boolean;
    readonly deployment: ModuleDeploymentRules;
    readonly conditions: ModuleConditionFn<HookCTX>[];
    readonly singleInvocation: { key(ctx: HookCTX): string } | undefined;
    readonly hooks: Hooks;

    /** Keys of invocations currently running, when `singleInvocation` is configured. */
    private readonly activeInvocationKeys = new Set<string>();

    protected readonly execute: (ctx: ModuleCTX) => unknown;

    constructor(options: ModuleOptions<Args, ModuleCTX, HookCTX, Hooks>) {
        const {
            customId,
            name,
            metadata,
            enabled,
            requiresReady,
            deployment,
            conditions,
            singleInvocation,
            hooks,
            execute
        } = options;
        this.id = customId ?? createHumanId();
        this.name = name;
        this.metadata = metadata ?? {};

        this.enabled = enabled ?? true;
        this.requiresReady = requiresReady ?? true;
        this.deployment = { environment: "both", ...deployment };
        this.conditions = conditions ?? [];
        this.singleInvocation = singleInvocation;

        this.hooks = (hooks ?? {}) as Hooks;
        this.execute = execute;
    }

    inject(client: Vimcord): void {
        if (!this.client) {
            (this as { client: Vimcord | null }).client = client;
        }
    }

    // --- Tests & Rules ---
    protected testDeployment(ctx: HookCTX): ModuleTestResult {
        if (this.deployment.environment === "both") {
            return { passed: true };
        }
        if (ctx.client.$devMode && this.deployment.environment !== "development") {
            return { passed: false, reason: "Client is in development mode" };
        }
        if (!ctx.client.$devMode && this.deployment.environment !== "production") {
            return { passed: false, reason: "Client is in production mode" };
        }

        return { passed: true };
    }

    protected async testConditions(ctx: HookCTX): Promise<ModuleTestResult> {
        if (!this.conditions.length) {
            return { passed: true };
        }

        for (let i = 0; i < this.conditions.length; i++) {
            const condition = this.conditions[i]!;

            try {
                const result = await condition(ctx);
                if (!result.passed) return result;
            } catch (err) {
                return {
                    passed: false,
                    reason: `Condition threw an error at index ${i}`,
                    error: err as Error
                };
            }
        }

        return { passed: true };
    }

    /**
     * Execute order:
     *
     * `testDeployment` -> `hook:onDeploymentTestFail`
     *
     * `testConditions` -> `hook:onConditionTestFail`
     */
    protected async performTests(ctx: HookCTX): Promise<boolean> {
        const deploymentTestResult = this.testDeployment(ctx);
        if (!deploymentTestResult.passed) {
            ctx.deploymentTestResult = deploymentTestResult;

            await this.runHook("onDeploymentTestFail", ctx, async ctx => {
                if (!ctx.deploymentTestResult?.passed) {
                    ctx.error ??= ctx.deploymentTestResult?.error ?? new ModuleError(ctx.deploymentTestResult!.reason);
                }
                await this.runHook("onError", ctx);
            });

            return false;
        }

        const conditionTestResult = await this.testConditions(ctx);
        if (!conditionTestResult.passed) {
            ctx.conditionTestResult = conditionTestResult;

            await this.runHook("onConditionTestFail", ctx, async ctx => {
                if (!ctx.conditionTestResult?.passed) {
                    ctx.error ??= ctx.conditionTestResult?.error ?? new ModuleError(ctx.conditionTestResult!.reason);
                }
                await this.runHook("onError", ctx);
            });

            return false;
        }

        return true;
    }

    // --- Internal Utilities ---
    protected async checkInjection(): Promise<boolean> {
        if (!this.client) {
            console.warn(`[Module] '${this.buildName()}' is not injected`);
            return false;
        }

        if (!this.requiresReady || this.client.isReady()) return true;

        const ready = await this.client.awaitReady();
        if (!ready) console.warn(`[Module] '${this.buildName()}' client is not ready`);
        return ready;
    }

    protected buildName(): string {
        return `${this.moduleType}:${this.name}`;
    }

    /** Returns the hook implementation for this module. */
    protected getHook<K extends keyof Hooks>(hook: K): Hooks[K] | undefined {
        return this.hooks[hook];
    }

    /** Awaits `fn`, logging `message` and how long it took when verbose logging is on. */
    private async timed<T>(message: string, fn: () => Promise<T> | T): Promise<T> {
        if (!this.client?.logger.options.verbose) return await fn();

        const startedAt = performance.now();
        const result = await fn();
        this.client.logger.debug(`[Module] ${message} in ${(performance.now() - startedAt).toFixed(1)}ms`);
        return result;
    }

    /** Runs a hook with relevant context and an optional fallback. */
    async runHook<K extends keyof Hooks, HookContext extends HookCTX>(
        hook: K,
        ctx: HookContext,
        fallback?: (ctx: HookContext) => Promise<void>
    ): Promise<void> {
        if (!(await this.checkInjection())) return;
        const hookFn = this.getHook(hook) as ((ctx: HookContext) => Promise<void>) | undefined;

        try {
            if (hookFn) {
                await this.timed(`Ran hook '${String(hook)}' for '${this.buildName()}'`, () => hookFn(ctx));
            } else if (fallback) {
                await this.timed(`Ran fallback hook '${String(hook)}' for '${this.buildName()}'`, () => fallback(ctx));
            }
        } catch (err) {
            this.client!.logger.error(`[Module] Hook '${String(hook)}' failed for '${this.buildName()}'`, err as Error);
        }
    }

    /**
     * Execute order:
     *
     * try:`performTests` -> `hook:preExecute` -> `singleInvocation` check -> `execute` -> `hook:postExecute`
     *
     * catch:`hook:onError`
     */
    async run(...args: Args): Promise<unknown> {
        const result = await this.runWithResult(...args);
        return result.response;
    }

    /**
     * Runs the module and reports whether its main execute function was reached.
     * @param args Arguments passed to the module
     */
    async runWithResult(...args: Args): Promise<ModuleRunResult> {
        let executed = false;
        if (!this.enabled) return { executed, response: undefined };
        if (!(await this.checkInjection())) return { executed, response: undefined };
        const moduleCTX = this.createModuleCTX(args);
        const hookCTX = this.createHookCTX(moduleCTX, args);

        try {
            const valid = this.validate();
            if (!valid) return { executed, response: undefined };

            const passed = await this.performTests(hookCTX);
            if (!passed) return { executed, response: undefined };

            const preExecute = this.getHook("preExecute" as keyof Hooks) as
                ((ctx: HookCTX, next: () => void) => Promise<void>) | undefined;
            if (preExecute) {
                let next = false;
                await this.timed(`Ran hook 'preExecute' for '${this.buildName()}'`, () =>
                    preExecute(hookCTX, () => (next = true))
                );

                if (!next) {
                    this.client?.logger.debug(`[Module] preExecute halted execution for '${this.buildName()}'`);
                    return { executed, response: undefined };
                }
            }

            let invocationKey: string | undefined;
            if (this.singleInvocation) {
                invocationKey = this.singleInvocation.key(hookCTX);
                if (this.activeInvocationKeys.has(invocationKey)) {
                    await this.runHook("onAlreadyRunning", hookCTX);
                    return { executed, response: undefined };
                }
                this.activeInvocationKeys.add(invocationKey);
            }

            executed = true;
            let executeResponse: unknown;
            try {
                executeResponse = await this.timed(`Executed '${this.buildName()}'`, () => this.execute(moduleCTX));
            } finally {
                if (invocationKey !== undefined) this.activeInvocationKeys.delete(invocationKey);
            }

            const postExecute = this.getHook("postExecute" as keyof Hooks) as
                ((ctx: HookCTX, executeResponse: unknown) => Promise<void>) | undefined;
            if (postExecute) {
                await this.timed(`Ran hook 'postExecute' for '${this.buildName()}'`, () =>
                    postExecute(hookCTX, executeResponse)
                );
            }

            return { executed, response: executeResponse };
        } catch (err) {
            hookCTX.error = err as Error;
            await this.runHook("onError", hookCTX, async () =>
                this.client!.logger.error(`[Module] Failed to execute '${this.buildName()}'`, err as Error)
            );
            return { executed, response: undefined, error: err as Error };
        }
    }

    /** Custom pre-check before tests are ran. */
    protected abstract validate(): boolean;

    protected abstract createModuleCTX(args: Args): ModuleCTX;
    protected abstract createHookCTX(moduleCTX: ModuleCTX, args: Args): HookCTX;
}
