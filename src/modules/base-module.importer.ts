import { Vimcord } from "@/client";
import { importModulesFromDir } from "@/utils/import.utils";

export abstract class ModuleImporter<T> {
    readonly client: Vimcord;
    abstract readonly items: Map<string, T>;
    abstract readonly itemSuffix: string | undefined;
    abstract readonly itemName: string;

    constructor(client: Vimcord) {
        this.client = client;
    }

    async importFrom(dir: string | string[], set = false, suffix?: string | string[] | null): Promise<Map<string, T>> {
        if (set) this.items.clear();

        const dirs = Array.isArray(dir) ? dir : [dir];
        const modules: T[] = [];
        const effectiveSuffix = Array.isArray(suffix) ? suffix[0] : (suffix ?? this.itemSuffix);

        for (const _dir of dirs) {
            const results = await importModulesFromDir<{ default: T }>(_dir, effectiveSuffix ?? undefined);
            modules.push(...results.map(({ module }) => module.default));
        }

        for (const module of modules) {
            const name = this.getName(module);
            this.items.set(name, module);
        }

        this.client.logger.moduleLoaded(this.itemName, modules.length);
        return this.items;
    }

    protected abstract getName(module: T): string;
}
