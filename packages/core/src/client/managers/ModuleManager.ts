import type { Vimcord } from "@/client/Vimcord.js";

import { CommandManager } from "./CommandManager.js";
import { EventManager } from "./EventManager.js";

export interface AppModuleImports {
    /** Default suffix: slash
     * @example
     * // Example module filename
     * "ping.slash.ts"
     */
    slashCommands?: string | string[] | AppModuleImportOptions;
    /** Default suffix: ctx
     * @example
     * // Example module filename
     * "avatar.ctx.ts"
     */
    contextCommands?: string | string[] | AppModuleImportOptions;
    /** Default suffix: prefix
     * @example
     * // Example module filename
     * "help.prefix.ts"
     */
    prefixCommands?: string | string[] | AppModuleImportOptions;
    /** Default suffix: event
     * @example
     * // Example module filename
     * "ready.event.ts"
     */
    events?: string | string[] | AppModuleImportOptions;
}

export interface AppModuleImportOptions {
    /** The directories to import from. */
    dir: string | string[];
    /** Only import modules that end with these suffixes.
     *
     * Respectively, the default suffixes are `.slash`, `.ctx`, `.prefix`, and `.event`.
     *
     * @example
     * // Example module filenames using the default suffixes
     * "ping.slash.ts"
     * "avatar.ctx.ts"
     * "help.prefix.ts"
     * "ready.event.ts"
     */
    suffix?: string;
}

export class ModuleManager {
    commands: CommandManager;
    events: EventManager;

    constructor(readonly client: Vimcord) {
        this.commands = new CommandManager(client);
        this.events = new EventManager(client);
    }

    private resolveDirectory(opt: string | string[] | AppModuleImportOptions): string | string[] {
        return Array.isArray(opt) || typeof opt === "string" ? opt : opt.dir;
    }

    private resolveSuffix(opt: string | string[] | AppModuleImportOptions | undefined, def: string): string | string[] {
        return Array.isArray(opt) || typeof opt === "string" ? def : (opt?.suffix ?? def);
    }

    /**
     * Imports modules from the given module directories.
     * @param imports The modules to import.
     */
    async load(imports: AppModuleImports): Promise<void> {
        // TODO: Prevent loading duplicates?

        // Import slash command modules
        if (imports.slashCommands) {
            await this.commands.slash.importFrom(
                this.resolveDirectory(imports.slashCommands),
                this.resolveSuffix(imports.slashCommands, this.commands.slash.DEFAULT_SUFFIX)
            );
        }

        // Import prefix command modules
        if (imports.prefixCommands) {
            await this.commands.prefix.importFrom(
                this.resolveDirectory(imports.prefixCommands),
                this.resolveSuffix(imports.prefixCommands, this.commands.prefix.DEFAULT_SUFFIX)
            );
        }

        // Import context command modules
        if (imports.contextCommands) {
            await this.commands.context.importFrom(
                this.resolveDirectory(imports.contextCommands),
                this.resolveSuffix(imports.contextCommands, this.commands.context.DEFAULT_SUFFIX)
            );
        }

        // Import event modules
        if (imports.events) {
            await this.events.importFrom(
                this.resolveDirectory(imports.events),
                this.resolveSuffix(imports.events, this.events.DEFAULT_SUFFIX)
            );
        }
    }

    /** Unloads all modules. */
    unload(): void {
        this.events.unmount();
        this.commands.slash.clear();
        this.commands.prefix.clear();
        this.commands.context.clear();
    }
}
