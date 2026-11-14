import type { Vimcord } from "@/client/Vimcord.js";

import { createHumanId } from "@/utils/str.js";

/** Whether a module check passed, with failure details when it did not. */
export type ModuleTestResult<Passed extends boolean = boolean> = Passed extends true
    ? {
          /** Whether the check passed. */
          passed: true;
      }
    : {
          /** Whether the check passed. */
          passed: false;
          /** Why the operation stopped or the check failed. */
          reason: string;
          /** Error raised while handling the invocation. */
          error?: Error;
      };

/** The environment a module may run in, tested against the client's `$devMode`. */
export type ModuleEnvironment = "development" | "production" | "both";

/** Why an invocation stopped before reaching its handler. */
export type ModuleBlock =
    | {
          /** Discriminator identifying the blocked invocation. */
          kind: "environment";
          /** Why the operation stopped or the check failed. */
          reason: string;
      }
    | {
          /** Discriminator identifying the blocked invocation. */
          kind: "running";
      };

/** Handler timestamps used by command usage logging. */
export interface ModuleExecutionTiming {
    /** Monotonic handler start timestamp. */
    startedAt: number;
    /** Handler wall-clock duration in milliseconds. */
    durationMs: number;
}

/** Outcome of a module invocation, including handler errors and measured timing. */
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

/** Client supplied to a module handler. */
export interface ModuleContext<Ready extends boolean = true> {
    /** Client that owns or runs this operation. */
    client: Vimcord<Ready>;
}

/** Module and client supplied to lifecycle hooks. */
export interface ModuleHookContext<
    Args extends unknown[] = unknown[],
    Ready extends boolean = true,
    Module = AbstractModule<Args, any, any, any, any>
> {
    /** Module whose invocation the hook observes. */
    module: Module;
    /** Client that owns or runs this operation. */
    client: Vimcord<Ready>;
}

// --- Module Options ---
/** Shared module identity, invocation rules, hooks, and handler. */
export interface ModuleOptions<
    Args extends unknown[] = unknown[],
    ModuleCTX extends ModuleContext<boolean> = ModuleContext,
    HookCTX extends ModuleHookContext<Args, boolean, unknown> = ModuleHookContext<Args>,
    Hooks extends ModuleHooks<Args, HookCTX, any> = ModuleHooks<Args, HookCTX>
> {
    /** Stable module identifier. @default generated human-readable ID */
    id?: string;
    /** The name of the module. */
    name: string;
    /** Optional description of the module. */
    description?: string;
    /** Project-defined categorization and display fields. @default {} */
    metadata?: ModuleMetadata;

    // --- Tests & Rules ---
    /** Whether this module is enabled. @default true */
    enabled?: boolean;
    /** Whether this module should wait for the client to be ready before being runnable. @default true */
    requiresReady?: boolean;
    /** The environment this module is allowed to run in. @default "both" */
    environment?: ModuleEnvironment;
    /** Skips overlapping invocations with the same process-local key. @default undefined */
    singleInvocation?: {
        /** Returns the identity key for an invocation. Invocations sharing a key never run concurrently. */
        key(ctx: HookCTX): string;
    };

    // --- Hooks ---
    /** Callbacks for invocation gates and failures. @default {} */
    hooks?: Hooks;

    // --- Main ---
    /** The main function of the module. */
    execute(ctx: ModuleCTX): unknown;
}

/** Project-defined categorization attached to a module. */
export interface ModuleMetadata {
    /** Category for categorizing modules. */
    category?: string[];
    /** Tags for categorizing modules. */
    tags?: string[];
}

/** Callbacks that gate invocations and handle blocks or failures. */
export interface ModuleHooks<
    Args extends unknown[] = unknown[],
    HookCTX extends ModuleHookContext<Args, boolean, unknown> = ModuleHookContext<Args>,
    Block = ModuleBlock
> {
    /** Gates the handler. Anything but `true` stops the invocation; respond to the user here when you do. */
    before?(ctx: HookCTX): Promise<boolean> | boolean;
    /** Handles a blocked invocation; without a hook, commands send their default reply and events ignore it. */
    onBlocked?(ctx: HookCTX, block: Block): Promise<void> | void;
    /** Handles a thrown handler or gate; without a hook, the error is logged and commands also send their default reply. */
    onError?(ctx: HookCTX, error: Error): Promise<void> | void;
}

// --- Abstract Module ---
/** Base for modules with lifecycle hooks and invocation guards. */
export abstract class AbstractModule<
    Args extends unknown[] = unknown[],
    ModuleCTX extends ModuleContext<boolean> = ModuleContext,
    HookCTX extends ModuleHookContext<Args, boolean, unknown> = ModuleHookContext<Args>,
    Hooks extends ModuleHooks<Args, HookCTX, any> = ModuleHooks<Args, HookCTX>,
    Block = ModuleBlock
> {
    /** Client that owns or runs this operation. */
    readonly client: Vimcord | null = null;

    /** Module kind displayed in logs. */
    abstract readonly moduleType: string;
    /** Stable identifier assigned to this instance. */
    readonly id: string;
    /** Name displayed in logs or command discovery. */
    readonly name: string;
    /** Project-defined display and categorization fields. */
    readonly metadata: ModuleMetadata;

    /** Whether this module may run. */
    readonly enabled: boolean;
    /** Whether invocation waits for the client to become ready. */
    readonly requiresReady: boolean;
    /** Environment in which this module may run. */
    readonly environment: ModuleEnvironment;
    /** Scope used to skip overlapping invocations. */
    readonly singleInvocation:
        | {
              /** Returns the identity used to group matching invocations. */
              key(ctx: HookCTX): string;
          }
        | undefined;
    /** Callbacks for invocation gates, blocks, and errors. */
    readonly hooks: Hooks;

    /** Keys of invocations currently running, when `singleInvocation` is configured. */
    private readonly activeInvocationKeys: Set<string> | undefined;

    protected readonly execute: (ctx: ModuleCTX) => unknown;

    constructor(options: ModuleOptions<Args, ModuleCTX, HookCTX, Hooks>) {
        const { id, name, metadata, enabled, requiresReady, environment, singleInvocation, hooks, execute } = options;
        this.id = id ?? createHumanId();
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

    /** Attaches the owning client before the module can run. */
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

    /** Default handling of a block no `onBlocked` hook received. Blocks are silent unless a subclass answers them. */
    protected handleUnobservedBlock(_ctx: HookCTX, _block: Block): void | Promise<void> {}

    /** Default handling of an error no `onError` hook received: logs it. Commands also reply to the user. */
    protected handleUnobservedError(_ctx: HookCTX, error: Error): void | Promise<void> {
        this.client!.logger.error(`[Module] Failed to execute '${this.buildName()}'`, error);
    }

    /** Reports a thrown handler or gate to `onError`, or to the default handling when no hook is set. */
    protected async handleError(ctx: HookCTX, error: Error): Promise<void> {
        const onError = this.getHook("onError" as keyof Hooks) as ((ctx: HookCTX, error: Error) => unknown) | undefined;
        try {
            if (onError) {
                await this.timed(
                    () => `Ran hook 'onError' for '${this.buildName()}'`,
                    () => onError(ctx, error)
                );
            } else await this.handleUnobservedError(ctx, error);
        } catch (err) {
            this.client!.logger.error(`[Module] Hook 'onError' failed for '${this.buildName()}'`, err as Error);
        }
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

    /** Execute order: */
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
            await this.handleError(hookCTX, err as Error);
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
