import type { Vimcord } from "@/client/Vimcord.js";
import type { GlobalCommandHooks } from "@/commands/commandHooks.js";
import type { CommandModulePermissions } from "@/commands/commandPermissions.js";
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
    protected readonly permissions: CommandModulePermissions;
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
        this.permissions = options.permissions ?? {};
        this.hooks = options.hooks ?? {};
        this.metadata = options.metadata ?? {};
    }

    /** Defers only when requested, then calls the user handler with optional usage timing. */
    protected runHandler(
        ctx: CommandModuleContext<T>,
        handler: (ctx: CommandModuleContext<T>) => unknown,
        deferReply?: Parameters<typeof applyDeferReply>[1]
    ): unknown {
        if (deferReply && "interaction" in ctx && !ctx.interaction.replied && !ctx.interaction.deferred) {
            return applyDeferReply(ctx.interaction, deferReply).then(() => this.runHandler(ctx, handler));
        }

        const logging = this.client?.globals.app.commandLogging;
        if (this.metadata.logUsage === false) return handler.call(this, ctx);
        if ((logging === false || logging?.length === 0) && this.metadata.logUsage !== true) return handler.call(this, ctx);
        return this.measureExecution(ctx, () => handler.call(this, ctx));
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

    private testPermissions(ctx: CommandModuleHookContext<T>): boolean | Promise<boolean> {
        const result = testCommandPermissions(ctx, this.permissions);
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
