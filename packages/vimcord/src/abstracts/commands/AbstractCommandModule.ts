import type { ChatInputCommandInteraction } from "discord.js";
import type { Vimcord } from "@/client/Vimcord.js";
import type { GlobalCommandHooks } from "@/commands/commandHooks.js";
import type { CommandRestrictions, PermissionTestResult } from "@/commands/commandPermissions.js";
import type { ModuleRunResult } from "../AbstractModule.js";
import type {
    CommandBlock,
    CommandDeferReply,
    CommandModuleArgs,
    CommandModuleBaseOptions,
    CommandModuleContext,
    CommandModuleHookContext,
    CommandModuleHooks,
    CommandModuleMetadata
} from "./CommandModuleTypeKit.js";

import { applyDeferReply } from "@/commands/commandDeferral.js";
import { pickRestrictions, testCommandPermissions } from "@/commands/commandPermissions.js";
import { AbstractModule } from "../AbstractModule.js";
import { CommandModuleType } from "./CommandModuleTypeKit.js";

const MATCHED_COMMAND = () => true;

function getCommandHooks<T extends CommandModuleType>(
    type: T,
    hooks: GlobalCommandHooks | undefined
): CommandModuleHooks<T> | undefined {
    const key = type === CommandModuleType.Prefix ? "prefix" : type === CommandModuleType.Slash ? "slash" : "context";
    return hooks?.[key] as CommandModuleHooks<T> | undefined;
}

/** Base for command modules with shared permissions, hooks, and routing. */
export abstract class AbstractCommandModule<T extends CommandModuleType> extends AbstractModule<
    CommandModuleArgs<T>,
    CommandModuleContext<T>,
    CommandModuleHookContext<T>,
    CommandModuleHooks<T>,
    CommandBlock
