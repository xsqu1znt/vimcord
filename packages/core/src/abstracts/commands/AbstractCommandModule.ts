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

import { getGlobalCommandHooks } from "@/commands/commandHooks.js";
import { testCommandPermissions } from "@/commands/commandPermissions.js";
import { ModuleError } from "@/errors/ModuleError.js";
import { AbstractModule } from "../AbstractModule.js";
import { CommandModuleType } from "./CommandModuleTypeKit.js";

function getCommandHooks<T extends CommandModuleType>(
    type: T,
    hooks: GlobalCommandHooks | undefined
): CommandModuleHooks<T> | undefined {
    if (!hooks) return undefined;

    switch (type) {
        case CommandModuleType.Prefix:
            return hooks.prefix as CommandModuleHooks<T> | undefined;
        case CommandModuleType.Slash:
            return hooks.slash as CommandModuleHooks<T> | undefined;
        case CommandModuleType.MessageContext:
        case CommandModuleType.UserContext:
            return hooks.context as CommandModuleHooks<T> | undefined;
    }
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
        super(options);

        this.description = options.description;
        this.permissions = options.permissions ?? {};
        this.hooks = options.hooks ?? {};
        this.metadata = options.metadata ?? {};
    }

    /** Returns command-local hooks before falling back to client and package-level global hooks. */
    protected override getHook<K extends keyof CommandModuleHooks<T>>(hook: K): CommandModuleHooks<T>[K] | undefined {
        const localHook = this.hooks[hook];
        if (localHook) return localHook;

        const clientHook = getCommandHooks(this.type, this.client?.globals.hooks)?.[hook];
        if (clientHook) return clientHook;

        return getCommandHooks(this.type, getGlobalCommandHooks())?.[hook];
    }

    protected override async performTests(ctx: CommandModuleHookContext<T>): Promise<boolean> {
        const passedBaseTests = await super.performTests(ctx);
        if (!passedBaseTests) return false;

        const permissionTestResult = await testCommandPermissions(ctx, this.permissions);
        if (permissionTestResult.passed) return true;

        ctx.permissionTestResult = permissionTestResult;

        await this.runHook("onPermissionTestFail", ctx, async ctx => {
            const result = ctx.permissionTestResult;

            if (result && !result.passed) {
                ctx.error ??= new ModuleError(result.reason);
            }

            await this.runHook("onError", ctx);
        });

        return false;
    }
}
