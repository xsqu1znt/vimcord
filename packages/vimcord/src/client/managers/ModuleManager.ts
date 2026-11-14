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

/** Module directory entries loaded during login. */
export interface AppModuleImports {
    /** Directories containing default-exported slash command modules. */
    slashCommands?: AppModuleImportOptions;
    /** Directories containing default-exported message context command modules. */
    messageContextCommands?: AppModuleImportOptions;
    /** Directories containing default-exported user context command modules. */
    userContextCommands?: AppModuleImportOptions;
    /** Directories containing default-exported prefix command modules. */
    prefixCommands?: AppModuleImportOptions;
    /** Directories containing default-exported event modules. */
    events?: AppModuleImportOptions;
}

/** Directories and filename suffixes for one module kind. */
export interface AppModuleImportOptions {
    /** The directories the modules can be found in, relative to the entry file. */
    dir: string | string[];
    /** Imports only files ending with these suffixes; other files are skipped silently. `null` imports every file, and each one must then default-export a module of this entry's type. */
    suffix: string | string[] | null;
}

/** Module directories imported by `login()`: per-type entries, or one directory searched for the conventional suffixes. */
export type AppModules = string | AppModuleImports;

/** The suffix each module type uses under the `modules: "./dir"` shorthand. */
const CONVENTIONAL_SUFFIXES = {
    slashCommands: ".slash",
    prefixCommands: ".prefix",
    messageContextCommands: ".mctx",
    userContextCommands: ".uctx",
    events: ".event"
} as const satisfies Record<keyof AppModuleImports, string>;

/** Expands the directory shorthand into one entry per module type. */
function expandShorthand(dir: string): AppModuleImports {
    const entries = Object.entries(CONVENTIONAL_SUFFIXES).map(([key, suffix]) => [key, { dir, suffix }]);
    return Object.fromEntries(entries) as AppModuleImports;
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

    /** Imports one configured entry, rejecting any matched file that isn't this entry's module type. `allowEmpty` lets a directory match nothing. */
    private async loadEntry<T extends { id: string }>(
        key: keyof AppModuleImports,
        moduleClass: abstract new (...args: never[]) => T,
        manager: { modules: Map<string, T>; register(...modules: T[]): void },
        entry: AppModuleImportOptions | undefined,
        allowEmpty: boolean
    ): Promise<void> {
        if (!entry) return;

        for (const dir of typeof entry.dir === "string" ? [entry.dir] : entry.dir) {
            const results = await importModulesFromDir<{ default?: unknown }>(dir, entry.suffix, allowEmpty);
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
     * Imports the modules configured on the client. A directory string loads every conventional suffix under it, and a type with no files is fine there.
     * @internal `login()` calls this; configure modules through the `modules` client option.
     */
    async load(modules: AppModules): Promise<void> {
        const shorthand = typeof modules === "string";
        const imports = shorthand ? expandShorthand(modules) : modules;

        await this.loadEntry("slashCommands", SlashCommandModule, this.commands.slash, imports.slashCommands, shorthand);
        await this.loadEntry("prefixCommands", PrefixCommandModule, this.commands.prefix, imports.prefixCommands, shorthand);
        await this.loadEntry(
            "messageContextCommands",
            MessageContextCommandModule,
            this.commands.context.message,
            imports.messageContextCommands,
            shorthand
        );
        await this.loadEntry(
            "userContextCommands",
            UserContextCommandModule,
            this.commands.context.user,
            imports.userContextCommands,
            shorthand
        );
        await this.loadEntry("events", EventModule, this.events, imports.events, shorthand);
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
