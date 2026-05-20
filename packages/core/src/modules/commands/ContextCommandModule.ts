import type { AppCommandModuleOptions } from "@/abstracts/index.js";

import { ContextMenuCommandBuilder } from "discord.js";
import { AbstractCommandModule, CommandModuleType } from "@/abstracts/index.js";

type ContextCommandModuleOptions = AppCommandModuleOptions<CommandModuleType.Context>;

export class SlashCommandModule extends AbstractCommandModule<CommandModuleType.Context> {
    override type: CommandModuleType.Context = CommandModuleType.Context;
    override moduleType: string = "Command:Context";

    readonly builder: ContextCommandModuleOptions["builder"];
    readonly deferReply: ContextCommandModuleOptions["deferReply"];
    readonly registration: NonNullable<ContextCommandModuleOptions["registration"]>;

    constructor(options: ContextCommandModuleOptions) {
        const builder =
            typeof options.builder === "function" ? options.builder(new ContextMenuCommandBuilder()) : options.builder;
        super({ name: builder.name, ...options });

        this.builder = builder;
        this.deferReply = options.deferReply;
        this.registration = { global: true, ...options.registration };

        /* super({
            ...options,
            name: options.name ?? commandData.name,
            execute: async ctx =>
                handleExecution(ctx, {
                    deferReply: options.deferReply ?? false,
                    routes,
                    onUnknownRoute: options.onUnknownRoute,
                    execute: originalExecute
                })
        }); */
    }

    protected override validate(): boolean {
        return true;
    }
}
