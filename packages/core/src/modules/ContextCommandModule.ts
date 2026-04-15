import type { AppCommandModuleOptions } from "@/abstracts/AbstractCommandModule.js";

import { AbstractCommandModule, CommandModuleType } from "@/abstracts/AbstractCommandModule.js";

export class ContextCommandModule extends AbstractCommandModule<CommandModuleType.Context> {
    override type: CommandModuleType.Context = CommandModuleType.Context;

    constructor(options: AppCommandModuleOptions<CommandModuleType.Context>) {
        super(options);
    }

    protected override validate(): boolean {
        return true;
    }
}
