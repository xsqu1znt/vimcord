import type {
    CommandModuleArgs,
    CommandModuleContext,
    CommandModuleOptions,
    PrefixCommandModuleSubcommand
} from "@/abstracts/index.js";
import type { Vimcord } from "@/client/index.js";

import { AbstractCommandModule, CommandModuleType } from "@/abstracts/index.js";
import { ModuleError } from "@/errors/ModuleError.js";

type PrefixCommandModuleOptions = Omit<CommandModuleOptions<CommandModuleType.Prefix>, "execute"> & {
    execute?: CommandModuleOptions<CommandModuleType.Prefix>["execute"];
};

const WHITESPACE = /\s+/;

/** Indexes names and aliases once so dispatch remains a pair of map lookups. */
function buildSubcommands(options: PrefixCommandModuleOptions) {
    const subcommands = new Map<string, PrefixCommandModuleSubcommand>();
    const names = new Map<string, string>();

    for (const [key, subcommand] of Object.entries(options.subcommands ?? {})) {
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

export class PrefixCommandModule extends AbstractCommandModule<CommandModuleType.Prefix> {
    override type: CommandModuleType.Prefix = CommandModuleType.Prefix;
    override moduleType: string = "Command:Prefix";
    readonly aliases: string[];
    readonly subcommands: Map<string, PrefixCommandModuleSubcommand>;

    private readonly subcommandNames: Map<string, string>;

    constructor(options: PrefixCommandModuleOptions) {
        const { subcommands, names } = buildSubcommands(options);
        super({
            ...options,
            execute: ctx => {
                const subcommand = ctx.subcommand ? this.subcommands.get(ctx.subcommand) : undefined;
                return subcommand ? subcommand.handler(ctx) : options.execute?.call(this, ctx);
            }
        });
        this.aliases = options.aliases?.map(alias => alias.toLowerCase()) ?? [];
        this.subcommands = subcommands;
        this.subcommandNames = names;
        this.directExecution = new.target === PrefixCommandModule && Boolean(this.name);
    }

    protected override validate(): boolean {
        return Boolean(this.name);
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
        const messageContent = subcommand ? strippedContent.slice(token.length).trimStart() : strippedContent;

        return {
            client,
            message,
            messageContent,
            subcommand,
            prefix: args[1],
            trigger: args[2],
            splitContent: options => {
                if (!messageContent) return [];
                if (!options) return messageContent.split(WHITESPACE);
                const normalizedContent = options.uppercase
                    ? messageContent.toUpperCase()
                    : options.lowercase
                      ? messageContent.toLowerCase()
                      : messageContent;
                return normalizedContent.split(options.separator ?? WHITESPACE).filter(Boolean);
            }
        };
    }
}
