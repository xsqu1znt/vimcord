import type { ModuleImportOptions } from "@/client/index.js";
import type { Vimcord } from "@/client/Vimcord.js";

import { CommandManager } from "./CommandManager.js";
import { EventManager } from "./EventManager.js";

const DEFAULTS = {
    fileSuffixes: {
        event: ".event",
        prefixCommand: ".prefix",
        slashCommand: ".slash",
        contextCommand: ".ctx"
    }
};

export class ModuleManager {
    commands: CommandManager;
    events: EventManager;
    private loaded = false;

    constructor(readonly client: Vimcord) {
        this.commands = new CommandManager(client);
        this.events = new EventManager(
            client,
            resolveSuffix(this.client.features.importModules?.events, DEFAULTS.fileSuffixes.event)
        );
    }

    async load(): Promise<void> {
        if (this.loaded) return;

        const imports = this.client.features.importModules;
        if (imports) {
            await this.commands.load(imports);
            if (imports?.events) await this.events.importFrom(resolveDir(imports.events));
        }

        this.events.mount();
        this.loaded = true;
    }

    unload(): void {
        if (!this.loaded) return;

        this.events.unmount();
        this.loaded = false;
    }
}

function resolveSuffix(opt: string | string[] | ModuleImportOptions | undefined, def: string | string[]): string | string[] {
    return Array.isArray(opt) || typeof opt === "string" ? def : (opt?.suffix ?? def);
}

function resolveDir(opt: string | string[] | ModuleImportOptions): string | string[] {
    return Array.isArray(opt) || typeof opt === "string" ? opt : opt.dir;
}
