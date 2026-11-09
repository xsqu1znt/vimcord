import type {
    CommandModuleArgs,
    CommandModuleContext,
    CommandModuleHookContext,
    PrefixCommandModuleOptions,
    ResolvedPrefixSubcommand
} from "@/abstracts/index.js";
import type { Vimcord } from "@/client/index.js";
import type { CommandRestrictions } from "@/commands/commandPermissions.js";

import { AbstractCommandModule, CommandModuleType } from "@/abstracts/index.js";
import { pickRestrictions } from "@/commands/commandPermissions.js";
import { ModuleError } from "@/errors/ModuleError.js";

const WHITESPACE = /\s+/;

/** Indexes names and aliases once so dispatch remains a pair of map lookups. */
function buildSubcommands(options: PrefixCommandModuleOptions) {
    const subcommands = new Map<string, ResolvedPrefixSubcommand>();
    const names = new Map<string, string>();

    for (const [key, subcommand] of Object.entries<ResolvedPrefixSubcommand>(
        (options.subcommands ?? {}) as Record<string, ResolvedPrefixSubcommand>
    )) {
        const name = key.trim().toLowerCase();
        for (const token of [name, ...(subcommand.aliases ?? [])]) {
            const trigger = token.trim().toLowerCase();
            if (!trigger || /\s/.test(trigger) || names.has(trigger)) {
                throw new ModuleError(
                    `Prefix command '${options.name}' has an invalid or duplicate subcommand trigger '${trigger}'`
                );
            }
            names.set(trigger, name);
        }
        subcommands.set(name, subcommand);
    }

    if (!options.execute && !subcommands.size) {
        throw new ModuleError(`Prefix command '${options.name}' needs an 'execute' handler or at least one subcommand`);
    }
    return { subcommands, names };
}

/** Routes text commands and subcommands from configured prefixes. */
export class PrefixCommandModule extends AbstractCommandModule<CommandModuleType.Prefix> {
    /** Command kind used for dispatch. */
    override type: CommandModuleType.Prefix = CommandModuleType.Prefix;
    /** Module kind displayed in logs. */
    override moduleType: string = "Command:Prefix";
    /** Additional triggers that resolve to this command. */
    readonly aliases: string[];
    /** Handlers keyed by subcommand name or slash group:subcommand path. */
    readonly subcommands: Map<string, ResolvedPrefixSubcommand>;

    private readonly subcommandNames: Map<string, string>;
    private readonly hasParentHandler: boolean;

    constructor(options: PrefixCommandModuleOptions) {
        const { subcommands, names } = buildSubcommands(options);
        const execute = options.execute as ((ctx: CommandModuleContext<CommandModuleType.Prefix>) => unknown) | undefined;
        super({
            ...options,
            execute: ctx => {
                const subcommand = ctx.subcommand ? this.subcommands.get(ctx.subcommand) : undefined;
                return subcommand ? subcommand.handler(ctx) : execute?.call(this, ctx);
            }
        });
        this.aliases = options.aliases?.map(alias => alias.toLowerCase()) ?? [];
        this.subcommands = subcommands;
        this.subcommandNames = names;
        this.hasParentHandler = Boolean(execute);
        // The direct path can't test a subcommand's restrictions or report an unmatched token.
        this.directExecution =
            new.target === PrefixCommandModule &&
            Boolean(this.name) &&
            this.hasParentHandler &&
            !Array.from(subcommands.values()).some(pickRestrictions);
    }

    protected override validate(): boolean {
        return Boolean(this.name);
    }

    protected override getSubcommand(
        ctx: CommandModuleHookContext<CommandModuleType.Prefix>
    ): CommandRestrictions | undefined {
        return ctx.subcommand ? this.subcommands.get(ctx.subcommand) : undefined;
    }

    protected override findUnknownRoute(ctx: CommandModuleHookContext<CommandModuleType.Prefix>): string | undefined {
        if (ctx.subcommand || this.hasParentHandler) return undefined;
        return ctx.args[0]?.toLowerCase() ?? "";
    }

    protected override createModuleCTX(
        args: CommandModuleArgs<CommandModuleType.Prefix>
    ): CommandModuleContext<CommandModuleType.Prefix> {
        const client = this.client as Vimcord<true>;
        const message = args[0];
        const strippedContent = message.content.slice(args[1].length).trimStart().slice(args[2].length).trim();
        const tokenEnd = this.subcommands.size ? strippedContent.search(WHITESPACE) : -1;
        const token = tokenEnd < 0 ? strippedContent : strippedContent.slice(0, tokenEnd);
        const subcommand = this.subcommands.size ? (this.subcommandNames.get(token.toLowerCase()) ?? null) : null;
        const content = subcommand ? strippedContent.slice(token.length).trimStart() : strippedContent;

        let parsedArgs: string[] | undefined;
        let parsedLowerArgs: string[] | undefined;
        const getArgs = () => (parsedArgs ??= content ? content.split(WHITESPACE) : []);

        return {
            client,
            user: message.author,
            message,
            content,
            subcommand,
            prefix: args[1],
            trigger: args[2],
            // Most commands read neither, so don't split on every message.
            get args() {
                return getArgs();
            },
            get lowerArgs() {
                return (parsedLowerArgs ??= getArgs().map(arg => arg.toLowerCase()));
            }
        };
    }
}
