import type { CommandModuleOptions } from "@/abstracts/AbstractCommandModule.js";

import { AbstractCommandModule, CommandModuleType } from "@/abstracts/AbstractCommandModule.js";

export class PrefixCommandModule extends AbstractCommandModule<CommandModuleType.Prefix> {
    override type: CommandModuleType.Prefix = CommandModuleType.Prefix;

    constructor(options: CommandModuleOptions<CommandModuleType.Prefix>) {
        super(options);
    }

    protected override validate(): boolean {
        return true;
    }
}
