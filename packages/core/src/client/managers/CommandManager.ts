import type {
    ChatInputCommandInteraction,
    ContextMenuCommandInteraction,
    Interaction,
    Message,
    RESTPostAPIApplicationCommandsJSONBody
} from "discord.js";
import type { CommandModuleType } from "@/abstracts/index.js";
import type { VimcordModuleLogger } from "@/client/logger.js";
import type {
    MessageContextCommandModule,
    PrefixCommandModule,
    SlashCommandModule,
    UserContextCommandModule
} from "@/modules/index.js";
import type { Vimcord } from "../Vimcord.js";
import type { CommandFilter } from "./BaseCommandManager.js";

import { Routes } from "discord.js";
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

const COMMAND_MANAGER_LOGGER = "CommandManager";
const COMMAND_MANAGER_LOGGER_EMOJI = "📦";
const DEFAULT_APPLICATION_COMMAND_CONTEXTS = [0, 1, 2];
const DEFAULT_APPLICATION_COMMAND_GUILD_CONTEXTS = [0];
const DEFAULT_APPLICATION_COMMAND_INTEGRATION_TYPES = [0];

export class PrefixCommandManager extends BaseCommandManager<CommandModuleType.Prefix, PrefixCommandModule> {
    constructor(client: Vimcord) {
        super(client);
        this.indexes.set("alias", { key: m => m.aliases, map: new Map(), isArray: true });
    }

    getByTrigger(trigger: string): PrefixCommandModule | undefined {
        return this.getByName(trigger) ?? this.getIndex("alias", trigger, true)[0];
    }

    protected override reindex(): void {
        super.reindex();
        this.indexes.set("alias", { key: m => m.aliases, map: new Map(), isArray: true });
    }
}

export class SlashCommandManager extends BaseCommandManager<CommandModuleType.Slash, SlashCommandModule> {
    constructor(client: Vimcord) {
        super(client);
    }
}

export class MessageContextCommandManager extends BaseCommandManager<
    CommandModuleType.MessageContext,
    MessageContextCommandModule
> {
    constructor(client: Vimcord) {
        super(client);
    }
}

export class UserContextCommandManager extends BaseCommandManager<CommandModuleType.UserContext, UserContextCommandModule> {
    constructor(client: Vimcord) {
        super(client);
    }
}

export class CommandManager {
    readonly prefix: PrefixCommandManager;
    readonly slash: SlashCommandManager;
    readonly context: { message: MessageContextCommandManager; user: UserContextCommandManager };

    private readonly logger: VimcordModuleLogger;

    constructor(readonly client: Vimcord) {
        this.logger = client.logger.module(COMMAND_MANAGER_LOGGER, { emoji: COMMAND_MANAGER_LOGGER_EMOJI });

        this.prefix = new PrefixCommandManager(client);
        this.slash = new SlashCommandManager(client);
        this.context = { message: new MessageContextCommandManager(client), user: new UserContextCommandManager(client) };
    }

    /**
     * Returns slash and context commands that match the provided filter.
     * @param options Filter options.
     */
    getAllAppCommands(
        options: CommandFilter = {}
    ): (SlashCommandModule | MessageContextCommandModule | UserContextCommandModule)[] {
        return [
            ...this.slash.getAll(options),
            ...this.context.message.getAll(options),
            ...this.context.user.getAll(options)
        ];
    }

    /**
     * Returns context commands that match the provided filter.
     * @param options Filter options.
     */
    getAllContextCommands(options: CommandFilter = {}): (MessageContextCommandModule | UserContextCommandModule)[] {
        return [...this.context.message.getAll(options), ...this.context.user.getAll(options)];
    }

    /**
     * Registers matching slash and context commands in the global Discord application command registry.
     */
    async registerGlobal(options: CommandFilter = {}): Promise<void> {
        const client = await this.getReadyClient("register app commands globally");
        if (!client) return;

        // --- Command Payloads ---
        const commands = this.getAllAppCommands(options)
            .filter(command => command.registration.global !== false)
            .map(command => command.builder.toJSON());
        if (!commands.length) {
            this.logger.info("No app commands to register globally");
            return;
        }

        this.logger.info(`Registering ${commands.length} app command${commands.length === 1 ? "" : "s"} globally...`);

        // --- Remote Sync ---
        const existing = (await client.rest.get(Routes.applicationCommands(client.user.id))) as RemoteApplicationCommand[];
        const result = await this.upsertApplicationCommands(commands, existing, {
            createRoute: Routes.applicationCommands(client.user.id),
            editRoute: commandId => Routes.applicationCommand(client.user.id, commandId)
        });
        this.logger.info(
            `Global app commands checked: ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged`
        );
    }

