import type { Vimcord } from "@/client/Vimcord.js";

import { createHumanId } from "@vimcord/internal";
import { ModuleError } from "@/errors/ModuleError.js";

export type ModuleTestResult<Passed extends boolean = boolean> = Passed extends true
    ? { passed: true }
    : { passed: false; reason: string; error?: Error };
export type ModuleConditionFn<Args extends any[] = any[]> = (
    ctx: ModuleContext<Args>
) => Promise<ModuleTestResult> | ModuleTestResult;

export interface ModuleContext<Args extends any[] = any[], ExecuteResult = unknown> {
    client: Vimcord<true>;
    args: Args;
    error?: Error;
    deploymentTestResult?: ModuleTestResult;
    conditionTestResult?: ModuleTestResult;
    executeResult?: ExecuteResult;
}

// --- Module Options ---
export interface ModuleOptions<
    Args extends any[] = any[],
    ExecuteResult = unknown,
    Hooks extends ModuleHooks<Args, ExecuteResult> = ModuleHooks<Args, ExecuteResult>
> {
    /** Custom module id. Otherwise powered by [human-id](https://www.npmjs.com/package/human-id). */
    customId?: string;
    /** The name of the module. */
    name: string;
    /** The metadata of the module. */
    metadata?: ModuleMetadata;

    // --- Tests & Rules ---
    /**
     * Whether this module is enabled.
     * @default true
     */
    enabled?: boolean;
    /** The deployment rules of the module. */
    deployment?: ModuleDeploymentRules;
    /** The condition rules of the module. Conditions are tested in the order they are defined. */
    conditions?: ModuleConditionFn<Args>[];

    // --- Hooks ---
    /** The hooks of the module. */
    hooks?: Hooks;

    // --- Main ---
    execute(client: Vimcord<true>, ...args: Args): Promise<ExecuteResult>;
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
    Args extends any[] = any[],
    ExecuteResult = unknown,
    CTX extends ModuleContext<Args, ExecuteResult> = ModuleContext<Args, ExecuteResult>
> {
    /** @defaultBehavior Alias for `onError`. */
    onDeploymentTestFail?(ctx: CTX): Promise<void>;
    /** @defaultBehavior Alias for `onError`. */
    onConditionTestFail?(ctx: CTX): Promise<void>;
    /** @defaultBehavior Does nothing. */
    onError?(ctx: CTX): Promise<void>;
    /** @defaultBehavior Does nothing. */
    preExecute?(ctx: CTX, next: () => void): Promise<void>;
    /** @defaultBehavior Does nothing. */
    postExecute?(ctx: CTX): Promise<void>;
}

// --- Abstract Module ---
export abstract class AbstractModule<
    Args extends any[] = any[],
    ExecuteResult = unknown,
    Hooks extends ModuleHooks<Args, ExecuteResult> = ModuleHooks<Args, ExecuteResult>
> {
    readonly client: Vimcord | null = null;

    readonly id: string;
    readonly name: string;
    readonly metadata: ModuleMetadata;

    readonly enabled: boolean;
    readonly deployment: ModuleDeploymentRules;
    protected readonly conditions: ModuleConditionFn<Args>[];

    protected readonly hooks: Hooks;

    protected readonly execute: (client: Vimcord<true>, ...args: Args) => Promise<ExecuteResult>;

    constructor(options: ModuleOptions<Args, ExecuteResult, Hooks>) {
        const { customId, name, metadata, enabled, deployment, conditions, hooks, execute } = options;
        this.id = customId ?? createHumanId();
        this.name = name;
        this.metadata = metadata ?? {};

        this.enabled = enabled ?? true;
        this.deployment = { environment: "both", ...deployment };
        this.conditions = conditions ?? [];

        this.hooks = (hooks ?? {}) as Hooks;
        this.execute = execute;
    }

    private async checkInjection(): Promise<boolean> {
        if (!this.client) {
            console.warn(`[Module] '${this.name}' (${this.id}) is not injected`);
            return false;
        }

        const ready = await this.client.awaitReady();
        if (!ready) console.warn(`[Module] '${this.name}' (${this.id}) client is not ready`);
        return ready;
    }

    inject(client: Vimcord<true>): void {
        if (!this.client) {
            (this as { client: Vimcord | null }).client = client;
        }
    }

    // --- Tests & Rules ---
    protected async testDeployment(ctx: ModuleContext<Args, ExecuteResult>): Promise<ModuleTestResult> {
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

    protected async testConditions(ctx: ModuleContext<Args, ExecuteResult>): Promise<ModuleTestResult> {
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
    protected async performTests(ctx: ModuleContext<Args, ExecuteResult>): Promise<boolean> {
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

    /** Runs a hook with relevant context and an optional fallback. */
    protected async runHook<K extends keyof Hooks, CTX extends ModuleContext<Args, ExecuteResult>>(
        hook: K,
        ctx: CTX,
        fallback?: (ctx: CTX) => Promise<void>
    ): Promise<void> {
        if (!(await this.checkInjection())) return;
        const hookFn = this.hooks[hook] as ((ctx: CTX) => Promise<void>) | undefined;

        try {
            if (hookFn) {
                const debug_hook_start = Date.now();
                await hookFn(ctx);
                const debug_hook_end = Date.now();
                this.client?.logger.debugVerbose(
                    `[Module] Ran hook '${String(hook)}' for '${this.name}' (${this.id}) in ${debug_hook_end - debug_hook_start}ms`
                );
            } else if (fallback) {
                const debug_fallback_start = Date.now();
                await fallback(ctx);
                const debug_fallback_end = Date.now();
                this.client?.logger.debugVerbose(
                    `[Module] Ran fallback hook '${String(hook)}' for '${this.name}' (${this.id}) in ${debug_fallback_end - debug_fallback_start}ms`
                );
            }
        } catch (err) {
            this.client!.logger.error(
                `[Module] Hook '${String(hook)}' failed for '${this.name}' (${this.id})`,
                err as Error
            );
        }
    }

    /**
     * Execute order:
     *
     * try:`performTests` -> `hook:preExecute` -> `execute` -> `hook:postExecute`
     *
     * catch:`onError`
     */
    async run(...args: Args): Promise<ExecuteResult | undefined> {
        if (!(await this.checkInjection())) return;
        const ctx: ModuleContext<Args, ExecuteResult> = { client: this.client as Vimcord<true>, args };

        try {
            const valid = this.validate();
            if (!valid) return;

            const passed = await this.performTests(ctx);
            if (!passed) return;

            if (this.hooks.preExecute) {
                let next = false;
                await this.hooks.preExecute(ctx, () => (next = true));
                if (!next) {
                    this.client?.logger.debugVerbose(`[Module] preExecute halted execution for '${this.name}' (${this.id})`);
                    return;
                }
            }

            const debug_execute_start = Date.now();
            const executeResult = await this.execute(this.client as Vimcord<true>, ...args);
            const debug_execute_end = Date.now();
            this.client?.logger.debugVerbose(
                `[Module] Executed '${this.name}' (${this.id}) in ${debug_execute_end - debug_execute_start}ms`
            );

            ctx.executeResult = executeResult;
            await this.runHook("postExecute", ctx);

            return executeResult;
        } catch (err) {
            ctx.error = err as Error;
            await this.runHook("onError", ctx, async () =>
                this.client!.logger.error(`[Module] Failed to execute '${this.name}' (${this.id})`, err as Error)
            );
        }
    }

    /** Custom pre-check before tests are ran. */
    protected abstract validate(): boolean;
}
