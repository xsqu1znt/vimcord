import type { CommandInteraction, ContextMenuCommandInteraction, Message } from "discord.js";
import type { ModuleOptions } from "@/abstracts/AbstractModule.js";
import type { Vimcord } from "@/client/Vimcord.js";

import { AbstractModule } from "@/abstracts/AbstractModule.js";

export interface CommandModuleType {
    prefix: [client: Vimcord<true>, message: Message];
    slash: [client: Vimcord<true>, interaction: CommandInteraction];
    context: [client: Vimcord<true>, interaction: ContextMenuCommandInteraction];
}

export interface CommandModuleOptions<K extends keyof CommandModuleType> extends ModuleOptions<
    CommandModuleType[K],
    Message | undefined
> {
    // TODO: Add something here I guess
}

export class CommandModule<K extends keyof CommandModuleType = keyof CommandModuleType> extends AbstractModule<
    CommandModuleType[K],
    Message | undefined
> {
    constructor(options: CommandModuleOptions<K>) {
        super(options);
    }

    protected override validate(): boolean {
        return true;
    }
}
