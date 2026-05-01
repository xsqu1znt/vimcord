import type {
    ChatInputCommandInteraction,
    ContextMenuCommandInteraction,
    Interaction,
    Message,
    RESTPostAPIApplicationCommandsJSONBody
} from "discord.js";
import type { CommandModuleType } from "@/abstracts/AbstractCommandModule.js";
import type { ModuleImportOptions } from "@/client/index.js";
import type { ContextCommandModule, PrefixCommandModule, SlashCommandModule } from "@/modules/index.js";
import type { Vimcord } from "../Vimcord.js";
import type { CommandFilter } from "./BaseCommandManager.js";

import { Routes } from "discord.js";
import { dynaSend, SendMethod } from "@vimcord/ux";
import { BaseCommandManager } from "./BaseCommandManager.js";

interface RemoteApplicationCommand {
    id: string;
    name: string;
    type?: number;
    description?: string;
    options?: unknown[];
    default_member_permissions?: string | null;
    dm_permission?: boolean;
    contexts?: number[] | null;
    integration_types?: number[] | null;
    nsfw?: boolean;
    name_localizations?: Record<string, string> | null;
    description_localizations?: Record<string, string> | null;
}

type RestRoute = `/${string}`;

export class PrefixCommandManager extends BaseCommandManager<CommandModuleType.Prefix, PrefixCommandModule> {
    constructor(client: Vimcord, fileSuffix?: string | string[]) {
        super(client, fileSuffix);

        this.indexes.set("alias", { key: m => m.aliases, map: new Map(), isArray: true });
    }

    getByTrigger(trigger: string): PrefixCommandModule | undefined {
        return this.getByName(trigger) ?? this.getIndex("alias", trigger, true)[0];
    }
}

export class SlashCommandManager extends BaseCommandManager<CommandModuleType.Slash, SlashCommandModule> {
    constructor(client: Vimcord, fileSuffix?: string | string[]) {
        super(client, fileSuffix);
    }
}

export class ContextCommandManager extends BaseCommandManager<CommandModuleType.Context, ContextCommandModule> {
    constructor(client: Vimcord, fileSuffix?: string | string[]) {
        super(client, fileSuffix);
    }
}

export class CommandManager {
    readonly prefix: PrefixCommandManager;
    readonly slash: SlashCommandManager;
    readonly context: ContextCommandManager;

    constructor(readonly client: Vimcord) {
        const imports = client.features.importModules;

        this.prefix = new PrefixCommandManager(client, resolveSuffix(imports?.prefixCommands, ".prefix"));
        this.slash = new SlashCommandManager(client, resolveSuffix(imports?.slashCommands, ".slash"));
        this.context = new ContextCommandManager(client, resolveSuffix(imports?.contextCommands, ".ctx"));
    }

    async load(imports = this.client.features.importModules): Promise<void> {
        if (!imports) return;

        if (imports.prefixCommands) await this.prefix.importFrom(resolveDir(imports.prefixCommands));
        if (imports.slashCommands) await this.slash.importFrom(resolveDir(imports.slashCommands));
        if (imports.contextCommands) await this.context.importFrom(resolveDir(imports.contextCommands));
    }

    getAllAppCommands(options: CommandFilter = {}): Array<SlashCommandModule | ContextCommandModule> {
        return [...this.slash.getAll(options), ...this.context.getAll(options)];
    }

    async registerGlobal(options: CommandFilter = {}): Promise<void> {
        const client = await this.getReadyClient("register app commands globally");
        if (!client) return;

        const commands = this.getAllAppCommands(options)
            .filter(command => command.registration.global !== false)
            .map(command => command.toApplicationCommandData());
        if (!commands.length) {
            client.logger.info("[CommandManager] No app commands to register globally");
            return;
        }

        const existing = (await client.rest.get(Routes.applicationCommands(client.user.id))) as RemoteApplicationCommand[];
        const result = await this.upsertApplicationCommands(commands, existing, {
            createRoute: Routes.applicationCommands(client.user.id),
            editRoute: commandId => Routes.applicationCommand(client.user.id, commandId)
        });
        client.logger.info(
            `[CommandManager] Global app commands checked: ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged`
        );
    }

    async unregisterGlobal(): Promise<void> {
        const client = await this.getReadyClient("remove app commands globally");
        if (!client) return;

        await client.rest.put(Routes.applicationCommands(client.user.id), { body: [] });
        client.logger.info("[CommandManager] Removed app commands globally");
    }

    async registerGuild(options: CommandFilter & { guilds?: string[] } = {}): Promise<void> {
        const client = await this.getReadyClient("register app commands by guild");
        if (!client) return;

        const commands = this.getAllAppCommands(options).map(command => command.toApplicationCommandData());
        if (!commands.length) {
            client.logger.info("[CommandManager] No app commands to register by guild");
            return;
        }

        const guildIds = options.guilds?.length ? options.guilds : client.guilds.cache.map(guild => guild.id);
        await Promise.all(
            guildIds.map(async guildId => {
                const existing = (await client.rest.get(
                    Routes.applicationGuildCommands(client.user.id, guildId)
                )) as RemoteApplicationCommand[];
                const result = await this.upsertApplicationCommands(commands, existing, {
                    createRoute: Routes.applicationGuildCommands(client.user.id, guildId),
                    editRoute: commandId => Routes.applicationGuildCommand(client.user.id, guildId, commandId)
                });
                const guildName = client.guilds.cache.get(guildId)?.name ?? "n/a";
                client.logger.info(
                    `[CommandManager] Guild app commands checked for ${guildId} (${guildName}): ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged`
                );
            })
        );
    }

