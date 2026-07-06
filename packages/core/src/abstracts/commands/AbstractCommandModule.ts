import type { CommandModulePermissions } from "@/commands/commandPermissions.js";
import type { ModuleMetadata } from "../AbstractModule.js";
import type {
    CommandModuleArgs,
    CommandModuleContext,
    CommandModuleHookContext,
    CommandModuleHooks,
    CommandModuleOptions
} from "./CommandModuleTypeKit.js";

import { testCommandPermissions } from "@/commands/commandPermissions.js";
import { ModuleError } from "@/errors/ModuleError.js";
import { AbstractModule } from "../AbstractModule.js";
import { CommandModuleType } from "./CommandModuleTypeKit.js";

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
    override readonly metadata: ModuleMetadata & { logUsage?: boolean };

    constructor(options: CommandModuleOptions<T>) {
        super(options);

        this.description = options.description;
        this.permissions = options.permissions ?? {};
        this.hooks = options.hooks ?? {};
        this.metadata = options.metadata ?? {};
    }

    protected override async performTests(ctx: CommandModuleHookContext<T>): Promise<boolean> {
        const passedBaseTests = await super.performTests(ctx);
        if (!passedBaseTests) return false;

        const permissionTestResult = testCommandPermissions(ctx, this.permissions);
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
