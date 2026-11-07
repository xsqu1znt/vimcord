import type { Vimcord } from "@/client/Vimcord.js";

import { ModuleError } from "@/errors/ModuleError.js";
import { createHumanId } from "@/utils/str.js";

export type ModuleTestResult<Passed extends boolean = boolean> = Passed extends true
    ? { passed: true }
    : { passed: false; reason: string; error?: Error };

/** The environment a module may run in, tested against the client's `$devMode`. */
export type ModuleEnvironment = "development" | "production" | "both";

/** Why an invocation stopped before reaching its handler. */
export type ModuleBlock = { kind: "environment"; reason: string } | { kind: "running" };

export interface ModuleExecutionTiming {
    /** Monotonic handler start timestamp. */
    startedAt: number;
    /** Handler wall-clock duration in milliseconds. */
    durationMs: number;
}

export interface ModuleRunResult {
    /** Whether the module's main execute function was reached. */
    executed: boolean;
    /** Value returned by the module's main execute function. */
    response: unknown;
    /** Error thrown by the module's main execute function, if any. */
    error?: Error;
    /** Handler timing, when the command usage logger measures this invocation. */
    executionTiming?: ModuleExecutionTiming;
}

// - - - - - - - - - - - - - - -

export interface ModuleContext<Ready extends boolean = true> {
    client: Vimcord<Ready>;
}

export interface ModuleHookContext<
    Args extends unknown[] = unknown[],
    Ready extends boolean = true,
    Module = AbstractModule<Args, any, any, any, any>
> {
    module: Module;
    client: Vimcord<Ready>;
    error?: Error;
}

// --- Module Options ---
export interface ModuleOptions<
    Args extends unknown[] = unknown[],
    ModuleCTX extends ModuleContext<boolean> = ModuleContext,
    HookCTX extends ModuleHookContext<Args, boolean, unknown> = ModuleHookContext<Args>,
    Hooks extends ModuleHooks<Args, HookCTX, any> = ModuleHooks<Args, HookCTX>
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
    /**
     * The environment this module is allowed to run in.
     * @default "both"
     */
    environment?: ModuleEnvironment;
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

export interface ModuleHooks<
    Args extends unknown[] = unknown[],
    HookCTX extends ModuleHookContext<Args, boolean, unknown> = ModuleHookContext<Args>,
    Block = ModuleBlock
> {
    /** Gates the handler. Anything but `true` stops the invocation; respond to the user here when you do. */
    before?(ctx: HookCTX): Promise<boolean> | boolean;
    /** Runs when an invocation is blocked. @defaultBehavior Blocks with a `reason` set `ctx.error` and run `onError`; a `running` block does nothing. */
    onBlocked?(ctx: HookCTX, block: Block): Promise<void> | void;
    /** @defaultBehavior Does nothing for blocks; logs errors thrown by the handler. */
    onError?(ctx: HookCTX): Promise<void> | void;
}

// --- Abstract Module ---
export abstract class AbstractModule<
    Args extends unknown[] = unknown[],
    ModuleCTX extends ModuleContext<boolean> = ModuleContext,
    HookCTX extends ModuleHookContext<Args, boolean, unknown> = ModuleHookContext<Args>,
    Hooks extends ModuleHooks<Args, HookCTX, any> = ModuleHooks<Args, HookCTX>,
    Block = ModuleBlock