> {
    /** Command kind used for dispatch. */
    abstract readonly type: T;
    protected directExecution = false;
    /** Defers the interaction before the handler runs. */
    readonly deferReply?: CommandDeferReply;
    /** Guild, bot-permission, and access rules; `undefined` when there are none, so commands can skip the test. */
    protected readonly restrictions: CommandRestrictions | undefined;
    protected readonly allowBots: boolean | undefined;
    /** Callbacks for invocation gates, blocks, and errors. */
    override readonly hooks: CommandModuleHooks<T>;
    /** Short description displayed to users or in discovery. */
    readonly description?: string;
    /** Project-defined display and categorization fields. */
    override readonly metadata: CommandModuleMetadata;

    constructor(
        options: CommandModuleBaseOptions<T> & {
            /** Whether to require a guild for the handler. */
            guildOnly?: boolean;
            /** Runs the module or command handler. */
            execute(ctx: CommandModuleContext<T>): unknown;
        }
    ) {
        super({
            ...options,
            singleInvocation:
                options.singleInvocation === true
                    ? { key: (ctx: CommandModuleHookContext<T>) => this.defaultInvocationKey(ctx) }
                    : options.singleInvocation || undefined
        });

        this.description = options.description;
        this.restrictions = pickRestrictions(options);
        this.allowBots = options.allowBots;
        this.hooks = options.hooks ?? {};
        this.metadata = options.metadata ?? {};
    }

    /** Dispatches a matched command, logging its fixed timings when enabled. */
    dispatch(...args: CommandModuleArgs<T>): Promise<boolean> {
        const logging = this.client!.globals.app.commandLogging;
        const startedAt = logging ? performance.now() : undefined;
        const recognizedAt = logging ? Date.now() : undefined;

        // --- Run optional module stages ---
        if (
            !this.canExecuteDirectly() ||
            !this.enabled ||
            !this.client ||
            (this.requiresReady && !this.client.isReady()) ||
            this.client.logger.options.verbose ||
            this.restrictions ||
            this.singleInvocation ||
            this.environment !== "both" ||
            ("author" in args[0] ? args[0].author : args[0].user).bot ||
            this.getHook("before")
        ) {
            const complete = logging
                ? (result: ModuleRunResult): boolean => {
                      if (result.executed)
                          this.logUsage(
                              args[0],
                              startedAt,
                              recognizedAt,
                              result.executionTiming?.startedAt,
                              result.executionTiming?.durationMs,
                              result.error
                          );
                      return true;
                  }
                : MATCHED_COMMAND;
            return this.invoke(args, complete, logging);
        }

        // --- Call the handler directly ---
        const ctx = this.createModuleCTX(args);
        const executionStartedAt = logging ? performance.now() : undefined;
        const finish = logging
            ? (): boolean => {
                  const durationMs = executionStartedAt === undefined ? undefined : performance.now() - executionStartedAt;
                  this.logUsage(args[0], startedAt, recognizedAt, executionStartedAt, durationMs);
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
                if (logging) this.logUsage(args[0], startedAt, recognizedAt, executionStartedAt, durationMs, error as Error);
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
        startedAt: number | undefined,
        recognizedAt: number | undefined,
        executionStartedAt: number | undefined,
        executionDurationMs: number | undefined,
        error?: Error
    ): void {
        const delivery = recognizedAt === undefined ? NaN : recognizedAt - source.createdTimestamp;
        const timings = {
            delivery: delivery >= 0 ? delivery : undefined,
            pre: executionStartedAt === undefined || startedAt === undefined ? undefined : executionStartedAt - startedAt,
            exec: executionDurationMs
        };
        const guild = source.guild;
        this.client!.logger.commandUsed({
            commandName: this.name,
            userName: ("author" in source ? source.author : source.user).username,
            guildName: guild?.name,
            timings,
            failed: Boolean(error)
        });
    }

    protected canExecuteDirectly(): boolean {
        return this.directExecution && !this.deferReply;
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
        const interaction = args[0] as ChatInputCommandInteraction;
        return {
            client: this.client as Vimcord<true>,
            interaction,
            user: interaction.user
        } as unknown as CommandModuleContext<T>;
    }

    /** Default `singleInvocation` key when the caller passes `singleInvocation: true`: the module plus the invoking user. */
    protected defaultInvocationKey(ctx: CommandModuleHookContext<T>): string {
        return `${this.id}:${ctx.user.id}`;
    }

    /** Returns command-local hooks before falling back to the client's hooks. */
    protected override getHook<K extends keyof CommandModuleHooks<T>>(hook: K): CommandModuleHooks<T>[K] | undefined {
        return this.hooks[hook] ?? getCommandHooks(this.type, this.client?.globals.hooks)?.[hook];
    }

    /** Runs the client's gate first, so a module's own `before` can never skip it. */
    protected override async runBefore(ctx: CommandModuleHookContext<T>): Promise<boolean> {
        const clientBefore = getCommandHooks(this.type, this.client?.globals.hooks)?.before;
        if (!(await this.callBefore(clientBefore, ctx))) return false;
        return this.callBefore(this.hooks.before, ctx);
    }

    /** The matched subcommand, for commands that have them. */
    protected getSubcommand(_ctx: CommandModuleHookContext<T>): CommandRestrictions | undefined {
        return undefined;
    }

    /** The subcommand path that matched nothing, when the invocation has nowhere to go. */
    protected findUnknownRoute(_ctx: CommandModuleHookContext<T>): string | undefined {
        return undefined;
    }

    /** Tests the command's restrictions, then the route, then the matched subcommand's restrictions. */
    protected override performTests(ctx: CommandModuleHookContext<T>): boolean | Promise<boolean> {
        const passed = super.performTests(ctx);
        if (typeof passed !== "boolean") return passed.then(passed => passed && this.testRoutedRestrictions(ctx));
        return passed && this.testRoutedRestrictions(ctx);
    }

    private testRoutedRestrictions(ctx: CommandModuleHookContext<T>): boolean | Promise<boolean> {
        const subcommand = this.getSubcommand(ctx);
        // A subcommand's allowBots wins, since the command's own bot check would otherwise make it unreachable.
        const allowBots = subcommand?.allowBots ?? this.allowBots;
        const testRoute = (passed: boolean): boolean | Promise<boolean> => {
            if (!passed) return false;
            const path = this.findUnknownRoute(ctx);
            if (path !== undefined) return this.block(ctx, { kind: "unknownRoute", path }).then(() => false);
            return !subcommand || this.testRestrictions(ctx, pickRestrictions(subcommand), allowBots);
        };

        const passed = this.testRestrictions(ctx, this.restrictions, allowBots);
        return typeof passed === "boolean" ? testRoute(passed) : passed.then(testRoute);
    }

    private testRestrictions(
        ctx: CommandModuleHookContext<T>,
        restrictions: CommandRestrictions | undefined,
        allowBots: boolean | undefined
    ): boolean | Promise<boolean> {
        if (!restrictions && (allowBots || !ctx.user.bot)) return true;
        const finish = (result: PermissionTestResult): boolean | Promise<boolean> => {
            if (result.passed) return true;
            const { passed: _passed, ...failure } = result;
            return this.block(ctx, { kind: "permission", ...failure }).then(() => false);
        };
        const result = testCommandPermissions(ctx, restrictions ?? {}, allowBots);
        return result instanceof Promise ? result.then(finish) : finish(result);
    }
}
