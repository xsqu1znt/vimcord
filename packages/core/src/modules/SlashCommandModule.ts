import type {
    ChatInputCommandInteraction,
    RESTPostAPIApplicationCommandsJSONBody,
    SlashCommandOptionsOnlyBuilder,
    SlashCommandSubcommandsOnlyBuilder
} from "discord.js";
import type { AppCommandModuleOptions, CommandModuleHookContext } from "@/abstracts/AbstractCommandModule.js";

import { SlashCommandBuilder as DiscordSlashCommandBuilder } from "discord.js";
import { dynaSend, SendMethod } from "@vimcord/ux";
import { AbstractCommandModule, CommandModuleType } from "@/abstracts/AbstractCommandModule.js";

export type SlashCommandBuilder =
    | DiscordSlashCommandBuilder
    | SlashCommandOptionsOnlyBuilder
    | SlashCommandSubcommandsOnlyBuilder;

export interface SlashCommandRoute {
    /** Subcommand route path. Use `group:subcommand` for grouped subcommands. */
    path: string;
    handler(ctx: CommandModuleHookContext<CommandModuleType.Slash>): Promise<unknown> | unknown;
}

export type SlashCommandModuleOptions = Omit<AppCommandModuleOptions<CommandModuleType.Slash>, "name" | "execute"> & {
    name?: string;
    builder: SlashCommandBuilder | ((builder: DiscordSlashCommandBuilder) => SlashCommandBuilder);
    deferReply?: boolean | { ephemeral?: boolean };
    execute?: AppCommandModuleOptions<CommandModuleType.Slash>["execute"];
    routes?: SlashCommandRoute[];
    onUnknownRoute?(ctx: CommandModuleHookContext<CommandModuleType.Slash>, path: string): Promise<unknown> | unknown;
};

export class SlashCommandModule extends AbstractCommandModule<CommandModuleType.Slash> {
    override type: CommandModuleType.Slash = CommandModuleType.Slash;
    override moduleType: string = "Command:Slash";
    readonly builder: SlashCommandBuilder;
    readonly deferReply: boolean | { ephemeral?: boolean };
    readonly registration: NonNullable<SlashCommandModuleOptions["registration"]>;
    readonly routes: Map<string, SlashCommandRoute["handler"]>;

    constructor(options: SlashCommandModuleOptions) {
        const builder =
            typeof options.builder === "function" ? options.builder(new DiscordSlashCommandBuilder()) : options.builder;
        const commandData = builder.toJSON() as RESTPostAPIApplicationCommandsJSONBody;
        validateApplicationCommandData(commandData);

        const routes = new Map<string, SlashCommandRoute["handler"]>();
        options.routes?.forEach(route => routes.set(normalizeRoutePath(route.path), route.handler));
        const originalExecute = options.execute;

        super({
            ...options,
            name: options.name ?? commandData.name,
            execute: async ctx =>
                handleExecution(ctx, {
                    deferReply: options.deferReply ?? false,
                    routes,
                    onUnknownRoute: options.onUnknownRoute,
                    execute: originalExecute
                })
        });

        this.builder = builder;
        this.deferReply = options.deferReply ?? false;
        this.registration = { global: true, ...options.registration };
        this.routes = routes;
    }

    addRoutes(...routes: SlashCommandRoute[]): this {
        routes.forEach(route => this.routes.set(normalizeRoutePath(route.path), route.handler));
        return this;
    }

    toApplicationCommandData(): RESTPostAPIApplicationCommandsJSONBody {
        return this.builder.toJSON() as RESTPostAPIApplicationCommandsJSONBody;
    }

    protected override validate(): boolean {
        return true;
    }
}

function validateApplicationCommandData(data: RESTPostAPIApplicationCommandsJSONBody): void {
    if (!data.name) throw new Error(`[Vimcord] SlashCommandModule: Command name is required.`);
    if (!("description" in data) || !data.description) {
        throw new Error(`[Vimcord] SlashCommandModule: Command description is required.`);
    }
}

function resolveDeferReplyOptions(deferReply: SlashCommandModule["deferReply"]): { flags?: "Ephemeral" } | undefined {
    if (typeof deferReply !== "object") return undefined;
    return deferReply.ephemeral ? { flags: "Ephemeral" } : undefined;
}

async function handleExecution(
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
}

async function replyUnknownRoute(interaction: ChatInputCommandInteraction, path: string): Promise<void> {
    const content = `Unknown subcommand route: ${path}`;

    await dynaSend(interaction, {
        content,
        flags: "Ephemeral",
        sendMethod: interaction.replied || interaction.deferred ? SendMethod.FollowUp : SendMethod.Reply
    });
}

function createInteractionRoutePath(interaction: ChatInputCommandInteraction): string | null {
    const subcommand = interaction.options.getSubcommand(false);
    if (!subcommand) return null;

    const group = interaction.options.getSubcommandGroup(false);
    return normalizeRoutePath(group ? `${group}:${subcommand}` : subcommand);
}

function normalizeRoutePath(path: string): string {
    return path.trim().toLowerCase();
}
