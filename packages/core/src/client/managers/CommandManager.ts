import type { CommandModuleType } from "@/abstracts/AbstractCommandModule.js";
import type { Vimcord } from "../Vimcord.js";

import { AbstractCommandManager } from "@/abstracts/AbstractCommandManager.js";

export class PrefixCommandManager extends AbstractCommandManager<CommandModuleType.Prefix> {
    constructor(client: Vimcord, fileSuffix: string | string[] | undefined) {
        super(client, fileSuffix);
    }
}

export class SlashCommandManager extends AbstractCommandManager<CommandModuleType.Slash> {
    constructor(client: Vimcord, fileSuffix: string | string[] | undefined) {
        super(client, fileSuffix);
    }
}

export class ContextCommandManager extends AbstractCommandManager<CommandModuleType.Context> {
    constructor(client: Vimcord, fileSuffix: string | string[] | undefined) {
        super(client, fileSuffix);
    }
}

export class CommandManager {
    readonly prefix: PrefixCommandManager;
    readonly slash: SlashCommandManager;
    readonly context: ContextCommandManager;

    constructor(readonly client: Vimcord) {
        this.prefix = new PrefixCommandManager(client, ".prefix");
        this.slash = new SlashCommandManager(client, ".slash");
        this.context = new ContextCommandManager(client, ".ctx");
    }
}
