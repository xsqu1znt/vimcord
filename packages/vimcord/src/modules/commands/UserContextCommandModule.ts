import type { CommandModuleContext, ContextCommandModuleOptions } from "@/abstracts/index.js";

import { ApplicationCommandType, ContextMenuCommandBuilder } from "discord.js";
import { AbstractCommandModule, CommandModuleType } from "@/abstracts/index.js";

type UserContextCommandModuleOptions = ContextCommandModuleOptions<CommandModuleType.UserContext>;

export class UserContextCommandModule extends AbstractCommandModule<CommandModuleType.UserContext> {
    override type: CommandModuleType.UserContext = CommandModuleType.UserContext;
    override moduleType: string = "Command:Context";

    readonly builder: ContextMenuCommandBuilder;
    override readonly deferReply: UserContextCommandModuleOptions["deferReply"];
    readonly registration: NonNullable<UserContextCommandModuleOptions["registration"]>;

    constructor(options: UserContextCommandModuleOptions) {
        const builder =
            typeof options.builder === "function" ? options.builder(new ContextMenuCommandBuilder()) : options.builder;
        builder.setType(ApplicationCommandType.User);

        super({
            name: builder.name,
            ...options,
            execute: options.execute as (ctx: CommandModuleContext<CommandModuleType.UserContext>) => unknown
        });

        this.directExecution = new.target === UserContextCommandModule;
        this.builder = builder;
        this.deferReply = options.deferReply;
        this.registration = { global: true, ...options.registration };
    }
}
