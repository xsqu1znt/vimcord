import type { Vimcord } from "@/client/Vimcord.js";

import { createHumanId } from "@vimcord/internal";
import { ModuleError } from "@/errors/ModuleError.js";

export type ModuleTestResult<Passed extends boolean = boolean> = Passed extends true
    ? { passed: true }
    : { passed: false; reason: string; error?: Error };
export type ModuleConditionFn<CTX = ModuleHookContext> = (ctx: CTX) => Promise<ModuleTestResult> | ModuleTestResult;

// - - - - - - - - - - - - - - -

export interface ModuleContext {
    client: Vimcord<true>;
}

export interface ModuleHookContext<Args extends unknown[] = unknown[]> {
    module: AbstractModule<Args>;
    client: Vimcord<true>;
    args: Args;
    error?: Error;
    deploymentTestResult?: ModuleTestResult;
    conditionTestResult?: ModuleTestResult;
}

// --- Module Options ---
export interface ModuleOptions<
    Args extends unknown[] = unknown[],
    ModuleCTX extends ModuleContext = ModuleContext,
    HookCTX extends ModuleHookContext<Args> = ModuleHookContext<Args>,
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
    HookCTX extends ModuleHookContext<Args> = ModuleHookContext<Args>
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
}

// --- Abstract Module ---
export abstract class AbstractModule<
    Args extends unknown[] = unknown[],
    ModuleCTX extends ModuleContext = ModuleContext,
    HookCTX extends ModuleHookContext<Args> = ModuleHookContext<Args>,
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
    readonly hooks: Hooks;

    protected readonly execute: (ctx: ModuleCTX) => unknown;

    constructor(options: ModuleOptions<Args, ModuleCTX, HookCTX, Hooks>) {
        const { customId, name, metadata, enabled, requiresReady, deployment, conditions, hooks, execute } = options;
        this.id = customId ?? createHumanId();
        this.name = name;
        this.metadata = metadata ?? {};

        this.enabled = enabled ?? true;
        this.requiresReady = requiresReady ?? true;
        this.deployment = { environment: "both", ...deployment };
        this.conditions = conditions ?? [];

        this.hooks = (hooks ?? {}) as Hooks;
        this.execute = execute;
    }

    inject(client: Vimcord): void {
        if (!this.client) {
            (this as { client: Vimcord | null }).client = client;
        }
    }

    // --- Tests & Rules ---
    protected async testDeployment(ctx: HookCTX): Promise<ModuleTestResult> {
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
        if (!this.enabled) return false;

        const deploymentTestResult = await this.testDeployment(ctx);
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

        if (!this.requiresReady) return true;

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
                const debug_hook_start = Date.now();
                await hookFn(ctx);
                const debug_hook_end = Date.now();
                this.client?.logger.debugVerbose(
                    `[Module] Ran hook '${String(hook)}' for '${this.buildName()}' in ${debug_hook_end - debug_hook_start}ms`
                );
            } else if (fallback) {
                const debug_fallback_start = Date.now();
                await fallback(ctx);
                const debug_fallback_end = Date.now();
                this.client?.logger.debugVerbose(
                    `[Module] Ran fallback hook '${String(hook)}' for '${this.buildName()}' in ${debug_fallback_end - debug_fallback_start}ms`
                );
            }
        } catch (err) {
            this.client!.logger.error(`[Module] Hook '${String(hook)}' failed for '${this.buildName()}'`, err as Error);
        }
    }

    /**
     * Execute order:
     *
     * try:`performTests` -> `hook:preExecute` -> `execute` -> `hook:postExecute`
     *
     * catch:`hook:onError`
     */
    async run(...args: Args) {
        if (!(await this.checkInjection())) return;
        const moduleCTX = this.createModuleCTX(args);
        const hookCTX = this.createHookCTX(args);

        try {
            const valid = this.validate();
            if (!valid) return;

            const passed = await this.performTests(hookCTX);
            if (!passed) return;

            const preExecute = this.getHook("preExecute" as keyof Hooks) as
                ((ctx: HookCTX, next: () => void) => Promise<void>) | undefined;
            if (preExecute) {
                let next = false;
                const debug_preExecute_start = Date.now();
                await preExecute(hookCTX, () => (next = true));
                const debug_preExecute_end = Date.now();
                this.client?.logger.debugVerbose(
                    `[Module] Ran hook 'preExecute' for '${this.buildName()}' in ${debug_preExecute_end - debug_preExecute_start}ms`
                );

                if (!next) {
                    this.client?.logger.debugVerbose(`[Module] preExecute halted execution for '${this.buildName()}'`);
                    return;
                }
            }

            const debug_execute_start = Date.now();
            const executeResponse = await this.execute(moduleCTX);
            const debug_execute_end = Date.now();
            this.client?.logger.debugVerbose(
                `[Module] Executed '${this.buildName()}' in ${debug_execute_end - debug_execute_start}ms`
            );

            const postExecute = this.getHook("postExecute" as keyof Hooks) as
                ((ctx: HookCTX, executeResponse: unknown) => Promise<void>) | undefined;
            if (postExecute) {
                const debug_postExecute_start = Date.now();
                await postExecute(hookCTX, executeResponse);
                const debug_postExecute_end = Date.now();
                this.client?.logger.debugVerbose(
                    `[Module] Ran hook 'postExecute' for '${this.buildName()}' in ${debug_postExecute_end - debug_postExecute_start}ms`
                );
            }

            return executeResponse;
        } catch (err) {
            hookCTX.error = err as Error;
            await this.runHook("onError", hookCTX, async () =>
                this.client!.logger.error(`[Module] Failed to execute '${this.buildName()}'`, err as Error)
            );
        }
    }

    /** Custom pre-check before tests are ran. */
    protected abstract validate(): boolean;

    protected abstract createModuleCTX(args: Args): ModuleCTX;
    protected abstract createHookCTX(args: Args): HookCTX;
}