    /**
     * Removes every global Discord application command for this bot application.
     */
    async unregisterGlobal(): Promise<void> {
        const client = await this.getReadyClient("remove app commands globally");
        if (!client) return;

        this.logger.info("Removing all app command globally...");
        await client.rest.put(Routes.applicationCommands(client.user.id), { body: [] });
        this.logger.info("Removed app commands globally");
    }

    /**
     * Registers matching slash and context commands in each selected guild command registry.
     */
    async registerGuild(options: CommandFilter & { guilds?: string[] } = {}): Promise<void> {
        const client = await this.getReadyClient("register app commands by guild");
        if (!client) return;

        const commands = this.getAllAppCommands(options).map(command => command.builder.toJSON());
        if (!commands.length) {
            this.logger.info("No app commands to register by guild");
            return;
        }

        // Default to every cached guild when the caller does not provide a narrower target list
        const guildIds = options.guilds?.length ? options.guilds : client.guilds.cache.map(guild => guild.id);
        this.logger.info(`Registering app commands for ${guildIds.length} guild${guildIds.length === 1 ? "" : "s"}...`);

        // Sync guilds in parallel because Discord keeps each guild command registry separate
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
                this.logger.info(
                    `Guild app commands checked for ${guildName} (${guildId}): ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged`
                );
            })
        );

        this.logger.info(
            `Finished registering app commands for ${guildIds.length} guild${guildIds.length === 1 ? "" : "s"}`
        );
    }

    /**
     * Removes every Discord application command from each selected guild command registry.
     */
    async unregisterGuild(options: { guilds?: string[] } = {}): Promise<void> {
        const client = await this.getReadyClient("remove app commands by guild");
        if (!client) return;

        // Empty each guild command registry instead of deleting commands one at a time
        const guildIds = options.guilds?.length ? options.guilds : client.guilds.cache.map(guild => guild.id);
        this.logger.info(`Removing app commands from ${guildIds.length} guild${guildIds.length === 1 ? "" : "s"}...`);

        await Promise.all(
            guildIds.map(async guildId => {
                await client.rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: [] });
                const guildName = client.guilds.cache.get(guildId)?.name ?? "n/a";
                this.logger.info(`Removed app commands in guild: ${guildName} (${guildId})`);
            })
        );

        this.logger.info(`Finished removing app commands from ${guildIds.length} guild${guildIds.length === 1 ? "" : "s"}`);
    }

    /**
     * Dispatches a Discord interaction to the matching slash or context command module.
     */
    async dispatchInteraction(interaction: Interaction): Promise<void> {
        // Route Discord interactions to the manager that owns the underlying command type
        if (interaction.isChatInputCommand()) {
            await this.dispatchSlash(interaction);
            return;
        }

        if (interaction.isContextMenuCommand()) {
            await this.dispatchContext(interaction);
        }
    }

    /**
     * Dispatches a Discord message to the matching prefix command module.
     */
    async dispatchMessage(message: Message, allowedPrefixes: string[]): Promise<void> {
        const prefix = allowedPrefixes.find(p => message.content.startsWith(p));
        if (!prefix) return;

        // The first token after the prefix is the command name or alias
        const trigger = message.content.slice(prefix.length).trim().split(/\s+/, 1).shift();
        if (!trigger) return;

        const command = this.prefix.getByTrigger(trigger);
        if (!command) return;

        await command.run(message, prefix, trigger);
    }

    private async dispatchSlash(interaction: ChatInputCommandInteraction): Promise<void> {
        const command = this.slash.getByName(interaction.commandName);
        if (!command) return;

        await command.run(interaction);
    }

    private async dispatchContext(interaction: ContextMenuCommandInteraction): Promise<void> {
        const messageContextCommand = this.context.message.getByName(interaction.commandName);
        const userContextCommand = this.context.user.getByName(interaction.commandName);
        if (!messageContextCommand && !userContextCommand) return;

        if (messageContextCommand && interaction.isMessageContextMenuCommand()) {
            await messageContextCommand.run(interaction);
            return;
        }

        if (userContextCommand && interaction.isUserContextMenuCommand()) {
            await userContextCommand.run(interaction);
            return;
        }
    }

    private async getReadyClient(action: string): Promise<Vimcord<true> | null> {
        const ready = await this.client.awaitReady();
        if (!ready || !this.client.isReady()) {
            // REST routes need the application id from the ready client user
            this.logger.error(`Failed to ${action}: client is not ready`);
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

        // Name and type form Discord's stable command identity across local and remote payloads
        const existingByKey = new Map(existing.map(command => [createApplicationCommandKey(command), command]));

        for (const command of commands) {
            const existingCommand = existingByKey.get(createApplicationCommandKey(command));
            if (!existingCommand) {
                // Missing remote commands can be created without disturbing existing ids
                await this.client.rest.post(routes.createRoute, { body: command });
                created++;
                continue;
            }

            if (hasApplicationCommandChanged(command, existingCommand)) {
                // Patch changed commands so unchanged command ids and permissions stay intact
                await this.client.rest.patch(routes.editRoute(existingCommand.id), { body: command });
                updated++;
                continue;
            }

            unchanged++;
        }

        return { created, updated, unchanged };
    }
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
    const dmPermission = "dm_permission" in command ? command.dm_permission : undefined;
    const nsfw = "nsfw" in command ? command.nsfw : undefined;
    const contexts = "contexts" in command ? command.contexts : undefined;
    const integrationTypes = "integration_types" in command ? command.integration_types : undefined;

    // Compare only command fields Discord accepts from both local builders and remote REST payloads
    return normalizeRecord({
        name: command.name,
        type,
        description: type === 1 && "description" in command ? command.description : undefined,
        options: type === 1 && "options" in command ? command.options : undefined,
        default_member_permissions: "default_member_permissions" in command ? command.default_member_permissions : undefined,
        dm_permission: dmPermission === true ? undefined : dmPermission,
        contexts: isDefaultApplicationCommandContexts(contexts) ? undefined : contexts,
        integration_types: isDefaultApplicationCommandIntegrationTypes(integrationTypes) ? undefined : integrationTypes,
        nsfw: nsfw === false ? undefined : nsfw,
        name_localizations: "name_localizations" in command ? command.name_localizations : undefined,
        description_localizations: "description_localizations" in command ? command.description_localizations : undefined
    });
}

