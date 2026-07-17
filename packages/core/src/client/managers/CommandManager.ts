import type {
    ChatInputCommandInteraction,
    ContextMenuCommandInteraction,
    Interaction,
    Message,
    RESTPostAPIApplicationCommandsJSONBody
} from "discord.js";
import type { CommandModuleType } from "@/abstracts/index.js";
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
const DEFAULT_APPLICATION_COMMAND_CONTEXTS = [0, 1, 2];
const DEFAULT_APPLICATION_COMMAND_GUILD_CONTEXTS = [0];
const DEFAULT_APPLICATION_COMMAND_INTEGRATION_TYPES = [0];

export class PrefixCommandManager extends BaseCommandManager<CommandModuleType.Prefix, PrefixCommandModule> {
    constructor(client: Vimcord) {
        super(client);
        this.indexes.set("alias", { key: m => m.aliases, map: new Map(), isArray: true });
    }

    getByTrigger(trigger: string): PrefixCommandModule | undefined {
        return this.getByName(trigger) ?? this.getIndex("alias", trigger.toLowerCase(), true)[0];
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

    constructor(readonly client: Vimcord) {
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
     * Pushes app commands to the bot application.
     * @param options Filter options.
     * @returns Whether command synchronization completed.
     */
    async push(options: CommandFilter = {}): Promise<boolean> {
        const client = await this.getReadyClient("push app commands");
        if (!client) return false;

        // --- Command Payloads ---
        const commands = this.getAllAppCommands(options)
            .filter(command => command.registration.global !== false)
            .map(command => command.builder.toJSON());
        if (!commands.length) {
            this.client.logger.module(COMMAND_MANAGER_LOGGER, "✖ There are no app commands to push");
            return false;
        }

        this.client.logger.module(
            COMMAND_MANAGER_LOGGER,
            `↑ Pushing ${commands.length} app command${commands.length === 1 ? "" : "s"}...`
        );

        // --- Remote Sync ---
        const existing = (await client.rest.get(Routes.applicationCommands(client.user.id))) as RemoteApplicationCommand[];
        const result = await this.upsertApplicationCommands(commands, existing, {
            createRoute: Routes.applicationCommands(client.user.id),
            editRoute: commandId => Routes.applicationCommand(client.user.id, commandId)
        });
        this.client.logger.module(COMMAND_MANAGER_LOGGER, "🗸 Pushed app commands");
        this.client.logger.module(
            COMMAND_MANAGER_LOGGER,
            `╰ ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged`
        );
        return true;
    }

    /**
     * Pulls app commands from the bot application.
     * @returns Whether command removal completed.
     */
    async pull(): Promise<boolean> {
        const client = await this.getReadyClient("pull app commands");
        if (!client) return false;

        this.client.logger.module(COMMAND_MANAGER_LOGGER, "↓ Pulling app commands...");
        await client.rest.put(Routes.applicationCommands(client.user.id), { body: [] });
        this.client.logger.module(COMMAND_MANAGER_LOGGER, "🗸 Pulled app commands");
        return true;
    }

    /**
     * Pushes app commands to each guild the bot application is in.
     * @param options Filter options.
     * @returns Whether command synchronization completed.
     */
    async pushByGuild(options: CommandFilter & { guilds?: string[] } = {}): Promise<boolean> {
        const client = await this.getReadyClient("push app commands by guild");
        if (!client) return false;

        const commands = this.getAllAppCommands(options).map(command => command.builder.toJSON());
        if (!commands.length) {
            this.client.logger.module(COMMAND_MANAGER_LOGGER, "✖ There are no app commands to register");
            return false;
        }

        // Default to every cached guild when the caller does not provide a narrower target list
        const guildIds = options.guilds?.length ? options.guilds : client.guilds.cache.map(guild => guild.id);
        this.client.logger.module(
            COMMAND_MANAGER_LOGGER,
            `↑ Pushing app commands to ${guildIds.length} guild${guildIds.length === 1 ? "" : "s"}...`
        );

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
                this.client.logger.module(COMMAND_MANAGER_LOGGER, `Pushed app commands to ${guildName} (${guildId})`);
                this.client.logger.module(
                    COMMAND_MANAGER_LOGGER,
                    `╰ ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged`
                );
            })
        );

