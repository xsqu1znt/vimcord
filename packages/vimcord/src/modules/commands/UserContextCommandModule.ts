import type {
    CommandModuleContext,
    ContextCommandModuleOptions,
    ResolvedAppCommandRegistration
} from "@/abstracts/index.js";

import { ApplicationCommandType, ContextMenuCommandBuilder } from "discord.js";
import { AbstractCommandModule, CommandModuleType } from "@/abstracts/index.js";
import { applyGuildOnlyContexts, resolveRegistration } from "@/commands/commandRegistration.js";

type UserContextCommandModuleOptions = ContextCommandModuleOptions<CommandModuleType.UserContext>;

/** Defines a context menu command targeting a user. */
export class UserContextCommandModule extends AbstractCommandModule<CommandModuleType.UserContext> {
    /** Command kind used for dispatch. */
    override type: CommandModuleType.UserContext = CommandModuleType.UserContext;
    /** Module kind displayed in logs. */
    override moduleType: string = "Command:Context";

    /** Discord.js builder or callback configuring the application command. */
    readonly builder: ContextMenuCommandBuilder;
    /** Defers the interaction before the handler runs. */
    override readonly deferReply: UserContextCommandModuleOptions["deferReply"];
    /** Guild and global application command registration scopes. */
    readonly registration: ResolvedAppCommandRegistration;

    constructor(options: UserContextCommandModuleOptions) {
        const builder =
            typeof options.builder === "function" ? options.builder(new ContextMenuCommandBuilder()) : options.builder;
        builder.setType(ApplicationCommandType.User);
        applyGuildOnlyContexts(builder, options.guildOnly);

        super({
            name: builder.name,
            ...options,
            execute: options.execute as (ctx: CommandModuleContext<CommandModuleType.UserContext>) => unknown
        });

        this.directExecution = new.target === UserContextCommandModule;
        this.builder = builder;
        this.deferReply = options.deferReply;
        this.registration = resolveRegistration(options.registration);
    }
}