function normalizeRecord(record: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(record)
            .map(([key, value]) => [key, normalizeValue(value)] as const)
            .filter(([, value]) => value !== undefined)
    );
}

function normalizeValue(value: unknown): unknown {
    if (value === undefined || value === null) return undefined;

    if (Array.isArray(value)) {
        const values = value.map(normalizeValue).filter(item => item !== undefined);
        return values.length ? values : undefined;
    }

    if (typeof value === "object") {
        const record = normalizeRecord(value as Record<string, unknown>);
        if ("required" in record && record.required === false) delete record.required;
        if ("autocomplete" in record && record.autocomplete === false) delete record.autocomplete;

        return Object.keys(record).length ? record : undefined;
    }

    return value;
}

function stableStringify(value: unknown): string {
    // Deterministic JSON keeps field order from causing false-positive command updates
    return JSON.stringify(sortValue(value));
}

function isDefaultApplicationCommandContexts(value: unknown): boolean {
    return (
        isNumberSet(value, DEFAULT_APPLICATION_COMMAND_CONTEXTS) ||
        isNumberSet(value, DEFAULT_APPLICATION_COMMAND_GUILD_CONTEXTS)
    );
}

function isDefaultApplicationCommandIntegrationTypes(value: unknown): boolean {
    return isNumberSet(value, DEFAULT_APPLICATION_COMMAND_INTEGRATION_TYPES);
}

function isNumberSet(value: unknown, expected: number[]): boolean {
    if (!Array.isArray(value) || value.length !== expected.length) return false;

    const numbers = value.filter((item): item is number => typeof item === "number");
    if (numbers.length !== value.length) return false;

    const sortedValues = [...numbers].sort((a, b) => a - b);
    const sortedExpected = [...expected].sort((a, b) => a - b);
    return sortedValues.every((item, index) => item === sortedExpected[index]);
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
