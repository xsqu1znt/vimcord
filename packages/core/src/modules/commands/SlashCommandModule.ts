import type { AutocompleteInteraction, CacheType, ChatInputCommandInteraction } from "discord.js";
import type {
    AppCommandModuleOptions,
    CommandModuleArgs,
    CommandModuleContext,
    CommandModuleHookContext,
    SlashCommandAutocompleteHandler,
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

/** Discord's cap on the number of autocomplete choices returned in one response. */
const MAX_AUTOCOMPLETE_CHOICES = 25;

export class SlashCommandModule extends AbstractCommandModule<CommandModuleType.Slash> {
    override type: CommandModuleType.Slash = CommandModuleType.Slash;
    override moduleType: string = "Command:Slash";

    readonly builder: SlashCommandBuilderResolvable;
    readonly deferReply: SlashCommandModuleOptions["deferReply"];
    readonly registration: NonNullable<SlashCommandModuleOptions["registration"]>;
    readonly routes: Map<string, SlashCommandModuleRoute>;
    readonly autocomplete: SlashCommandAutocompleteHandler | undefined;

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
        this.autocomplete = options.autocomplete;

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

                    // Run the onUnknownRoute hook, local or global, if one is registered
                    const handler = this.getHook("onUnknownRoute");
                    if (handler) {
                        try {
                            return await handler(
                                this.createHookCTX(this.createModuleCTX([interaction]), [interaction]),
                                routePath
                            );
                        } catch (err) {
                            this.client?.logger.error(
                                `[Module] Hook 'onUnknownRoute' failed for '${this.buildName()}'`,
                                err as Error
                            );
                            return;
                        }
                    }

                    // Or send a generic unknown-route message
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

    /**
     * Answers an autocomplete interaction with the matching route handler, falling back to the module handler.
     * Skips the module pipeline because Discord allows 3 seconds and the interaction cannot report an error.
     * @param interaction The autocomplete interaction to answer
     * @returns Whether a handler was found
     */
    async handleAutocomplete(interaction: AutocompleteInteraction): Promise<boolean> {
        const routePath = createRoutePath(interaction);
        const handler = (routePath ? this.routes.get(routePath)?.autocomplete : undefined) ?? this.autocomplete;
        if (!handler) return false;

        try {
            const choices = await handler({
                client: this.client as Vimcord<true>,
                interaction,
                focused: interaction.options.getFocused(true)
            });
            if (choices && !interaction.responded) {
                await interaction.respond(choices.slice(0, MAX_AUTOCOMPLETE_CHOICES));
            }
        } catch (err) {
            this.client?.logger.error(`[Module] Autocomplete failed for '${this.buildName()}'`, err as Error);
        }

        return true;
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
        moduleCTX: CommandModuleContext<CommandModuleType.Slash>,
        args: CommandModuleArgs<CommandModuleType.Slash>
    ): CommandModuleHookContext<CommandModuleType.Slash> {
        return { ...moduleCTX, module: this as any, args };
    }
}

function createRoutePath(interaction: ChatInputCommandInteraction | AutocompleteInteraction): string | null {
    const subcommand = interaction.options.getSubcommand(false);
    if (!subcommand) return null;

    const group = interaction.options.getSubcommandGroup(false);
    return (group ? `${group}:${subcommand}` : subcommand).trim().toLowerCase();
}
