import type { RESTPostAPIApplicationCommandsJSONBody } from "discord.js";
import type { AppCommandModuleOptions } from "@/abstracts/AbstractCommandModule.js";

import { ContextMenuCommandBuilder } from "discord.js";
import { AbstractCommandModule, CommandModuleType } from "@/abstracts/AbstractCommandModule.js";

export type ContextCommandModuleOptions = Omit<AppCommandModuleOptions<CommandModuleType.Context>, "name"> & {
    name?: string;
    builder: ContextMenuCommandBuilder | ((builder: ContextMenuCommandBuilder) => ContextMenuCommandBuilder);
};

export class ContextCommandModule extends AbstractCommandModule<CommandModuleType.Context> {
    override type: CommandModuleType.Context = CommandModuleType.Context;
    readonly builder: ContextMenuCommandBuilder;
    readonly registration: NonNullable<ContextCommandModuleOptions["registration"]>;

    constructor(options: ContextCommandModuleOptions) {
        const builder =
            typeof options.builder === "function" ? options.builder(new ContextMenuCommandBuilder()) : options.builder;
        const commandData = builder.toJSON() as RESTPostAPIApplicationCommandsJSONBody;
        validateApplicationCommandData(commandData);

        super({ ...options, name: options.name ?? commandData.name });

        this.builder = builder;
        this.registration = { global: true, ...options.registration };
    }

    toApplicationCommandData(): RESTPostAPIApplicationCommandsJSONBody {
        return this.builder.toJSON() as RESTPostAPIApplicationCommandsJSONBody;
    }

    protected override validate(): boolean {
        return true;
    }
}

function validateApplicationCommandData(data: RESTPostAPIApplicationCommandsJSONBody): void {
    if (!data.name) throw new Error(`[Vimcord] ContextCommandModule: Command name is required.`);
}
