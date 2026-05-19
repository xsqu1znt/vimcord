import type { ModuleMetadata } from "../AbstractModule.js";
import type {
    CommandModuleArgs,
    CommandModuleContext,
    CommandModuleHookContext,
    CommandModuleHooks,
    CommandModuleType
} from "./CommandModuleTypeKit.js";

import { AbstractModule } from "../AbstractModule.js";

export abstract class AbstractCommandModuleV2<T extends CommandModuleType> extends AbstractModule<
    CommandModuleArgs<T>,
    CommandModuleContext<T>,
    CommandModuleHookContext<T>,
    CommandModuleHooks<T>
> {}
