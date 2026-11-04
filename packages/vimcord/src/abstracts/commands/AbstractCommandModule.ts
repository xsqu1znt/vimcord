import type { CommandLoggingTiming } from "@/client/globals.js";
import type { Vimcord } from "@/client/Vimcord.js";
import type { GlobalCommandHooks } from "@/commands/commandHooks.js";
import type { CommandModulePermissions } from "@/commands/commandPermissions.js";
import type { ModuleRunResult } from "../AbstractModule.js";
import type {
    CommandModuleArgs,
    CommandModuleContext,
    CommandModuleHookContext,
    CommandModuleHooks,
    CommandModuleMetadata,
    CommandModuleOptions
} from "./CommandModuleTypeKit.js";

import { applyDeferReply } from "@/commands/commandDeferral.js";
import { getGlobalCommandHooks } from "@/commands/commandHooks.js";
import { resolveInvokingUser, testCommandPermissions } from "@/commands/commandPermissions.js";
import { ModuleError } from "@/errors/ModuleError.js";
import { AbstractModule } from "../AbstractModule.js";
import { CommandModuleType } from "./CommandModuleTypeKit.js";

// Used when global logging is omitted or a command explicitly opts back in.
const DEFAULT_COMMAND_LOGGING = ["execute"] as const;
const MATCHED_COMMAND = () => true;

function getCommandHooks<T extends CommandModuleType>(
    type: T,
    hooks: GlobalCommandHooks | undefined
): CommandModuleHooks<T> | undefined {
    const key = type === CommandModuleType.Prefix ? "prefix" : type === CommandModuleType.Slash ? "slash" : "context";
    return hooks?.[key] as CommandModuleHooks<T> | undefined;
}

export abstract class AbstractCommandModule<T extends CommandModuleType> extends AbstractModule<
    CommandModuleArgs<T>,
    CommandModuleContext<T>,
    CommandModuleHookContext<T>,
    CommandModuleHooks<T>
