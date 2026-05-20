import type { ChatInputCommandInteraction, ContextMenuCommandInteraction, Message } from "discord.js";
import type { Vimcord } from "@/client/index.js";
import type { CommandModulePermissions } from "@/commands/commandPermissions.js";
import type {
    CommandModuleArgs,
    CommandModuleContext,
    CommandModuleHookContext,
    CommandModuleHooks,
    CommandModuleOptions
} from "./CommandModuleTypeKit.js";

import { AbstractModule } from "../AbstractModule.js";
import { CommandModuleType } from "./CommandModuleTypeKit.js";

export abstract class AbstractCommandModule<T extends CommandModuleType> extends AbstractModule<
    CommandModuleArgs<T>,
    CommandModuleContext<T>,
    CommandModuleHookContext<T>,
    CommandModuleHooks<T>
> {
    abstract readonly type: T;
    protected readonly permissions: CommandModulePermissions;
    override readonly hooks: CommandModuleHooks<T>;
    readonly description?: string;

    constructor(options: CommandModuleOptions<T>) {
        super(options);

        this.permissions = options.permissions ?? {};
        this.hooks = options.hooks ?? {};
    }

    protected override createModuleCTX(args: CommandModuleArgs<T>): CommandModuleContext<T> {
        return this.createCommandCTX(args);
    }

    protected override createHookCTX(args: CommandModuleArgs<T>): CommandModuleHookContext<T> {
        return {
            ...this.createCommandCTX(args),
            module: this,
            args
        } as unknown as CommandModuleHookContext<T>;
    }

    private createCommandCTX(args: CommandModuleArgs<T>): CommandModuleContext<T> {
        const client = this.client as Vimcord<true>;
        const source = args[0];

        if (this.type === CommandModuleType.Prefix) {
            const message = source as Message;
            const content = message.content.trim();
            const prefixUsed = content.split(/\s+/, 1)[0] ?? "";
            const messageContent = content.slice(prefixUsed.length).trim();

            return {
                client,
                message,
                messageContent,
                splitContent: (options = {}) => {
                    const { separator = /\s+/, lowercase = false, uppercase = false } = options;
                    const rawParts = messageContent ? messageContent.split(separator).filter(Boolean) : [];

                    if (lowercase) return rawParts.map(part => part.toLowerCase());
                    if (uppercase) return rawParts.map(part => part.toUpperCase());

                    return rawParts;
                },
                prefixUsed
            } as CommandModuleContext<T>;
        }

        if (this.type === CommandModuleType.Slash) {
            return {
                client,
                interaction: source as ChatInputCommandInteraction
            } as CommandModuleContext<T>;
        }

        return {
            client,
            interaction: source as ContextMenuCommandInteraction
        } as CommandModuleContext<T>;
    }
}
