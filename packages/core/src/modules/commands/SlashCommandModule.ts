import type { ChatInputCommandInteraction } from "discord.js";
import type { AppCommandModuleOptions, CommandModuleContext, SlashCommandModuleRoute } from "@/abstracts/index.js";

import { SlashCommandBuilder } from "discord.js";
import { dynaSend, SendMethod } from "@vimcord/ux";
import { AbstractCommandModule, CommandModuleType } from "@/abstracts/index.js";

type SlashCommandModuleOptions = AppCommandModuleOptions<CommandModuleType.Slash>;

export class SlashCommandModule extends AbstractCommandModule<CommandModuleType.Slash> {
    override type: CommandModuleType.Slash = CommandModuleType.Slash;
    override moduleType: string = "Command:Slash";

    readonly builder: SlashCommandBuilder;
    readonly deferReply: SlashCommandModuleOptions["deferReply"];
    readonly registration: NonNullable<SlashCommandModuleOptions["registration"]>;
    readonly routes: Map<string, SlashCommandModuleRoute>;

    constructor(options: SlashCommandModuleOptions) {
        const builder = typeof options.builder === "function" ? options.builder(new SlashCommandBuilder()) : options.builder;
        super({ name: builder.name, description: builder.description, ...options });

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
}

function createRoutePath(interaction: ChatInputCommandInteraction): string | null {
    const subcommand = interaction.options.getSubcommand(false);
    if (!subcommand) return null;

    const group = interaction.options.getSubcommandGroup(false);
    return (group ? `${group}:${subcommand}` : subcommand).trim().toLowerCase();
}
