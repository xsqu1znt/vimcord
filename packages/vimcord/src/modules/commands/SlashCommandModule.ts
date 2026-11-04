import type { AutocompleteInteraction, ChatInputCommandInteraction } from "discord.js";
import type {
    AppCommandModuleOptions,
    CommandModuleContext,
    CommandModuleHookContext,
    SlashCommandAutocompleteHandler,
    SlashCommandBuilderResolvable,
    SlashCommandModuleRoute
} from "@/abstracts/index.js";
import type { Vimcord } from "@/client/index.js";

import { ApplicationCommandOptionType, SlashCommandBuilder } from "discord.js";
import { AbstractCommandModule, CommandModuleType } from "@/abstracts/index.js";
import { testConditions } from "@/abstracts/testConditions.js";
import { resolveDeferReply } from "@/commands/commandDeferral.js";
import { ModuleError } from "@/errors/ModuleError.js";
import { dynaSend, SendMethod } from "@/ux/index.js";

type SlashCommandModuleOptions = Omit<AppCommandModuleOptions<CommandModuleType.Slash>, "execute"> & {
    execute?: AppCommandModuleOptions<CommandModuleType.Slash>["execute"];
};

type InvocationContext = CommandModuleContext<CommandModuleType.Slash> & { [ROUTE_PATH]?: string | null };

const ROUTE_PATH = Symbol("routePath");

/** Discord's cap on the number of autocomplete choices returned in one response. */
const MAX_AUTOCOMPLETE_CHOICES = 25;

/** Every `group:subcommand` (or `subcommand`) path the builder declares. */
function getBuilderSubcommandPaths(builder: SlashCommandBuilderResolvable): string[] {
    const paths: string[] = [];

    for (const option of builder.toJSON().options ?? []) {
        if (option.type === ApplicationCommandOptionType.SubcommandGroup) {
            for (const sub of option.options ?? []) {
                if (sub.type === ApplicationCommandOptionType.Subcommand) paths.push(`${option.name}:${sub.name}`);
            }
        } else if (option.type === ApplicationCommandOptionType.Subcommand) {
            paths.push(option.name);
        }
    }

    return paths;
}

/**
 * Normalizes and validates route configuration once, at construction, so a misconfigured command
 * fails before it can ever be registered instead of on its first invocation.
 */
function buildRoutes(
    commandName: string,
    builder: SlashCommandBuilderResolvable,
    options: SlashCommandModuleOptions
): Map<string, SlashCommandModuleRoute> {
    const routeList = options.routes ?? [];
    if (!options.execute && !routeList.length) {
        throw new ModuleError(`Slash command '${commandName}' needs an 'execute' handler or at least one route`);
    }

    const routes = new Map<string, SlashCommandModuleRoute>();
    for (const route of routeList) {
        const path = route.path.trim().toLowerCase();
        if (routes.has(path)) {
            throw new ModuleError(`Slash command '${commandName}' has a duplicate route path '${path}'`);
        }
        routes.set(path, route);
    }

    if (!options.execute) {
        const builderPaths = getBuilderSubcommandPaths(builder);
        if (!builderPaths.length) {
            throw new ModuleError(
                `Slash command '${commandName}' has routes but its builder does not declare any subcommands`
            );
        }
        const missing = builderPaths.filter(path => !routes.has(path));
        if (missing.length) {
            throw new ModuleError(
                `Slash command '${commandName}' has no 'execute' handler and is missing routes for: ${missing.join(", ")}`
            );
        }
    }

    return routes;
}

function createRoutePath(interaction: ChatInputCommandInteraction | AutocompleteInteraction): string | null {
    const subcommand = interaction.options.getSubcommand(false);
    if (!subcommand) return null;

    const group = interaction.options.getSubcommandGroup(false);
    return (group ? `${group}:${subcommand}` : subcommand).trim().toLowerCase();
}

export class SlashCommandModule extends AbstractCommandModule<CommandModuleType.Slash> {
    override type: CommandModuleType.Slash = CommandModuleType.Slash;
    override moduleType: string = "Command:Slash";

    readonly builder: SlashCommandBuilderResolvable;
    override readonly deferReply: SlashCommandModuleOptions["deferReply"];
    readonly registration: NonNullable<SlashCommandModuleOptions["registration"]>;
    readonly routes: Map<string, SlashCommandModuleRoute>;
    readonly autocomplete: SlashCommandAutocompleteHandler | undefined;

