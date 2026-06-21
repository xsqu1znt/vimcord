import type { CommandModulePermissions } from "@/commands/commandPermissions.js";
import type { ModuleMetadata } from "../AbstractModule.js";
import type {
    CommandModuleArgs,
    CommandModuleContext,
    CommandModuleHookContext,
    CommandModuleHooks,
    CommandModuleOptions
} from "./CommandModuleTypeKit.js";

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

        this.permissions = options.permissions ?? {};
        this.hooks = options.hooks ?? {};
        this.metadata = options.metadata ?? {};
    }
}
