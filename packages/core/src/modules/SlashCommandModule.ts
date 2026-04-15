import type { AppCommandModuleOptions } from "@/abstracts/AbstractCommandModule.js";

import { AbstractCommandModule, CommandModuleType } from "@/abstracts/AbstractCommandModule.js";

export class SlashCommandModule extends AbstractCommandModule<CommandModuleType.Slash> {
    override type: CommandModuleType.Slash = CommandModuleType.Slash;

    constructor(options: AppCommandModuleOptions<CommandModuleType.Slash>) {
        super(options);
    }

    protected override validate(): boolean {
        return true;
    }
}