    private readonly configuredExecute: SlashCommandModuleOptions["execute"];

    constructor(options: SlashCommandModuleOptions) {
        const builder = typeof options.builder === "function" ? options.builder(new SlashCommandBuilder()) : options.builder;
        const routes = buildRoutes(builder.name, builder, options);

        super({
            ...options,
            name: builder.name,
            description: builder.description,
            execute: ctx => this.executeApp(ctx)
        });

        this.builder = builder;
        this.deferReply = options.deferReply;
        this.registration = { global: true, ...options.registration };
        this.routes = routes;
        this.autocomplete = options.autocomplete;
        this.configuredExecute = options.execute;
        this.directExecution = new.target === SlashCommandModule;
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

    /** Tests routes only when configured, after the command's own restrictions pass. */
    protected override performTests(ctx: CommandModuleHookContext<CommandModuleType.Slash>): boolean | Promise<boolean> {
        const passed = super.performTests(ctx);
        if (typeof passed !== "boolean") return passed.then(passed => passed && this.testRoute(ctx));
        return passed && this.testRoute(ctx);
    }

    private testRoute(ctx: CommandModuleHookContext<CommandModuleType.Slash>): boolean | Promise<boolean> {
        if (!this.routes.size) return true;
        const routePath = createRoutePath(ctx.interaction);
        (ctx as InvocationContext)[ROUTE_PATH] = routePath;
        if (!routePath) return true;

        const route = this.routes.get(routePath);
        if (!route) {
            return this.handleUnknownRoute(ctx, routePath).then(() => false);
        }

        if (!route.conditions?.length && !route.permissions) return true;
        return this.testRouteRestrictions(ctx, route);
    }

    private testRouteRestrictions(
        ctx: CommandModuleHookContext<CommandModuleType.Slash>,
        route: SlashCommandModuleRoute
    ): boolean | Promise<boolean> {
        const result = testConditions(route.conditions ?? [], ctx, "Route condition");
        const finish = (result: Awaited<ReturnType<typeof testConditions>>) => {
            const passed = this.handleConditionResult(ctx, result);
            if (typeof passed !== "boolean") return passed;
            return passed && (!route.permissions || this.testPermissions(ctx, route.permissions));
        };
        return result instanceof Promise ? result.then(finish) : finish(result);
    }

    protected override canExecuteDirectly(): boolean {
        return !this.routes.size && super.canExecuteDirectly();
    }

    protected override prepareExecute(ctx: InvocationContext): void | Promise<void> {
        if (ctx[ROUTE_PATH] === undefined && this.routes.size) ctx[ROUTE_PATH] = createRoutePath(ctx.interaction);
        const path = ctx[ROUTE_PATH];
        const route = path ? this.routes.get(path) : undefined;
        return this.deferInteraction(ctx, resolveDeferReply(route?.deferReply, this.deferReply));
    }

    /** Reuses the resolved path while preserving live route-map changes made by hooks. */
    private executeApp(ctx: InvocationContext): unknown {
        const path = this.routes.size
            ? ctx[ROUTE_PATH] !== undefined
                ? ctx[ROUTE_PATH]
                : createRoutePath(ctx.interaction)
            : null;
        const route = path ? this.routes.get(path) : undefined;
        if (route) return route.handler(ctx);
        return this.configuredExecute?.call(this, ctx);
    }

    private async handleUnknownRoute(
        ctx: CommandModuleHookContext<CommandModuleType.Slash>,
        routePath: string
    ): Promise<void> {
        const handler = this.getHook("onUnknownRoute");
        if (handler) {
            try {
                await handler(ctx, routePath);
            } catch (err) {
                this.client?.logger.error(`[Module] Hook 'onUnknownRoute' failed for '${this.buildName()}'`, err as Error);
            }
            return;
        }

        await dynaSend(ctx.interaction, {
            content: `Subcommand '${routePath}' was not found.`,
            flags: "Ephemeral",
            sendMethod: ctx.interaction.replied || ctx.interaction.deferred ? SendMethod.FollowUp : SendMethod.Reply
        });
    }
}
