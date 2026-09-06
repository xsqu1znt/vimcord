import type {
    AutocompleteInteraction,
    ChatInputCommandInteraction,
    ContextMenuCommandInteraction,
    Guild,
    Interaction,
    Message,
    RESTPostAPIApplicationCommandsJSONBody,
    User
} from "discord.js";
import type { CommandModuleMetadata, CommandModuleType, ModuleRunResult } from "@/abstracts/index.js";
import type {
    MessageContextCommandModule,
    PrefixCommandModule,
    SlashCommandModule,
    UserContextCommandModule
} from "@/modules/index.js";
import type { Vimcord } from "../Vimcord.js";
import type { ApplicationCommandRegistrationScope, RemoteApplicationCommand } from "./applicationCommandData.js";
import type { CommandFilter } from "./BaseCommandManager.js";

import { Routes } from "discord.js";
import { mapWithConcurrency } from "@/utils/arr.js";
import { resolveGuildId } from "@/utils/clientUtils.js";
import {
    createApplicationCommandKey,
    createApplicationCommandUpdatePayload,
    hasApplicationCommandChanged
} from "./applicationCommandData.js";
import { BaseCommandManager } from "./BaseCommandManager.js";

type RestRoute = `/${string}`;

export interface DispatchMessageOptions {
    /** Treat a mention of the bot as a prefix.
     * @default false */
    allowMention?: boolean;
}

const COMMAND_MANAGER_LOGGER = "CommandManager";
const GUILD_SYNC_CONCURRENCY = 5;

export class PrefixCommandManager extends BaseCommandManager<CommandModuleType.Prefix, PrefixCommandModule> {
    constructor(client: Vimcord) {
        super(client);
        this.indexes.set("alias", { key: m => m.aliases, map: new Map(), isArray: true });
    }

    getByTrigger(trigger: string): PrefixCommandModule | undefined {
        return this.getByName(trigger) ?? this.getIndex("alias", trigger.toLowerCase(), true)[0];
    }
}

export class SlashCommandManager extends BaseCommandManager<CommandModuleType.Slash, SlashCommandModule> {}

export class MessageContextCommandManager extends BaseCommandManager<
    CommandModuleType.MessageContext,
    MessageContextCommandModule
> {}

export class UserContextCommandManager extends BaseCommandManager<CommandModuleType.UserContext, UserContextCommandModule> {}

export class CommandManager {
    readonly prefix: PrefixCommandManager;
    readonly slash: SlashCommandManager;
    readonly context: { message: MessageContextCommandManager; user: UserContextCommandManager };

    private cachedMentionUserId: string | undefined;
    private cachedMentionPrefixes: string[] = [];

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
            scope: "global",
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

        const commands = this.getAllAppCommands(options);
        if (!commands.length) {
            this.client.logger.module(COMMAND_MANAGER_LOGGER, "✖ There are no app commands to register");
            return false;
        }

        // Default to every cached guild when the caller does not provide a narrower target list
        const guildIds = options.guilds?.length ? options.guilds : client.guilds.cache.map(guild => guild.id);

        // A command with `registration.guilds` set is pushed only to those guilds
        const payloadsByGuild = new Map(
            guildIds.map(guildId => [
                guildId,
                commands
                    .filter(command => {
                        const targets = command.registration.guilds;
                        return !targets?.length || targets.map(resolveGuildId).includes(guildId);
                    })
                    .map(command => command.builder.toJSON())
            ])
        );

        this.client.logger.module(
            COMMAND_MANAGER_LOGGER,
            `↑ Pushing app commands to ${guildIds.length} guild${guildIds.length === 1 ? "" : "s"}...`
        );

        // Sync guilds with bounded concurrency; a large guild count would otherwise fire every REST request at once
        await mapWithConcurrency(guildIds, GUILD_SYNC_CONCURRENCY, async guildId => {
            const payload = payloadsByGuild.get(guildId) ?? [];
            if (!payload.length) {
                this.client.logger.debug(`[${COMMAND_MANAGER_LOGGER}] Skipping ${guildId}, no commands target this guild`);
                return;
            }

            const existing = (await client.rest.get(
                Routes.applicationGuildCommands(client.user.id, guildId)
            )) as RemoteApplicationCommand[];
            const result = await this.upsertApplicationCommands(payload, existing, {
                scope: "guild",
                createRoute: Routes.applicationGuildCommands(client.user.id, guildId),
                editRoute: commandId => Routes.applicationGuildCommand(client.user.id, guildId, commandId)
            });
            const guildName = client.guilds.cache.get(guildId)?.name ?? "n/a";
            this.client.logger.module(COMMAND_MANAGER_LOGGER, `Pushed app commands to ${guildName} (${guildId})`);
            this.client.logger.module(
                COMMAND_MANAGER_LOGGER,
                `╰ ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged`
            );
        });

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