> {
    readonly client: Vimcord | null = null;

    abstract readonly moduleType: string;
    readonly id: string;
    readonly name: string;
    readonly metadata: ModuleMetadata;

    readonly enabled: boolean;
    readonly requiresReady: boolean;
    readonly environment: ModuleEnvironment;
    readonly singleInvocation: { key(ctx: HookCTX): string } | undefined;
    readonly hooks: Hooks;

    /** Keys of invocations currently running, when `singleInvocation` is configured. */
    private readonly activeInvocationKeys: Set<string> | undefined;

    protected readonly execute: (ctx: ModuleCTX) => unknown;

    constructor(options: ModuleOptions<Args, ModuleCTX, HookCTX, Hooks>) {
        const { customId, name, metadata, enabled, requiresReady, environment, singleInvocation, hooks, execute } = options;
        this.id = customId ?? createHumanId();
        this.name = name;
        this.metadata = metadata ?? {};

        this.enabled = enabled ?? true;
        this.requiresReady = requiresReady ?? true;
        this.environment = environment ?? "both";
        this.singleInvocation = singleInvocation;
        this.activeInvocationKeys = singleInvocation ? new Set() : undefined;

        this.hooks = (hooks ?? {}) as Hooks;
        this.execute = execute;
    }

    inject(client: Vimcord): void {
        if (!this.client) {
            (this as { client: Vimcord | null }).client = client;
        }
    }

    // --- Tests & Rules ---
    protected testEnvironment(ctx: HookCTX): ModuleTestResult {
        if (this.environment === "both") return { passed: true };
        if (ctx.client.$devMode && this.environment !== "development") {
            return { passed: false, reason: "Client is in development mode" };
        }
        if (!ctx.client.$devMode && this.environment !== "production") {
            return { passed: false, reason: "Client is in production mode" };
        }

        return { passed: true };
    }

    protected performTests(ctx: HookCTX): boolean | Promise<boolean> {
        const result = this.testEnvironment(ctx);
        if (result.passed) return true;
        return this.block(ctx, { kind: "environment", reason: result.reason } as Block).then(() => false);
    }

    /** Reports a blocked invocation to `onBlocked`, or to the default handling when no hook is set. */
    protected async block(ctx: HookCTX, block: Block): Promise<void> {
        const onBlocked = this.getHook("onBlocked" as keyof Hooks) as ((ctx: HookCTX, block: Block) => unknown) | undefined;
        try {
            if (onBlocked) await onBlocked(ctx, block);
            else await this.handleUnobservedBlock(ctx, block);
        } catch (err) {
            this.client!.logger.error(`[Module] Hook 'onBlocked' failed for '${this.buildName()}'`, err as Error);
        }
    }

    /** Default handling of a block no `onBlocked` hook received. */
    protected async handleUnobservedBlock(ctx: HookCTX, block: Block): Promise<void> {
        const { reason } = block as { reason?: string };
        if (reason === undefined) return;
        ctx.error ??= new ModuleError(reason);
        await this.runHook("onError" as keyof Hooks, ctx);
    }

    /** Runs the `before` gate. Commands override this to compose the client's gate with the module's. */
    protected runBefore(ctx: HookCTX): Promise<boolean> {
        return this.callBefore(this.getHook("before" as keyof Hooks) as ((ctx: HookCTX) => unknown) | undefined, ctx);
    }

    protected async callBefore(before: ((ctx: HookCTX) => unknown) | undefined, ctx: HookCTX): Promise<boolean> {
        if (!before) return true;
        const result = await this.timed(
            () => `Ran hook 'before' for '${this.buildName()}'`,
            () => before(ctx)
        );
        return result === true;
    }

    // --- Internal Utilities ---
    protected checkInjection(): boolean | Promise<boolean> {
        if (!this.client) {
            console.warn(`[Module] '${this.buildName()}' is not injected`);
            return false;
        }
        if (!this.requiresReady || this.client.isReady()) return true;
        return this.client.awaitReady().then(ready => {
            if (!ready) console.warn(`[Module] '${this.buildName()}' client is not ready`);
            return ready;
        });
    }

    protected buildName(): string {
        return `${this.moduleType}:${this.name}`;
    }

    /** Returns the hook implementation for this module. */
    protected getHook<K extends keyof Hooks>(hook: K): Hooks[K] | undefined {
        return this.hooks[hook];
    }

    /** Prepares optional work, such as interaction deferral, before handler timing starts. */
    protected prepareExecute(_ctx: ModuleCTX): void | Promise<void> {}

    /** Awaits `fn`, logging `message` and how long it took when verbose logging is on. */
    private timed<T>(message: () => string, fn: () => Promise<T> | T): Promise<T> | T {
        if (!this.client?.logger.options.verbose) return fn();
        const label = message();
        const startedAt = performance.now();
        return Promise.resolve(fn()).then(result => {
            this.client!.logger.debug(`[Module] ${label} in ${(performance.now() - startedAt).toFixed(1)}ms`);
            return result;
        });
    }

    /** Runs a hook with relevant context and an optional fallback. */
    async runHook<K extends keyof Hooks, HookContext extends HookCTX>(
        hook: K,
        ctx: HookContext,
        fallback?: (ctx: HookContext) => Promise<void>
    ): Promise<void> {
        const injected = this.checkInjection();
        if (!(typeof injected === "boolean" ? injected : await injected)) return;
        const hookFn = this.getHook(hook) as ((ctx: HookContext) => Promise<void>) | undefined;

        try {
            if (hookFn) {
                await this.timed(
                    () => `Ran hook '${String(hook)}' for '${this.buildName()}'`,
                    () => hookFn(ctx)
                );
            } else if (fallback) {
                await this.timed(
                    () => `Ran fallback hook '${String(hook)}' for '${this.buildName()}'`,
                    () => fallback(ctx)
                );
            }
        } catch (err) {
            this.client!.logger.error(`[Module] Hook '${String(hook)}' failed for '${this.buildName()}'`, err as Error);
        }
    }

    /**
     * Execute order:
     *
     * try:`performTests` -> `hook:before` -> `singleInvocation` check -> `execute`
     *
     * catch:`hook:onError`
     */
    run(...args: Args): Promise<unknown> {
        return this.invoke(args, result => result.response);
    }

    /**
     * Runs the module and reports whether its main execute function was reached.
     * @param args Arguments passed to the module
     */
    runWithResult(...args: Args): Promise<ModuleRunResult> {
        return this.invoke(args, result => result);
    }

    /** Completes a module invocation in the same async frame as its handler. */
    protected async invoke<Result>(
        args: Args,
        complete: (result: ModuleRunResult) => Result,
        measure = false
    ): Promise<Result> {
        let executionTiming: ModuleExecutionTiming | undefined;
        let executed = false;
        if (!this.enabled) return complete({ executed, response: undefined });
        const injected = this.checkInjection();
        if (!(typeof injected === "boolean" ? injected : await injected)) return complete({ executed, response: undefined });
        const moduleCTX = this.createModuleCTX(args);
        const hookCTX = this.createHookCTX(moduleCTX, args);

        try {
            const valid = this.validate();
            if (!valid) return complete({ executed, response: undefined });

            const passed = this.performTests(hookCTX);
            if (!(typeof passed === "boolean" ? passed : await passed)) return complete({ executed, response: undefined });

            if (this.getHook("before" as keyof Hooks) && !(await this.runBefore(hookCTX))) {
                if (this.client?.logger.options.verbose)
                    this.client.logger.debug(`[Module] before halted execution for '${this.buildName()}'`);
                return complete({ executed, response: undefined });
            }

            let invocationKey: string | undefined;
            if (this.singleInvocation) {
                invocationKey = this.singleInvocation.key(hookCTX);
                if (this.activeInvocationKeys!.has(invocationKey)) {
                    await this.block(hookCTX, { kind: "running" } as Block);
                    return complete({ executed, response: undefined });
                }
                this.activeInvocationKeys!.add(invocationKey);
            }

            let executeResponse: unknown;
            try {
                const preparation = this.prepareExecute(moduleCTX);
                if (preparation) await preparation;
                executed = true;
                if (measure) executionTiming = { startedAt: performance.now(), durationMs: 0 };
                try {
                    executeResponse = await (this.client!.logger.options.verbose
                        ? this.timed(
                              () => `Executed '${this.buildName()}'`,
                              () => this.execute(moduleCTX)
                          )
                        : this.execute(moduleCTX));
                } finally {
                    if (executionTiming) executionTiming.durationMs = performance.now() - executionTiming.startedAt;
                }
            } finally {
                if (invocationKey !== undefined) this.activeInvocationKeys!.delete(invocationKey);
            }

            return complete({ executed, response: executeResponse, executionTiming });
        } catch (err) {
            hookCTX.error = err as Error;
            await this.runHook("onError", hookCTX, async () =>
                this.client!.logger.error(`[Module] Failed to execute '${this.buildName()}'`, err as Error)
            );
            return complete({ executed, response: undefined, error: err as Error, executionTiming });
        }
    }

    /** Custom pre-check before tests are ran. */
    protected validate(): boolean {
        return true;
    }

    protected abstract createModuleCTX(args: Args): ModuleCTX;
    protected createHookCTX(moduleCTX: ModuleCTX, _args: Args): HookCTX {
        const ctx = moduleCTX as unknown as HookCTX;
        ctx.module = this as unknown as HookCTX["module"];
        return ctx;
    }
}
