import type { Vimcord } from "@/client/Vimcord.js";
import type { AbstractCommandModule, CommandModuleType } from "./AbstractCommandModule.js";

import { AbstractModuleImporter } from "./AbstractModuleImporter.js";

type AbstractCommandModuleIndexType = "name" | "category" | "tag";

export abstract class AbstractCommandManager<K extends CommandModuleType = CommandModuleType> extends AbstractModuleImporter<
    AbstractCommandModule<K>,
    AbstractCommandModuleIndexType
> {
    constructor(client: Vimcord, fileSuffix: string | string[] | undefined) {
        super(client, fileSuffix);

        this.indexes.set("name", { key: m => m.name, map: new Map() });
        this.indexes.set("category", { key: m => m.metadata.category, map: new Map(), isArray: true });
        this.indexes.set("tag", { key: m => m.metadata.tags, map: new Map(), isArray: true });
    }

    protected override createModuleKey(module: AbstractCommandModule<K>): string {
        return module.id;
    }

    override clear(): void {
        this.modules.clear();
        this.reindex();
    }

    override get(id: string): AbstractCommandModule<K> | undefined {
        return this.modules.get(id);
    }

    getByName(name: string): AbstractCommandModule<K>[] {
        return this.getIndexed("name", name, true);
    }

    getByCategory(category: string): AbstractCommandModule<K>[] {
        return this.getIndexed("category", category, true);
    }

    getByTag(tag: string): AbstractCommandModule<K>[] {
        return this.getIndexed("tag", tag, true);
    }
}
