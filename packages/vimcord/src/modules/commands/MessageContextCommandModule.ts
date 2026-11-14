import type {
    CommandModuleContext,
    ContextCommandModuleOptions,
    ResolvedAppCommandRegistration
} from "@/abstracts/index.js";

import { ApplicationCommandType, ContextMenuCommandBuilder } from "discord.js";
import { AbstractCommandModule, CommandModuleType } from "@/abstracts/index.js";
import { resolveRegistration } from "@/commands/commandRegistration.js";

type MessageContextCommandModuleOptions = ContextCommandModuleOptions<CommandModuleType.MessageContext>;

/** Defines a context menu command targeting a message. */
export class MessageContextCommandModule extends AbstractCommandModule<CommandModuleType.MessageContext> {
    /** Command kind used for dispatch. */
    override type: CommandModuleType.MessageContext = CommandModuleType.MessageContext;
    /** Module kind displayed in logs. */
    override moduleType: string = "Command:Context";

    /** Discord.js builder or callback configuring the application command. */
    readonly builder: ContextMenuCommandBuilder;
    /** Defers the interaction before the handler runs. */
    override readonly deferReply: MessageContextCommandModuleOptions["deferReply"];
    /** Guild and global application command registration scopes. */
    readonly registration: ResolvedAppCommandRegistration;

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
        this.registration = resolveRegistration(options.registration);
    }
}
