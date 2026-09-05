import type { AutocompleteInteraction, ChatInputCommandInteraction } from "discord.js";
import type {
    AppCommandModuleOptions,
    CommandModuleArgs,
    CommandModuleContext,
    CommandModuleHookContext,
    ModuleHookContext,
    ModuleTestResult,
    SlashCommandAutocompleteHandler,
    SlashCommandBuilderResolvable,
    SlashCommandModuleRoute
} from "@/abstracts/index.js";
import type { Vimcord } from "@/client/index.js";

import { ApplicationCommandOptionType, SlashCommandBuilder } from "discord.js";
import { AbstractCommandModule, CommandModuleType } from "@/abstracts/index.js";
import { applyDeferReply, resolveDeferReply } from "@/commands/commandDeferral.js";
import { testCommandPermissions } from "@/commands/commandPermissions.js";
import { ModuleError } from "@/errors/ModuleError.js";
import { dynaSend, SendMethod } from "@/ux/index.js";

type SlashCommandModuleOptions = Omit<AppCommandModuleOptions<CommandModuleType.Slash>, "execute"> & {
    execute?: AppCommandModuleOptions<CommandModuleType.Slash>["execute"];
};

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

async function testRouteConditions(
    conditions: NonNullable<SlashCommandModuleRoute["conditions"]>,
    ctx: CommandModuleHookContext<CommandModuleType.Slash>
): Promise<ModuleTestResult> {
    for (let i = 0; i < conditions.length; i++) {
        const condition = conditions[i]!;

        try {
            const result = await condition(ctx);
            if (!result.passed) return result;
        } catch (err) {
            return { passed: false, reason: `Route condition threw an error at index ${i}`, error: err as Error };
        }
    }

    return { passed: true };
}

export class SlashCommandModule extends AbstractCommandModule<CommandModuleType.Slash> {
    override type: CommandModuleType.Slash = CommandModuleType.Slash;
    override moduleType: string = "Command:Slash";

    readonly builder: SlashCommandBuilderResolvable;
    readonly deferReply: SlashCommandModuleOptions["deferReply"];
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

    /**
     * Layers route resolution on top of the command's own tests: once the command-level deployment,
     * conditions, and permissions pass, a matched route's conditions and permissions run the same way.
     * A route match failing here (or not matching at all) means `execute` never runs, so it never
     * counts as an executed invocation.
     */
    protected override async performTests(ctx: CommandModuleHookContext<CommandModuleType.Slash>): Promise<boolean> {
        const passedBaseTests = await super.performTests(ctx);
        if (!passedBaseTests) return false;

        const routePath = createRoutePath(ctx.interaction);
        if (!routePath) return true;

        if (!this.routes.size) return true;

        const route = this.routes.get(routePath);
        if (!route) {
            await this.handleUnknownRoute(ctx, routePath);
            return false;
        }

        if (route.conditions?.length) {
            const conditionResult = await testRouteConditions(route.conditions, ctx);
            if (!conditionResult.passed) {
                ctx.conditionTestResult = conditionResult;
                await this.runHook("onConditionTestFail", ctx, async ctx => {
                    ctx.error ??= conditionResult.error ?? new ModuleError(conditionResult.reason);
                    await this.runHook("onError", ctx);
                });
                return false;
            }
        }

        if (route.permissions) {
            const permissionResult = await testCommandPermissions(ctx, route.permissions);
            if (!permissionResult.passed) {
                ctx.permissionTestResult = permissionResult;
                await this.runHook("onPermissionTestFail", ctx, async ctx => {
                    ctx.error ??= new ModuleError(permissionResult.reason);
                    await this.runHook("onError", ctx);
                });
                return false;
            }
        }

        return true;
    }

    /** Re-resolves the route `performTests` already validated and runs it, or runs the flat-command handler. */
    private async executeApp(ctx: CommandModuleContext<CommandModuleType.Slash>): Promise<unknown> {
        const { interaction } = ctx;
        const routePath = createRoutePath(interaction);

        if (routePath) {
            const route = this.routes.get(routePath);
            if (route) {
                await applyDeferReply(interaction, resolveDeferReply(route.deferReply, this.deferReply));
                return await route.handler(ctx);
            }
        }

        await applyDeferReply(interaction, this.deferReply);
        return await this.configuredExecute?.(ctx);
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

    protected override createModuleCTX(
        args: CommandModuleArgs<CommandModuleType.Slash>
    ): CommandModuleContext<CommandModuleType.Slash> {
        return { client: this.client as Vimcord<true>, interaction: args[0] };
    }

    protected override createHookCTX(
        moduleCTX: CommandModuleContext<CommandModuleType.Slash>,
        args: CommandModuleArgs<CommandModuleType.Slash>
    ): CommandModuleHookContext<CommandModuleType.Slash> {
        return {
            ...moduleCTX,
            module: this as unknown as ModuleHookContext<CommandModuleArgs<CommandModuleType.Slash>>["module"],
            args
        };
    }
}
