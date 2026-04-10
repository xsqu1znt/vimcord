import type { Vimcord } from "@/client/Vimcord.js";

import { createHumanId } from "@vimcord/internal";
import { ModuleError } from "@/errors/ModuleError.js";

export type ModuleTestResult = { passed: true } | { passed: false; reason: string; error?: Error };
export type ModuleConditionFn<Args extends any[] = any[]> = (
    ctx: ModuleContext<Args>
) => Promise<ModuleTestResult> | ModuleTestResult;

export interface ModuleContext<Args extends any[] = any[], ExecuteResult = unknown> {
    client: Vimcord;
    args: Args;
    error?: Error;
    deploymentTestResult?: ModuleTestResult;
    conditionTestResult?: ModuleTestResult;
    executeResult?: ExecuteResult;
}

// --- Module Options ---
export interface ModuleOptions<Args extends any[] = any[], ExecuteResult = unknown> {
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
    hooks?: ModuleHooks<Args, ExecuteResult>;

    // --- Main ---
    execute(client: Vimcord, ...args: Args): Promise<ExecuteResult>;
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

export interface ModuleHooks<Args extends any[] = any[], ExecuteResult = unknown> {
    /** @defaultBehavior Alias for `onError`. */
    onDeploymentTestFail?(ctx: ModuleContext<Args, ExecuteResult>): Promise<void>;
    /** @defaultBehavior Alias for `onError`. */
    onConditionTestFail?(ctx: ModuleContext<Args, ExecuteResult>): Promise<void>;
    /** @defaultBehavior Does nothing. */
    onError?(ctx: ModuleContext<Args, ExecuteResult>): Promise<void>;
    /** @defaultBehavior Does nothing. */
    preExecute?(ctx: ModuleContext<Args, ExecuteResult>): Promise<void>;
    /** @defaultBehavior Does nothing. */
    postExecute?(ctx: ModuleContext<Args, ExecuteResult>): Promise<void>;
}

// --- Abstract Module ---
export abstract class AbstractModule<Args extends any[] = any[], ExecuteResult = unknown> {
    readonly id: string;
    readonly name: string;
    readonly metadata: ModuleMetadata;

    readonly enabled: boolean;
    readonly deployment: ModuleDeploymentRules;
    readonly conditions: ModuleConditionFn<Args>[];

    readonly hooks: ModuleHooks<Args, ExecuteResult>;

    readonly execute: (client: Vimcord, ...args: Args) => Promise<ExecuteResult>;

    constructor(
        readonly client: Vimcord,
        options: ModuleOptions<Args, ExecuteResult>
    ) {
        const { customId, name, metadata, enabled, deployment, conditions, hooks, execute } = options;
        this.id = customId ?? createHumanId();
        this.name = name;
        this.metadata = metadata ?? {};

        this.enabled = enabled ?? true;
        this.deployment = { environment: "both", ...deployment };
        this.conditions = conditions ?? [];

        this.hooks = hooks ?? {};
        this.execute = execute;
    }

    // --- Tests & Rules ---
    protected testDeployment(): ModuleTestResult {
        if (this.deployment.environment === "both") {
            return { passed: true };
        }
        if (this.client.$devMode && this.deployment.environment !== "development") {
            return { passed: false, reason: "Client is in development mode" };
        }
        if (!this.client.$devMode && this.deployment.environment !== "production") {
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

        const deploymentTestResult = this.testDeployment();
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

    /**
     * Execute order:
     *
     * try:`performTests` -> `hook:preExecute` -> `execute` -> `hook:postExecute`
     *
     * catch:`onError`
     */
    protected async run(...args: Args): Promise<ExecuteResult | undefined> {
        const ctx: ModuleContext<Args, ExecuteResult> = { client: this.client, args };

        try {
            const valid = this.validate();
            if (!valid) return;

            const passed = await this.performTests(ctx);
            if (!passed) return;

            await this.runHook("preExecute", ctx);
            const executeResult = await this.execute(this.client, ...args);
            ctx.executeResult = executeResult;

            await this.runHook("postExecute", ctx);

            return executeResult;
        } catch (err) {
            ctx.error = err as Error;
            await this.runHook("onError", ctx, async () =>
                this.client.logger.error(`[Module] Failed to execute '${this.name}' (${this.id})`, err as Error)
            );
        }
    }

    /** Runs a hook with relevant context and an optional fallback. */
    async runHook<K extends keyof ModuleHooks<Args, ExecuteResult>>(
        hook: K,
        ctx: ModuleContext<Args, ExecuteResult>,
        fallback?: (ctx: ModuleContext<Args, ExecuteResult>) => Promise<void>
    ): Promise<void> {
        const hookFn = this.hooks[hook];

        try {
            if (hookFn) {
                await hookFn(ctx);
            } else if (fallback) {
                await fallback(ctx);
            }
        } catch (err) {
            this.client.logger.error(`[Module] Hook '${hook}' failed for '${this.name}' (${this.id})`, err as Error);
        }
    }

    abstract validate(): boolean;
}
