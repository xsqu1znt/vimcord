import type { ChatInputCommandInteraction, RESTPostAPIApplicationCommandsJSONBody } from "discord.js";
import type {
    AppCommandModuleOptions,
    CommandModuleHookContext,
    CommandModuleOptions,
    SlashCommandModuleRoute
} from "@/abstracts/index.js";

import { SlashCommandBuilder } from "discord.js";
import { dynaSend, SendMethod } from "@vimcord/ux";
import { AbstractCommandModule, CommandModuleType } from "@/abstracts/index.js";

type SlashCommandModuleOptions = AppCommandModuleOptions<CommandModuleType.Slash>;

export class SlashCommandModule extends AbstractCommandModule<CommandModuleType.Slash> {
    override type: CommandModuleType.Slash = CommandModuleType.Slash;
    override moduleType: string = "Command:Slash";

    readonly builder: SlashCommandModuleOptions["builder"];
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

        /* super({
            ...options,
            name: options.name ?? commandData.name,
            execute: async ctx =>
                handleExecution(ctx, {
                    deferReply: options.deferReply ?? false,
                    routes,
                    onUnknownRoute: options.onUnknownRoute,
                    execute: originalExecute
                })
        }); */
    }

    addRoutes(...routes: SlashCommandModuleRoute[]): this {
        routes.forEach(r => this.routes.set(r.path.trim().toLowerCase(), r));
        return this;
    }

    protected override validate(): boolean {
        return true;
    }
}

/* function resolveDeferReplyOptions(deferReply: SlashCommandModule["deferReply"]): { flags?: "Ephemeral" } | undefined {
    if (typeof deferReply !== "object") return undefined;
    return deferReply.ephemeral ? { flags: "Ephemeral" } : undefined;
} */

/* async function handleExecution(
    ctx: CommandModuleHookContext<CommandModuleType.Slash>,
    options: {
        deferReply: SlashCommandModule["deferReply"];
        routes: Map<string, SlashCommandRoute["handler"]>;
        onUnknownRoute: SlashCommandModuleOptions["onUnknownRoute"];
        execute: SlashCommandModuleOptions["execute"];
    }
): Promise<unknown> {
    const { interaction } = ctx;

    if (options.deferReply && !interaction.replied && !interaction.deferred) {
        await interaction.deferReply(resolveDeferReplyOptions(options.deferReply));
    }

    const routePath = createInteractionRoutePath(interaction);
    if (routePath) {
        const handler = options.routes.get(routePath);
        if (handler) return handler(ctx);
        if (options.onUnknownRoute) return options.onUnknownRoute(ctx, routePath);
        return replyUnknownRoute(interaction, routePath);
    }

    return options.execute?.(ctx);
} */

/* async function replyUnknownRoute(interaction: ChatInputCommandInteraction, path: string): Promise<void> {
    const content = `Unknown subcommand route: ${path}`;

    await dynaSend(interaction, {
        content,
        flags: "Ephemeral",
        sendMethod: interaction.replied || interaction.deferred ? SendMethod.FollowUp : SendMethod.Reply
    });
} */

/* function createInteractionRoutePath(interaction: ChatInputCommandInteraction): string | null {
    const subcommand = interaction.options.getSubcommand(false);
    if (!subcommand) return null;

    const group = interaction.options.getSubcommandGroup(false);
    return normalizeRoutePath(group ? `${group}:${subcommand}` : subcommand);
} */
