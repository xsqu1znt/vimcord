import type { Vimcord } from "@/client/Vimcord.js";

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
    /** The directories the modules can be found in. */
    dir: string | string[];
    /** Filters for modules that only end with these suffixes.
     *
     * @example
     * // Example module filenames using suffixes:
     * "ping.slash.ts" // .slash suffix
     * "help.prefix.ts" // .prefix suffix
     * "userInfo.mctx.ts" // .ctx suffix
     * "avatar.uctx.ts" // .ctx suffix
     * "ready.event.ts" // .event suffix
     */
    suffix?: string | string[];
}

export class ModuleManager {
    commands: CommandManager;
    events: EventManager;

    constructor(readonly client: Vimcord) {
        this.commands = new CommandManager(client);
        this.events = new EventManager(client);
    }

    /**
     * Imports modules from the given module directories.
     * @param imports The modules to import.
     */
    async load(imports: AppModuleImports): Promise<void> {
        // TODO: Prevent loading duplicates?

        // Import slash command modules
        if (imports.slashCommands) {
            const { dir, suffix } = imports.slashCommands;
            await this.commands.slash.importFrom(dir, suffix);
        }

        // Import prefix command modules
        if (imports.prefixCommands) {
            const { dir, suffix } = imports.prefixCommands;
            await this.commands.prefix.importFrom(dir, suffix);
        }

        // Import message context command modules
        if (imports.messageContextCommands) {
            const { dir, suffix } = imports.messageContextCommands;
            await this.commands.context.message.importFrom(dir, suffix);
        }

        // Import user context command modules
        if (imports.userContextCommands) {
            const { dir, suffix } = imports.userContextCommands;
            await this.commands.context.user.importFrom(dir, suffix);
        }

        // Import event modules
        if (imports.events) {
            const { dir, suffix } = imports.events;
            await this.events.importFrom(dir, suffix);
        }
    }

    /** Unloads all modules. */
    unload(): void {
        this.events.unmount();
        this.commands.slash.clear();
        this.commands.prefix.clear();
        this.commands.context.message.clear();
        this.commands.context.user.clear();
    }
}
