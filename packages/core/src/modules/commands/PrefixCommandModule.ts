import type { CommandModuleOptions } from "@/abstracts/index.js";

import { AbstractCommandModule, CommandModuleType } from "@/abstracts/index.js";

type PrefixCommandModuleOptions = CommandModuleOptions<CommandModuleType.Prefix>;

export class PrefixCommandModule extends AbstractCommandModule<CommandModuleType.Prefix> {
    override type: CommandModuleType.Prefix = CommandModuleType.Prefix;
    override moduleType: string = "Command:Prefix";
    readonly aliases: string[];

    constructor(options: PrefixCommandModuleOptions) {
        super(options);
        this.aliases = options.aliases?.map(alias => alias.toLowerCase()) ?? [];
    }

    protected override validate(): boolean {
        return Boolean(this.name);
    }
}
