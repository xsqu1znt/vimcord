import type { Message } from "discord.js";
import type {
    CommandModuleArgs,
    CommandModuleContext,
    CommandModuleHookContext,
    CommandModuleOptions
} from "@/abstracts/index.js";
import type { Vimcord } from "@/client/index.js";

import { AbstractCommandModule, CommandModuleType } from "@/abstracts/index.js";

type PrefixCommandModuleOptions = CommandModuleOptions<CommandModuleType.Prefix>;

export class PrefixCommandModule extends AbstractCommandModule<CommandModuleType.Prefix> {
    override type: CommandModuleType.Prefix = CommandModuleType.Prefix;
    override moduleType: string = "Command:Prefix";
    readonly aliases: string[];

    constructor(options: PrefixCommandModuleOptions) {
        super(options);
        this.aliases = options.aliases?.map(alias => alias.toLowerCase()) ?? [];
    }

    protected override validate(): boolean {
        return Boolean(this.name);
    }

    protected override createModuleCTX(
        args: CommandModuleArgs<CommandModuleType.Prefix>
    ): CommandModuleContext<CommandModuleType.Prefix> {
        return this.createCommandCTX(args);
    }

    protected override createHookCTX(
        args: CommandModuleArgs<CommandModuleType.Prefix>
    ): CommandModuleHookContext<CommandModuleType.Prefix> {
        return {
            ...this.createCommandCTX(args),
            module: this as any,
            args
        };
    }

    private createCommandCTX(
        args: CommandModuleArgs<CommandModuleType.Prefix>
    ): CommandModuleContext<CommandModuleType.Prefix> {
        const client = this.client as Vimcord<true>;
        const source = args[0];

        const message = source as Message;
        const messageContent = message.content.trim();

        // Strips the prefix and trigger out of the message content
        const contentStart = args[1].length + args[2].length;
        const strippedContent = messageContent.slice(contentStart).trim();

        return {
            client,
            message,
            messageContent: strippedContent,
            prefix: args[1],
            trigger: args[2],
            splitContent: (options = {}) => {
                const { separator = /\s+/, lowercase = false, uppercase = false } = options;

                const normalizedContent = uppercase
                    ? strippedContent.toUpperCase()
                    : lowercase
                      ? strippedContent.toLowerCase()
                      : strippedContent;
                const rawParts = normalizedContent ? normalizedContent.split(separator).filter(Boolean) : [];
                return rawParts;
            }
        };
    }
}