        await mapWithConcurrency(guildIds, GUILD_SYNC_CONCURRENCY, async guildId => {
            await client.rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: [] });
            const guildName = client.guilds.cache.get(guildId)?.name ?? "n/a";
            this.client.logger.module(COMMAND_MANAGER_LOGGER, `Pulled app commands from ${guildName} (${guildId})`);
        });

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

        if (interaction.isAutocomplete()) {
            return await this.dispatchAutocomplete(interaction);
        }

        return false;
    }

    /**
     * Dispatches a Discord message to the matching prefix command module.
     */
    async dispatchMessage(
        message: Message,
        allowedPrefixes: string[],
        options: DispatchMessageOptions = {}
    ): Promise<boolean> {
        const prefix = this.findLongestPrefix(
            message.content,
            allowedPrefixes,
            options.allowMention ? this.getMentionPrefixes() : []
        );
        if (!prefix) return false;

        // The first token after the prefix is the command name or alias
        const trigger = message.content.slice(prefix.length).trim().split(/\s+/, 1).shift();
        if (!trigger) return false;

        const command = this.prefix.getByTrigger(trigger);
        if (!command) return false;

        return await this.runCommand(
            command,
            () => command.runWithResult(message, prefix, trigger),
            message.author,
            message.guild
        );
    }

    private async dispatchSlash(interaction: ChatInputCommandInteraction): Promise<boolean> {
        const command = this.slash.getByName(interaction.commandName);
        if (!command) return false;

        return await this.runCommand(command, () => command.runWithResult(interaction), interaction.user, interaction.guild);
    }

    private async dispatchContext(interaction: ContextMenuCommandInteraction): Promise<boolean> {
        if (interaction.isMessageContextMenuCommand()) {
            const command = this.context.message.getByName(interaction.commandName);
            if (!command) return false;

            return await this.runCommand(
                command,
                () => command.runWithResult(interaction),
                interaction.user,
                interaction.guild
            );
        }

        if (!interaction.isUserContextMenuCommand()) return false;
        const command = this.context.user.getByName(interaction.commandName);
        if (!command) return false;

        return await this.runCommand(command, () => command.runWithResult(interaction), interaction.user, interaction.guild);
    }

    /** Autocomplete skips the module pipeline and never emits a usage log; it fires per keystroke. */
    private async dispatchAutocomplete(interaction: AutocompleteInteraction): Promise<boolean> {
        const command = this.slash.getByName(interaction.commandName);
        if (!command) return false;

        return await command.handleAutocomplete(interaction);
    }

    /** Runs a matched command and emits its usage log. Always returns true, because a command was matched. */
    private async runCommand(
        command: { name: string; metadata: CommandModuleMetadata },
        run: () => Promise<ModuleRunResult>,
        user: User,
        guild: Guild | null
    ): Promise<boolean> {
        const startedAt = performance.now();
        const result = await run();

        if (result.executed && (command.metadata.logUsage ?? true)) {
            this.client.logger.commandUsed({
                commandName: command.name,
                userName: user.username,
                guildName: guild?.name,
                guildId: guild?.id,
                durationMs: performance.now() - startedAt,
                failed: Boolean(result.error)
            });
        }

        return true;
    }

    /** Mention forms Discord may send for this bot. Rebuilt only if the client user changes. */
    private getMentionPrefixes(): string[] {
        const userId = this.client.user?.id;
        if (!userId) return [];

        if (this.cachedMentionUserId !== userId) {
            this.cachedMentionUserId = userId;
            this.cachedMentionPrefixes = [`<@${userId}>`, `<@!${userId}>`];
        }
        return this.cachedMentionPrefixes;
    }

    /** Returns the longest prefix the content starts with, so "!!" wins over "!". */
    private findLongestPrefix(content: string, ...groups: readonly string[][]): string | undefined {
        let match: string | undefined;
        for (const group of groups) {
            for (const candidate of group) {
                if (candidate.length > (match?.length ?? 0) && content.startsWith(candidate)) match = candidate;
            }
        }
        return match;
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
            scope: ApplicationCommandRegistrationScope;
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

            if (hasApplicationCommandChanged(command, existingCommand, routes.scope)) {
                // Patch changed commands so unchanged command ids and permissions stay intact
                await this.client.rest.patch(routes.editRoute(existingCommand.id), {
                    body: createApplicationCommandUpdatePayload(command, routes.scope)
                });
                updated++;
                continue;
            }

            unchanged++;
        }

        return { created, updated, unchanged };
    }
}