> {
    abstract readonly type: T;
    protected directExecution = false;
    readonly deferReply?: Parameters<typeof applyDeferReply>[1];
    protected readonly permissions: CommandModulePermissions | undefined;
    override readonly hooks: CommandModuleHooks<T>;
    readonly description?: string;
    override readonly metadata: CommandModuleMetadata;

    constructor(options: CommandModuleOptions<T>) {
        super({
            ...options,
            singleInvocation:
                options.singleInvocation === true
                    ? { key: (ctx: CommandModuleHookContext<T>) => this.defaultInvocationKey(ctx) }
                    : options.singleInvocation || undefined
        });

        this.description = options.description;
        this.permissions = options.permissions;
        this.hooks = options.hooks ?? {};
        this.metadata = options.metadata ?? {};
    }

    /** Dispatches a matched command and emits only the selected usage timings. */
    dispatch(...args: CommandModuleArgs<T>): Promise<boolean> {
        // --- Select usage timing ---
        const logging = this.client!.globals.app.commandLogging ?? DEFAULT_COMMAND_LOGGING;
        const logUsage = this.metadata.logUsage ?? (logging !== false && logging.length > 0);
        let selected: readonly CommandLoggingTiming[] | undefined;
        let startedAt: number | undefined;
        let recognizedAt: number | undefined;
        let measure = false;
        if (logUsage) {
            selected = logging === false || !logging.length ? DEFAULT_COMMAND_LOGGING : logging;
            const executeOnly = selected.length === 1 && selected[0] === "execute";
            measure = executeOnly || selected.includes("execute") || selected.includes("preExecute");
            if (!executeOnly && (selected.includes("total") || selected.includes("preExecute")))
                startedAt = performance.now();
            if (!executeOnly && selected.includes("delivery")) recognizedAt = Date.now();
        }

        // --- Run optional module stages ---
        if (
            !this.canExecuteDirectly() ||
            !this.enabled ||
            !this.client ||
            (this.requiresReady && !this.client.isReady()) ||
            this.client.logger.options.verbose ||
            this.permissions ||
            this.conditions.length ||
            this.singleInvocation ||
            this.deployment.environment !== "both" ||
            ("author" in args[0] ? args[0].author : args[0].user).bot ||
            this.getHook("preExecute") ||
            this.getHook("postExecute")
        ) {
            const complete = selected
                ? (result: ModuleRunResult): boolean => {
                      if (result.executed)
                          this.logUsage(
                              args[0],
                              selected,
                              startedAt,
                              recognizedAt,
                              result.executionTiming?.startedAt,
                              result.executionTiming?.durationMs,
                              result.error
                          );
                      return true;
                  }
                : MATCHED_COMMAND;
            return this.invoke(args, complete, measure);
        }

        // --- Call the handler directly ---
        const ctx = this.createModuleCTX(args);
        const executionStartedAt = measure ? performance.now() : undefined;
        const finish = selected
            ? (): boolean => {
                  const durationMs = executionStartedAt === undefined ? undefined : performance.now() - executionStartedAt;
                  this.logUsage(args[0], selected, startedAt, recognizedAt, executionStartedAt, durationMs);
                  return true;
              }
            : MATCHED_COMMAND;
        const failed = (error: unknown): Promise<boolean> => {
            const durationMs = executionStartedAt === undefined ? undefined : performance.now() - executionStartedAt;
            const hookCTX = this.createHookCTX(ctx, args);
            hookCTX.error = error as Error;
            return this.runHook("onError", hookCTX, async () =>
                this.client!.logger.error(`[Module] Failed to execute '${this.buildName()}'`, error as Error)
            ).then(() => {
                if (selected)
                    this.logUsage(
                        args[0],
                        selected,
                        startedAt,
                        recognizedAt,
                        executionStartedAt,
                        durationMs,
                        error as Error
                    );
                return true;
            });
        };
        try {
            return Promise.resolve(this.execute(ctx)).then(finish, failed);
        } catch (error) {
            return failed(error);
        }
    }

    /** Builds the final log entry directly, without an intermediate invocation result for direct handlers. */
    private logUsage(
        source: CommandModuleArgs<T>[0],
        selected: readonly CommandLoggingTiming[],
        startedAt: number | undefined,
        recognizedAt: number | undefined,
        executionStartedAt: number | undefined,
        executionDurationMs: number | undefined,
        error?: Error
    ): void {
        const totalDuration = startedAt === undefined ? undefined : performance.now() - startedAt;
        const timings =
            selected.length === 1 && selected[0] === "execute"
                ? [{ timing: "execute" as const, durationMs: executionDurationMs }]
                : selected.map(timing => {
                      let durationMs: number | undefined;
                      switch (timing) {
                          case "delivery": {
                              const delivery = recognizedAt === undefined ? -1 : recognizedAt - source.createdTimestamp;
                              durationMs = delivery >= 0 ? delivery : undefined;
                              break;
                          }
                          case "preExecute":
                              durationMs =
                                  executionStartedAt === undefined || startedAt === undefined
                                      ? undefined
                                      : executionStartedAt - startedAt;
                              break;
                          case "execute":
                              durationMs = executionDurationMs;
                              break;
                          case "total":
                              durationMs = totalDuration;
                      }
                      return { timing, durationMs };
                  });
        const guild = source.guild;
        this.client!.logger.commandUsed({
            commandName: this.name,
            userName: ("author" in source ? source.author : source.user).username,
            guildName: guild?.name,
            guildId: guild?.id,
            durationMs: totalDuration,
            timings,
            failed: Boolean(error)
        });
    }

    protected canExecuteDirectly(): boolean {
        return this.directExecution && !this.deferReply;
    }

    protected override shouldMeasureExecution(): boolean {
        if (this.metadata.logUsage === false) return false;
        const logging = this.client?.globals.app.commandLogging;
        if (logging === false || logging?.length === 0) return this.metadata.logUsage === true;
        return !logging || logging.includes("execute") || logging.includes("preExecute");
    }

    protected deferInteraction(ctx: CommandModuleContext<T>, deferReply = this.deferReply): void | Promise<void> {
        if (deferReply && "interaction" in ctx && !ctx.interaction.replied && !ctx.interaction.deferred) {
            return applyDeferReply(ctx.interaction, deferReply);
        }
    }

    protected override prepareExecute(ctx: CommandModuleContext<T>): void | Promise<void> {
        return this.deferInteraction(ctx);
    }

    protected override createModuleCTX(args: CommandModuleArgs<T>): CommandModuleContext<T> {
        return { client: this.client as Vimcord<true>, interaction: args[0] } as CommandModuleContext<T>;
    }

    /** Default `singleInvocation` key when the caller passes `singleInvocation: true`: the module plus the invoking user. */
    protected defaultInvocationKey(ctx: CommandModuleHookContext<T>): string {
        return `${this.id}:${resolveInvokingUser(ctx).id}`;
    }

    /** Returns command-local hooks before falling back to client and package-level global hooks. */
    protected override getHook<K extends keyof CommandModuleHooks<T>>(hook: K): CommandModuleHooks<T>[K] | undefined {
        const localHook = this.hooks[hook];
        if (localHook) return localHook;

        const clientHook = getCommandHooks(this.type, this.client?.globals.hooks)?.[hook];
        if (clientHook) return clientHook;

        return getCommandHooks(this.type, getGlobalCommandHooks())?.[hook];
    }

    protected override performTests(ctx: CommandModuleHookContext<T>): boolean | Promise<boolean> {
        const passed = super.performTests(ctx);
        if (typeof passed !== "boolean") return passed.then(passed => passed && this.testPermissions(ctx));
        return passed && this.testPermissions(ctx);
    }

    protected testPermissions(ctx: CommandModuleHookContext<T>, permissions = this.permissions): boolean | Promise<boolean> {
        if (!permissions && !resolveInvokingUser(ctx).bot) return true;
        const result = testCommandPermissions(ctx, permissions ?? {});
        if (result instanceof Promise) return result.then(result => this.handlePermissionResult(ctx, result));
        return this.handlePermissionResult(ctx, result);
    }

    private handlePermissionResult(
        ctx: CommandModuleHookContext<T>,
        result: Awaited<ReturnType<typeof testCommandPermissions>>
    ): boolean | Promise<boolean> {
        if (result.passed) return true;
        ctx.permissionTestResult = result;
        return this.runHook("onPermissionTestFail", ctx, async ctx => {
            ctx.error ??= new ModuleError(result.reason);
            await this.runHook("onError", ctx);
        }).then(() => false);
    }
}
