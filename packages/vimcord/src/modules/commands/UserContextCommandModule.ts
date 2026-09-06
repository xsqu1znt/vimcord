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

type UserContextCommandModuleOptions = AppCommandModuleOptions<CommandModuleType.UserContext>;

export class UserContextCommandModule extends AbstractCommandModule<CommandModuleType.UserContext> {
    override type: CommandModuleType.UserContext = CommandModuleType.UserContext;
    override moduleType: string = "Command:Context";

    readonly builder: ContextMenuCommandBuilder;
    readonly deferReply: UserContextCommandModuleOptions["deferReply"];
    readonly registration: NonNullable<UserContextCommandModuleOptions["registration"]>;

    private readonly configuredExecute: UserContextCommandModuleOptions["execute"];

    constructor(options: UserContextCommandModuleOptions) {
        const builder =
            typeof options.builder === "function" ? options.builder(new ContextMenuCommandBuilder()) : options.builder;
        builder.setType(ApplicationCommandType.User);

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

    private async executeApp(ctx: CommandModuleContext<CommandModuleType.UserContext>): Promise<unknown> {
        await applyDeferReply(ctx.interaction, this.deferReply);
        return await this.configuredExecute(ctx);
    }

    protected override validate(): boolean {
        return true;
    }

    protected override createModuleCTX(
        args: CommandModuleArgs<CommandModuleType.UserContext>
    ): CommandModuleContext<CommandModuleType.UserContext> {
        return { client: this.client as Vimcord<true>, interaction: args[0] };
    }

    protected override createHookCTX(
        moduleCTX: CommandModuleContext<CommandModuleType.UserContext>,
        args: CommandModuleArgs<CommandModuleType.UserContext>
    ): CommandModuleHookContext<CommandModuleType.UserContext> {
        return {
            ...moduleCTX,
            module: this as unknown as ModuleHookContext<CommandModuleArgs<CommandModuleType.UserContext>>["module"],
            args
        };
    }
}
