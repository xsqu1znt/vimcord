import type { CommandModuleOptions } from "@/abstracts/AbstractCommandModule.js";

import { AbstractCommandModule, CommandModuleType } from "@/abstracts/AbstractCommandModule.js";

export interface PrefixCommandModuleOptions extends CommandModuleOptions<CommandModuleType.Prefix> {
    aliases?: string[];
    description?: string;
}

export class PrefixCommandModule extends AbstractCommandModule<CommandModuleType.Prefix> {
    override type: CommandModuleType.Prefix = CommandModuleType.Prefix;
    override moduleType: string = "Command:Prefix";
    readonly aliases: string[];
    readonly description?: string;

    constructor(options: PrefixCommandModuleOptions) {
        super(options);

        this.aliases = options.aliases?.map(alias => alias.toLowerCase()) ?? [];
        this.description = options.description;
    }

    protected override validate(): boolean {
        return Boolean(this.name);
    }
}
