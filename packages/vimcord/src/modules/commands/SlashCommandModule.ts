import type { AutocompleteInteraction, ChatInputCommandInteraction } from "discord.js";
import type {
    CommandModuleArgs,
    CommandModuleContext,
    CommandModuleHookContext,
    ResolvedAppCommandRegistration,
    ResolvedSlashSubcommand,
    SlashCommandAutocompleteHandler,
    SlashCommandBuilderResolvable,
    SlashCommandModuleOptions
} from "@/abstracts/index.js";
import type { Vimcord } from "@/client/index.js";
import type { CommandRestrictions } from "@/commands/commandPermissions.js";

import { ApplicationCommandOptionType, SlashCommandBuilder } from "discord.js";
import { AbstractCommandModule, CommandModuleType } from "@/abstracts/index.js";
import { resolveDeferReply } from "@/commands/commandDeferral.js";
import { warnUnrecognizedAccessKeys } from "@/commands/commandPermissions.js";
import { resolveRegistration } from "@/commands/commandRegistration.js";
import { ModuleError } from "@/errors/ModuleError.js";

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

/** Normalizes and validates subcommand configuration once, at construction, so a misconfigured command fails before it can ever be registered instead of on its first invocation. */
function buildSubcommands(
    commandName: string,
    builder: SlashCommandBuilderResolvable,
    options: SlashCommandModuleOptions
): Map<string, ResolvedSlashSubcommand> {
    const entries = Object.entries((options.subcommands ?? {}) as Record<string, ResolvedSlashSubcommand>);
    if (!options.execute && !entries.length) {
        throw new ModuleError(`Slash command '${commandName}' needs an 'execute' handler or at least one subcommand`);
    }

    const subcommands = new Map<string, ResolvedSlashSubcommand>();
    for (const [key, subcommand] of entries) {
        const path = key.trim().toLowerCase();
        if (subcommands.has(path)) {
            throw new ModuleError(`Slash command '${commandName}' has a duplicate subcommand '${path}'`);
        }
        warnUnrecognizedAccessKeys(commandName, subcommand.access, path);
        subcommands.set(path, subcommand);
    }

    if (!options.execute) {
        const builderPaths = getBuilderSubcommandPaths(builder);
        if (!builderPaths.length) {
            throw new ModuleError(`Slash command '${commandName}' has subcommands but its builder does not declare any`);
        }
        const missing = builderPaths.filter(path => !subcommands.has(path));
        if (missing.length) {
            throw new ModuleError(
                `Slash command '${commandName}' has no 'execute' handler and is missing subcommands for: ${missing.join(", ")}`
            );
        }
    }

    return subcommands;
}

function createRoutePath(interaction: ChatInputCommandInteraction | AutocompleteInteraction): string | null {
    const subcommand = interaction.options.getSubcommand(false);
    if (!subcommand) return null;

    const group = interaction.options.getSubcommandGroup(false);
    return (group ? `${group}:${subcommand}` : subcommand).trim().toLowerCase();
}

/** Defines a slash command with typed handlers and autocomplete. */
export class SlashCommandModule extends AbstractCommandModule<CommandModuleType.Slash> {
    /** Command kind used for dispatch. */
    override type: CommandModuleType.Slash = CommandModuleType.Slash;
    /** Module kind displayed in logs. */
    override moduleType: string = "Command:Slash";

    /** Discord.js builder or callback configuring the application command. */
    readonly builder: SlashCommandBuilderResolvable;
    /** Defers the interaction before the handler runs. */
    override readonly deferReply: SlashCommandModuleOptions["deferReply"];
    /** Guild and global application command registration scopes. */
    readonly registration: ResolvedAppCommandRegistration;
    /** Handlers keyed by subcommand name or slash group:subcommand path. */
    readonly subcommands: Map<string, ResolvedSlashSubcommand>;
    /** Handler returning choices for the focused slash option. */
    readonly autocomplete: SlashCommandAutocompleteHandler | undefined;

    private readonly configuredExecute: ((ctx: CommandModuleContext<CommandModuleType.Slash>) => unknown) | undefined;

    constructor(options: SlashCommandModuleOptions) {
        const builder = typeof options.builder === "function" ? options.builder(new SlashCommandBuilder()) : options.builder;
        const subcommands = buildSubcommands(builder.name, builder, options);

        super({
            ...options,
            name: builder.name,
            description: builder.description,
            execute: ctx => this.executeApp(ctx)
        });

        this.builder = builder;
        this.deferReply = options.deferReply;
        this.registration = resolveRegistration(options.registration);
        this.subcommands = subcommands;
        this.autocomplete = options.autocomplete;
        this.configuredExecute = options.execute as typeof this.configuredExecute;
        this.directExecution = new.target === SlashCommandModule;
    }

    /**
     * Answers an autocomplete interaction with the matching subcommand handler, falling back to the module handler. Skips the module pipeline because Discord allows 3 seconds and the interaction cannot report an error.
     * @param interaction The autocomplete interaction to answer
     * @returns Whether a handler was found
     */
    async handleAutocomplete(interaction: AutocompleteInteraction): Promise<boolean> {
        const path = createRoutePath(interaction);
        const handler = (path ? this.subcommands.get(path)?.autocomplete : undefined) ?? this.autocomplete;
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

    protected override createModuleCTX(
        args: CommandModuleArgs<CommandModuleType.Slash>
    ): CommandModuleContext<CommandModuleType.Slash> {
        const ctx = super.createModuleCTX(args);
        ctx.subcommand = this.subcommands.size ? createRoutePath(args[0]) : null;
        return ctx;
    }

    protected override getSubcommand(
        ctx: CommandModuleHookContext<CommandModuleType.Slash>
    ): CommandRestrictions | undefined {
        return ctx.subcommand ? this.subcommands.get(ctx.subcommand) : undefined;
    }

    protected override findUnknownRoute(ctx: CommandModuleHookContext<CommandModuleType.Slash>): string | undefined {
        if (!ctx.subcommand || this.subcommands.has(ctx.subcommand)) return undefined;
        return ctx.subcommand;
    }

    protected override canExecuteDirectly(): boolean {
        return !this.subcommands.size && super.canExecuteDirectly();
    }

    protected override prepareExecute(ctx: CommandModuleContext<CommandModuleType.Slash>): void | Promise<void> {
        const subcommand = ctx.subcommand ? this.subcommands.get(ctx.subcommand) : undefined;
        return this.deferInteraction(ctx, resolveDeferReply(subcommand?.deferReply, this.deferReply));
    }

    private executeApp(ctx: CommandModuleContext<CommandModuleType.Slash>): unknown {
        const subcommand = ctx.subcommand ? this.subcommands.get(ctx.subcommand) : undefined;
        if (subcommand) return subcommand.execute(ctx);
        return this.configuredExecute?.call(this, ctx);
    }
}
