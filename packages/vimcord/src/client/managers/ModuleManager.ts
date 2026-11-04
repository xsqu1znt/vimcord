import type { Vimcord } from "@/client/Vimcord.js";

import { ModuleError } from "@/errors/ModuleError.js";
import {
    EventModule,
    MessageContextCommandModule,
    PrefixCommandModule,
    SlashCommandModule,
    UserContextCommandModule
} from "@/modules/index.js";
import { importModulesFromDir } from "@/utils/import.js";
import { CommandManager } from "./CommandManager.js";
import { EventManager } from "./EventManager.js";

export interface AppModuleImports {
    slashCommands?: AppModuleImportOptions;
    messageContextCommands?: AppModuleImportOptions;
    userContextCommands?: AppModuleImportOptions;
    prefixCommands?: AppModuleImportOptions;
    events?: AppModuleImportOptions;
}

export interface AppModuleImportOptions {
    /** The directories the modules can be found in, relative to the entry file. */
    dir: string | string[];
    /**
     * Imports only files ending with these suffixes; other files are skipped silently.
     * `null` imports every file, and each one must then default-export a module of this entry's type.
     *
     * @example
     * // Example module filenames using suffixes:
     * "ping.slash.ts" // .slash suffix
     * "help.prefix.ts" // .prefix suffix
     * "userInfo.mctx.ts" // .mctx suffix
     * "avatar.uctx.ts" // .uctx suffix
     * "ready.event.ts" // .event suffix
     */
    suffix: string | string[] | null;
}

function describeExport(value: unknown): string {
    if (value === undefined) return "no default export";
    return `a default export of type '${(value as object | null)?.constructor?.name ?? typeof value}'`;
}

export class ModuleManager {
    commands: CommandManager;
    events: EventManager;

    constructor(readonly client: Vimcord) {
        this.commands = new CommandManager(client);
        this.events = new EventManager(client);
    }

    /** Imports one configured entry, rejecting any matched file that isn't this entry's module type. */
    private async loadEntry<T extends { id: string }>(
        key: keyof AppModuleImports,
        moduleClass: abstract new (...args: never[]) => T,
        manager: { modules: Map<string, T>; register(...modules: T[]): void },
        entry: AppModuleImportOptions | undefined
    ): Promise<void> {
        if (!entry) return;

        for (const dir of typeof entry.dir === "string" ? [entry.dir] : entry.dir) {
            const results = await importModulesFromDir<{ default?: unknown }>(dir, entry.suffix);
            for (const { module, path } of results) {
                const value = module.default;
                if (!(value instanceof moduleClass)) {
                    throw new ModuleError(
                        `'${path}' has ${describeExport(value)}; modules.${key} expects a ${moduleClass.name}`
                    );
                }
                if (manager.modules.has(value.id)) {
                    throw new ModuleError(`'${path}' has a duplicate module id '${value.id}'`);
                }
                manager.register(value);
            }
            this.client.logger.debug(
                `[ModuleManager] Imported ${results.length} ${results.length === 1 ? "module" : "modules"} from '${dir}'`
            );
        }
    }

    /**
     * Imports the modules configured on the client.
     * @internal `login()` calls this; configure modules through the `modules` client option.
     */
    async load(imports: AppModuleImports): Promise<void> {
        await this.loadEntry("slashCommands", SlashCommandModule, this.commands.slash, imports.slashCommands);
        await this.loadEntry("prefixCommands", PrefixCommandModule, this.commands.prefix, imports.prefixCommands);
        await this.loadEntry(
            "messageContextCommands",
            MessageContextCommandModule,
            this.commands.context.message,
            imports.messageContextCommands
        );
        await this.loadEntry(
            "userContextCommands",
            UserContextCommandModule,
            this.commands.context.user,
            imports.userContextCommands
        );
        await this.loadEntry("events", EventModule, this.events, imports.events);
    }

    /** Removes the command listeners and unloads all modules. */
    unload(): void {
        this.commands.removeListeners();
        this.events.clear();
        this.commands.slash.clear();
        this.commands.prefix.clear();
        this.commands.context.message.clear();
        this.commands.context.user.clear();
    }
}