        this.client.logger.module(
            COMMAND_MANAGER_LOGGER,
            `🗸 Finished pushing app commands to ${guildIds.length} guild${guildIds.length === 1 ? "" : "s"}`
        );
        return true;
    }

    /**
     * Pulls app commands from each guild the bot application is in.
     * @param options Filter options.
     * @returns Whether command removal completed.
     */
    async pullByGuild(options: { guilds?: string[] } = {}): Promise<boolean> {
        const client = await this.getReadyClient("pull app commands by guild");
        if (!client) return false;

        // Empty each guild command registry instead of deleting commands one at a time
        const guildIds = options.guilds?.length ? options.guilds : client.guilds.cache.map(guild => guild.id);
        this.client.logger.module(
            COMMAND_MANAGER_LOGGER,
            `↓ Pulling app commands from ${guildIds.length} guild${guildIds.length === 1 ? "" : "s"}...`
        );

        await Promise.all(
            guildIds.map(async guildId => {
                await client.rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: [] });
                const guildName = client.guilds.cache.get(guildId)?.name ?? "n/a";
                this.client.logger.module(COMMAND_MANAGER_LOGGER, `Pulled app commands from ${guildName} (${guildId})`);
            })
        );

        this.client.logger.module(
            COMMAND_MANAGER_LOGGER,
            `🗸 Finished pulling app commands from ${guildIds.length} guild${guildIds.length === 1 ? "" : "s"}`
        );
        return true;
    }

    /**
     * Dispatches a Discord interaction to the matching slash or context command module.
     */
    async dispatchInteraction(interaction: Interaction): Promise<boolean> {
        // Route Discord interactions to the manager that owns the underlying command type
        if (interaction.isChatInputCommand()) {
            return await this.dispatchSlash(interaction);
        }

        if (interaction.isContextMenuCommand()) {
            return await this.dispatchContext(interaction);
        }

        return false;
    }

    /**
     * Dispatches a Discord message to the matching prefix command module.
     */
    async dispatchMessage(message: Message, allowedPrefixes: string[]): Promise<boolean> {
        const prefix = allowedPrefixes.find(p => message.content.startsWith(p));
        if (!prefix) return false;

        // The first token after the prefix is the command name or alias
        const trigger = message.content.slice(prefix.length).trim().split(/\s+/, 1).shift();
        if (!trigger) return false;

        const command = this.prefix.getByTrigger(trigger);
        if (!command) return false;

        try {
            const startedAt = performance.now();
            const result = await command.runWithResult(message, prefix, trigger);
            if (result.executed && (command.metadata.logUsage ?? true)) {
                this.client.logger.commandUsed({
                    commandName: command.name,
                    userName: message.author.username,
                    guildName: message.guild?.name,
                    guildId: message.guild?.id,
                    durationMs: performance.now() - startedAt
                });
            }
        } catch (err) {
            throw err;
        } finally {
            return true;
        }
    }

    private async dispatchSlash(interaction: ChatInputCommandInteraction): Promise<boolean> {
        const command = this.slash.getByName(interaction.commandName);
        if (!command) return false;

        try {
            const startedAt = performance.now();
            const result = await command.runWithResult(interaction);
            if (result.executed && (command.metadata.logUsage ?? true)) {
                this.client.logger.commandUsed({
                    commandName: command.name,
                    userName: interaction.user.username,
                    guildName: interaction.guild?.name,
                    guildId: interaction.guild?.id,
                    durationMs: performance.now() - startedAt
                });
            }
        } catch (err) {
            throw err;
        } finally {
            return true;
        }
    }

    private async dispatchContext(interaction: ContextMenuCommandInteraction): Promise<boolean> {
        const messageContextCommand = this.context.message.getByName(interaction.commandName);
        const userContextCommand = this.context.user.getByName(interaction.commandName);
        if (!messageContextCommand && !userContextCommand) return false;

        try {
            if (messageContextCommand && interaction.isMessageContextMenuCommand()) {
                const startedAt = performance.now();
                const result = await messageContextCommand.runWithResult(interaction);
                if (result.executed && (messageContextCommand.metadata.logUsage ?? true)) {
                    this.client.logger.commandUsed({
                        commandName: messageContextCommand.name,
                        userName: interaction.user.username,
                        guildName: interaction.guild?.name,
                        guildId: interaction.guild?.id,
                        durationMs: performance.now() - startedAt
                    });
                }
                return false;
            }

            if (userContextCommand && interaction.isUserContextMenuCommand()) {
                const startedAt = performance.now();
                const result = await userContextCommand.runWithResult(interaction);
                if (result.executed && (userContextCommand.metadata.logUsage ?? true)) {
                    this.client.logger.commandUsed({
                        commandName: userContextCommand.name,
                        userName: interaction.user.username,
                        guildName: interaction.guild?.name,
                        guildId: interaction.guild?.id,
                        durationMs: performance.now() - startedAt
                    });
                }
                return false;
            }
        } catch (err) {
            throw err;
        } finally {
            return true;
        }
    }

    private async getReadyClient(action: string): Promise<Vimcord<true> | null> {
        const ready = await this.client.awaitReady();
        if (!ready || !this.client.isReady()) {
            // REST routes need the application id from the ready client user
            this.client.logger.error(`[${COMMAND_MANAGER_LOGGER}] Failed to ${action}: client is not ready`);
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
