import type { CommandModuleContext, ContextCommandModuleOptions } from "@/abstracts/index.js";

import { ApplicationCommandType, ContextMenuCommandBuilder } from "discord.js";
import { AbstractCommandModule, CommandModuleType } from "@/abstracts/index.js";

type MessageContextCommandModuleOptions = ContextCommandModuleOptions<CommandModuleType.MessageContext>;

export class MessageContextCommandModule extends AbstractCommandModule<CommandModuleType.MessageContext> {
    override type: CommandModuleType.MessageContext = CommandModuleType.MessageContext;
    override moduleType: string = "Command:Context";

    readonly builder: ContextMenuCommandBuilder;
    override readonly deferReply: MessageContextCommandModuleOptions["deferReply"];
    readonly registration: NonNullable<MessageContextCommandModuleOptions["registration"]>;

    constructor(options: MessageContextCommandModuleOptions) {
        const builder =
            typeof options.builder === "function" ? options.builder(new ContextMenuCommandBuilder()) : options.builder;
        builder.setType(ApplicationCommandType.Message);

        super({
            name: builder.name,
            ...options,
            execute: options.execute as (ctx: CommandModuleContext<CommandModuleType.MessageContext>) => unknown
        });

        this.directExecution = new.target === MessageContextCommandModule;
        this.builder = builder;
        this.deferReply = options.deferReply;
        this.registration = { global: true, ...options.registration };
    }
}