    async unregisterGuild(options: { guilds?: string[] } = {}): Promise<void> {
        const client = await this.getReadyClient("remove app commands by guild");
        if (!client) return;

        const guildIds = options.guilds?.length ? options.guilds : client.guilds.cache.map(guild => guild.id);
        await Promise.all(
            guildIds.map(async guildId => {
                await client.rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: [] });
                const guildName = client.guilds.cache.get(guildId)?.name ?? "n/a";
                client.logger.info(`[CommandManager] Removed app commands in guild: ${guildId} (${guildName})`);
            })
        );
    }

    async dispatchInteraction(interaction: Interaction): Promise<void> {
        if (interaction.isChatInputCommand()) {
            await this.dispatchSlash(interaction);
            return;
        }

        if (interaction.isContextMenuCommand()) {
            await this.dispatchContext(interaction);
        }
    }

    async dispatchMessage(message: Message, prefix: string): Promise<void> {
        if (message.author.bot || !message.content.startsWith(prefix)) return;

        const [trigger] = message.content.slice(prefix.length).trim().split(/\s+/);
        if (!trigger) return;

        const command = this.prefix.getByTrigger(trigger);
        if (!command) return;

        await command.run(message);
    }

    private async dispatchSlash(interaction: ChatInputCommandInteraction): Promise<void> {
        const command = this.slash.getByName(interaction.commandName);
        if (!command) {
            await this.replyUnknownInteractionCommand(interaction);
            return;
        }

        await command.run(interaction);
    }

    private async dispatchContext(interaction: ContextMenuCommandInteraction): Promise<void> {
        const command = this.context.getByName(interaction.commandName);
        if (!command) {
            await this.replyUnknownInteractionCommand(interaction);
            return;
        }

        await command.run(interaction);
    }

    private async replyUnknownInteractionCommand(
        interaction: ChatInputCommandInteraction | ContextMenuCommandInteraction
    ): Promise<void> {
        const content = `**/\`${interaction.commandName}\`** is not a registered command.`;

        await dynaSend(interaction, {
            content,
            flags: "Ephemeral",
            sendMethod: interaction.replied || interaction.deferred ? SendMethod.FollowUp : SendMethod.Reply
        });
    }

    private async getReadyClient(action: string): Promise<Vimcord<true> | null> {
        const ready = await this.client.awaitReady();
        if (!ready || !this.client.isReady()) {
            this.client.logger.error(`[CommandManager] Failed to ${action}: client is not ready`);
            return null;
        }

        return this.client;
    }

    private async upsertApplicationCommands(
        commands: RESTPostAPIApplicationCommandsJSONBody[],
        existing: RemoteApplicationCommand[],
        routes: {
            createRoute: RestRoute;
            editRoute(commandId: string): RestRoute;
        }
    ): Promise<{ created: number; updated: number; unchanged: number }> {
        let created = 0;
        let updated = 0;
        let unchanged = 0;
        const existingByKey = new Map(existing.map(command => [createApplicationCommandKey(command), command]));

        for (const command of commands) {
            const existingCommand = existingByKey.get(createApplicationCommandKey(command));
            if (!existingCommand) {
                await this.client.rest.post(routes.createRoute, { body: command });
                created++;
                continue;
            }

            if (hasApplicationCommandChanged(command, existingCommand)) {
                await this.client.rest.patch(routes.editRoute(existingCommand.id), { body: command });
                updated++;
                continue;
            }

            unchanged++;
        }

        return { created, updated, unchanged };
    }
}

function resolveSuffix(opt: string | string[] | ModuleImportOptions | undefined, def: string): string | string[] {
    return Array.isArray(opt) || typeof opt === "string" ? def : (opt?.suffix ?? def);
}

function resolveDir(opt: string | string[] | ModuleImportOptions): string | string[] {
    return Array.isArray(opt) || typeof opt === "string" ? opt : opt.dir;
}

function createApplicationCommandKey(command: RESTPostAPIApplicationCommandsJSONBody | RemoteApplicationCommand): string {
    return `${command.type ?? 1}:${command.name}`;
}

function hasApplicationCommandChanged(
    local: RESTPostAPIApplicationCommandsJSONBody,
    remote: RemoteApplicationCommand
): boolean {
    return (
        stableStringify(normalizeApplicationCommandData(local)) !== stableStringify(normalizeApplicationCommandData(remote))
    );
}

function normalizeApplicationCommandData(
    command: RESTPostAPIApplicationCommandsJSONBody | RemoteApplicationCommand
): Record<string, unknown> {
    const type = command.type ?? 1;
    return removeNil({
        name: command.name,
        type,
        description: type === 1 && "description" in command ? command.description : undefined,
        options: type === 1 && "options" in command ? command.options : undefined,
        default_member_permissions: "default_member_permissions" in command ? command.default_member_permissions : undefined,
        dm_permission: "dm_permission" in command ? command.dm_permission : undefined,
        contexts: "contexts" in command ? command.contexts : undefined,
        integration_types: "integration_types" in command ? command.integration_types : undefined,
        nsfw: "nsfw" in command ? command.nsfw : undefined,
        name_localizations: "name_localizations" in command ? command.name_localizations : undefined,
        description_localizations: "description_localizations" in command ? command.description_localizations : undefined
    });
}

function removeNil(record: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined && value !== null));
}

function stableStringify(value: unknown): string {
    return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortValue);
    if (!value || typeof value !== "object") return value;

    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, val]) => [key, sortValue(val)])
    );
}
