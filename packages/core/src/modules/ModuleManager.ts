import type { ModuleImportOptions } from "@/client/index.js";
import type { Vimcord } from "@/client/Vimcord.js";

import { EventManager } from "@/client/index.js";

const DEFAULTS = {
    fileSuffixes: {
        event: ".event",
        prefixCommand: ".prefix",
        slashCommand: ".slash",
        contextCommand: ".ctx"
    }
};

export class ModuleManager {
    events: EventManager;

    constructor(readonly client: Vimcord) {
        this.events = new EventManager(
            client,
            resolveSuffix(this.client.features.importModules?.events, DEFAULTS.fileSuffixes.event)
        );
    }

    async load(): Promise<void> {
        const imports = this.client.features.importModules;

        if (this.client.features.importModules) {
            if (imports?.events) await this.events.importFrom(resolveDir(imports.events));
        }
    }
}

function resolveSuffix(opt: string[] | ModuleImportOptions | undefined, def: string): string {
    return Array.isArray(opt) ? def : (opt?.suffix ?? def);
}

function resolveDir(opt: string[] | ModuleImportOptions): string | string[] {
    return Array.isArray(opt) ? opt : opt.dir;
}
