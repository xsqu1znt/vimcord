import type { AppCommandModuleOptions } from "@/abstracts/index.js";

import { ApplicationCommandType, ContextMenuCommandBuilder } from "discord.js";
import { AbstractCommandModule, CommandModuleType } from "@/abstracts/index.js";

type UserContextCommandModuleOptions = AppCommandModuleOptions<CommandModuleType.UserContext>;

export class UserContextCommandModule extends AbstractCommandModule<CommandModuleType.UserContext> {
    override type: CommandModuleType.UserContext = CommandModuleType.UserContext;
    override moduleType: string = "Command:Context";

    readonly builder: ContextMenuCommandBuilder;
    readonly deferReply: UserContextCommandModuleOptions["deferReply"];
    readonly registration: NonNullable<UserContextCommandModuleOptions["registration"]>;

    constructor(options: UserContextCommandModuleOptions) {
        const builder =
            typeof options.builder === "function" ? options.builder(new ContextMenuCommandBuilder()) : options.builder;
        builder.setType(ApplicationCommandType.User);

        super({
            name: builder.name,
            ...options,
            execute: ctx => this.runHandler(ctx, options.execute, options.deferReply)
        });

        this.builder = builder;
        this.deferReply = options.deferReply;
        this.registration = { global: true, ...options.registration };
    }
}
