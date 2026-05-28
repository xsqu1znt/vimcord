import type {
    AppCommandModuleOptions,
    CommandModuleArgs,
    CommandModuleContext,
    CommandModuleHookContext
} from "@/abstracts/index.js";
import type { Vimcord } from "@/client/index.js";

import { ApplicationCommandType, ContextMenuCommandBuilder } from "discord.js";
import { AbstractCommandModule, CommandModuleType } from "@/abstracts/index.js";

type MessageContextCommandModuleOptions = AppCommandModuleOptions<CommandModuleType.MessageContext>;

export class MessageContextCommandModule extends AbstractCommandModule<CommandModuleType.MessageContext> {
    override type: CommandModuleType.MessageContext = CommandModuleType.MessageContext;
    override moduleType: string = "Command:Context";

    readonly builder: ContextMenuCommandBuilder;
    readonly deferReply: MessageContextCommandModuleOptions["deferReply"];
    readonly registration: NonNullable<MessageContextCommandModuleOptions["registration"]>;

    constructor(options: MessageContextCommandModuleOptions) {
        const builder =
            typeof options.builder === "function" ? options.builder(new ContextMenuCommandBuilder()) : options.builder;
        super({ name: builder.name, ...options });

        this.builder = builder;
        this.deferReply = options.deferReply;
        this.registration = { global: true, ...options.registration };

        // Intercept execute to implement deferReply handling
        // NOTE: We're casting `this` to any because `execute` is readonly
        // NOTE: readonly is just a type guard, there's no JavaScript runtime check
        (this as any).execute = async (ctx: CommandModuleContext<CommandModuleType.MessageContext>) => {
            const { interaction } = ctx;

            // Defer the interaction if needed
            if (options.deferReply && !interaction.replied && !interaction.deferred) {
                await interaction.deferReply(typeof options.deferReply === "boolean" ? undefined : options.deferReply);
            }

            // Run the original execute
            return await options.execute?.(ctx);
        };
    }

    protected override validate(): boolean {
        return this.builder.type === ApplicationCommandType.Message;
    }

    protected override createModuleCTX(
        args: CommandModuleArgs<CommandModuleType.MessageContext>
    ): CommandModuleContext<CommandModuleType.MessageContext> {
        return { client: this.client as Vimcord<true>, interaction: args[0] };
    }

    protected override createHookCTX(
        args: CommandModuleArgs<CommandModuleType.MessageContext>
    ): CommandModuleHookContext<CommandModuleType.MessageContext> {
        return {
            ...this.createModuleCTX(args),
            module: this as any,
            args
        };
    }
}
