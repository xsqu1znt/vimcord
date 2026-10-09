import type { Message } from "discord.js";
import type {
    CommandModuleArgs,
    CommandModuleContext,
    CommandModuleHookContext,
    CommandModuleOptions,
    ModuleHookContext,
    PrefixCommandModuleSubcommand
} from "@/abstracts/index.js";
import type { Vimcord } from "@/client/index.js";

import { AbstractCommandModule, CommandModuleType } from "@/abstracts/index.js";
import { ModuleError } from "@/errors/ModuleError.js";

type PrefixCommandModuleOptions = Omit<CommandModuleOptions<CommandModuleType.Prefix>, "execute"> & {
    execute?: CommandModuleOptions<CommandModuleType.Prefix>["execute"];
};

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
    private readonly configuredExecute: PrefixCommandModuleOptions["execute"];

    constructor(options: PrefixCommandModuleOptions) {
        const { subcommands, names } = buildSubcommands(options);
        super({ ...options, execute: ctx => this.executePrefix(ctx) });
        this.aliases = options.aliases?.map(alias => alias.toLowerCase()) ?? [];
        this.subcommands = subcommands;
        this.subcommandNames = names;
        this.configuredExecute = options.execute;
    }

    private executePrefix(ctx: CommandModuleContext<CommandModuleType.Prefix>): unknown {
        const subcommand = ctx.subcommand ? this.subcommands.get(ctx.subcommand) : undefined;
        if (subcommand) return this.runHandler(ctx, () => subcommand.handler(ctx));
        if (!this.configuredExecute) return;
        return this.runHandler(ctx, () => this.configuredExecute?.call(this, ctx));
    }

    protected override validate(): boolean {
        return Boolean(this.name);
    }

    protected override createModuleCTX(
        args: CommandModuleArgs<CommandModuleType.Prefix>
    ): CommandModuleContext<CommandModuleType.Prefix> {
        const client = this.client as Vimcord<true>;
        const source = args[0];

        const message = source as Message;
        const strippedContent = message.content.slice(args[1].length).trimStart().slice(args[2].length).trim();
        const token = strippedContent.match(/^\S+/)?.[0];
        const subcommand = token ? (this.subcommandNames.get(token.toLowerCase()) ?? null) : null;
        const messageContent = subcommand ? strippedContent.slice(token!.length).trimStart() : strippedContent;

        return {
            client,
            message,
            messageContent,
            subcommand,
            prefix: args[1],
            trigger: args[2],
            splitContent: (options = {}) => {
                const { separator = /\s+/, lowercase = false, uppercase = false } = options;

                const normalizedContent = uppercase
                    ? messageContent.toUpperCase()
                    : lowercase
                      ? messageContent.toLowerCase()
                      : messageContent;
                const rawParts = normalizedContent ? normalizedContent.split(separator).filter(Boolean) : [];
                return rawParts;
            }
        };
    }

    protected override createHookCTX(
        moduleCTX: CommandModuleContext<CommandModuleType.Prefix>,
        args: CommandModuleArgs<CommandModuleType.Prefix>
    ): CommandModuleHookContext<CommandModuleType.Prefix> {
        return {
            ...moduleCTX,
            module: this as unknown as ModuleHookContext<CommandModuleArgs<CommandModuleType.Prefix>>["module"],
            args
        };
    }
}
