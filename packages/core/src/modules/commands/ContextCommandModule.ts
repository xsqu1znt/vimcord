import type { AppCommandModuleOptions, CommandModuleContext } from "@/abstracts/index.js";

import { ContextMenuCommandBuilder } from "discord.js";
import { AbstractCommandModule, CommandModuleType } from "@/abstracts/index.js";

type ContextCommandModuleOptions = AppCommandModuleOptions<CommandModuleType.Context>;

export class ContextCommandModule extends AbstractCommandModule<CommandModuleType.Context> {
    override type: CommandModuleType.Context = CommandModuleType.Context;
    override moduleType: string = "Command:Context";

    readonly builder: ContextMenuCommandBuilder;
    readonly deferReply: ContextCommandModuleOptions["deferReply"];
    readonly registration: NonNullable<ContextCommandModuleOptions["registration"]>;

    constructor(options: ContextCommandModuleOptions) {
        const builder =
            typeof options.builder === "function" ? options.builder(new ContextMenuCommandBuilder()) : options.builder;
        super({ name: builder.name, ...options });

        this.builder = builder;
        this.deferReply = options.deferReply;
        this.registration = { global: true, ...options.registration };

        // Intercept execute to implement deferReply handling
        // NOTE: We're casting `this` to any because `execute` is readonly
        // NOTE: readonly is just a type guard, there's no JavaScript runtime check
        (this as any).execute = async (ctx: CommandModuleContext<CommandModuleType.Context>) => {
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
        return true;
    }
}
