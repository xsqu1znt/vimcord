import type { CacheType, ChatInputCommandInteraction } from "discord.js";
import type {
    AppCommandModuleOptions,
    CommandModuleArgs,
    CommandModuleContext,
    CommandModuleHookContext,
    SlashCommandBuilderResolvable,
    SlashCommandModuleRoute
} from "@/abstracts/index.js";
import type { Vimcord } from "@/client/index.js";

import { SlashCommandBuilder } from "discord.js";
import { AbstractCommandModule, CommandModuleType } from "@/abstracts/index.js";
import { dynaSend, SendMethod } from "@/ux/index.js";

type SlashCommandModuleOptions = Omit<AppCommandModuleOptions<CommandModuleType.Slash>, "execute"> & {
    execute?: AppCommandModuleOptions<CommandModuleType.Slash>["execute"];
};

export class SlashCommandModule extends AbstractCommandModule<CommandModuleType.Slash> {
    override type: CommandModuleType.Slash = CommandModuleType.Slash;
    override moduleType: string = "Command:Slash";

    readonly builder: SlashCommandBuilderResolvable;
    readonly deferReply: SlashCommandModuleOptions["deferReply"];
    readonly registration: NonNullable<SlashCommandModuleOptions["registration"]>;
    readonly routes: Map<string, SlashCommandModuleRoute>;

    constructor(options: SlashCommandModuleOptions) {
        const builder = typeof options.builder === "function" ? options.builder(new SlashCommandBuilder()) : options.builder;
        super({
            ...options,
            name: builder.name,
            description: builder.description,
            execute: options.execute ?? (() => undefined)
        });

        this.builder = builder;
        this.deferReply = options.deferReply;
        this.registration = { global: true, ...options.registration };
        this.routes = new Map((options.routes ?? []).map(r => [r.path.trim().toLowerCase(), r]));

        // Intercept execute to implement route and deferReply handling
        // NOTE: We're casting `this` to any because `execute` is readonly
        // NOTE: readonly is just a type guard, there's no JavaScript runtime check
        (this as any).execute = async (ctx: CommandModuleContext<CommandModuleType.Slash>) => {
            const { interaction } = ctx;

            if (options.routes) {
                const routePath = createRoutePath(interaction);
                if (routePath) {
                    const route = this.routes.get(routePath);

                    // Defer the interaction if needed
                    if (route?.deferReply && !interaction.replied && !interaction.deferred) {
                        await interaction.deferReply(typeof route.deferReply === "boolean" ? undefined : route.deferReply);
                    }

                    if (route) return route.handler(ctx);

                    // Run onUnknownRoute hook
                    if (this.hooks.onUnknownRoute) {
                        const hookCTX = this.createHookCTX([interaction]);
                        return this.runHook("onUnknownRoute", hookCTX);
                    }

                    // Or run a generic onUnknownRoute hook
                    return await dynaSend(interaction, {
                        content: `Subcommand '${routePath}' was not found.`,
                        flags: "Ephemeral",
                        sendMethod: interaction.replied || interaction.deferred ? SendMethod.FollowUp : SendMethod.Reply
                    });
                }
            }

            // Defer the interaction if needed
            if (options.deferReply && !interaction.replied && !interaction.deferred) {
                await interaction.deferReply(typeof options.deferReply === "boolean" ? undefined : options.deferReply);
            }

            // Run the original execute
            return await options.execute?.(ctx);
        };
    }

    /** Add routes to the module. */
    addRoutes(...routes: SlashCommandModuleRoute[]): this {
        routes.forEach(r => this.routes.set(r.path.trim().toLowerCase(), r));
        return this;
    }

    protected override validate(): boolean {
        return true;
    }

    protected override createModuleCTX(
        args: CommandModuleArgs<CommandModuleType.Slash>
    ): CommandModuleContext<CommandModuleType.Slash> {
        return { client: this.client as Vimcord<true>, interaction: args[0] };
    }

    protected override createHookCTX(
        args: CommandModuleArgs<CommandModuleType.Slash>
    ): CommandModuleHookContext<CommandModuleType.Slash> {
        return {
            ...this.createModuleCTX(args),
            module: this as any,
            args
        };
    }
}

function createRoutePath(interaction: ChatInputCommandInteraction): string | null {
    const subcommand = interaction.options.getSubcommand(false);
    if (!subcommand) return null;

    const group = interaction.options.getSubcommandGroup(false);
    return (group ? `${group}:${subcommand}` : subcommand).trim().toLowerCase();
}
