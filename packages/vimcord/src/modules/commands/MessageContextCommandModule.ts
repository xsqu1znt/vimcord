import type {
    AppCommandModuleOptions,
    CommandModuleArgs,
    CommandModuleContext,
    CommandModuleHookContext,
    ModuleHookContext
} from "@/abstracts/index.js";
import type { Vimcord } from "@/client/index.js";

import { ApplicationCommandType, ContextMenuCommandBuilder } from "discord.js";
import { AbstractCommandModule, CommandModuleType } from "@/abstracts/index.js";
import { applyDeferReply } from "@/commands/commandDeferral.js";

type MessageContextCommandModuleOptions = AppCommandModuleOptions<CommandModuleType.MessageContext>;

export class MessageContextCommandModule extends AbstractCommandModule<CommandModuleType.MessageContext> {
    override type: CommandModuleType.MessageContext = CommandModuleType.MessageContext;
    override moduleType: string = "Command:Context";

    readonly builder: ContextMenuCommandBuilder;
    readonly deferReply: MessageContextCommandModuleOptions["deferReply"];
    readonly registration: NonNullable<MessageContextCommandModuleOptions["registration"]>;

    private readonly configuredExecute: MessageContextCommandModuleOptions["execute"];

    constructor(options: MessageContextCommandModuleOptions) {
        const builder =
            typeof options.builder === "function" ? options.builder(new ContextMenuCommandBuilder()) : options.builder;
        builder.setType(ApplicationCommandType.Message);

        super({
            name: builder.name,
            ...options,
            execute: ctx => this.executeApp(ctx)
        });

        this.builder = builder;
        this.deferReply = options.deferReply;
        this.registration = { global: true, ...options.registration };
        this.configuredExecute = options.execute;
    }

    private async executeApp(ctx: CommandModuleContext<CommandModuleType.MessageContext>): Promise<unknown> {
        await applyDeferReply(ctx.interaction, this.deferReply);
        return await this.configuredExecute(ctx);
    }

    protected override validate(): boolean {
        return true;
    }

    protected override createModuleCTX(
        args: CommandModuleArgs<CommandModuleType.MessageContext>
    ): CommandModuleContext<CommandModuleType.MessageContext> {
        return { client: this.client as Vimcord<true>, interaction: args[0] };
    }

    protected override createHookCTX(
        moduleCTX: CommandModuleContext<CommandModuleType.MessageContext>,
        args: CommandModuleArgs<CommandModuleType.MessageContext>
    ): CommandModuleHookContext<CommandModuleType.MessageContext> {
        return {
            ...moduleCTX,
            module: this as unknown as ModuleHookContext<CommandModuleArgs<CommandModuleType.MessageContext>>["module"],
            args
        };
    }
}
