import type { IndexFn } from "@vimcord/internal";
import type { Vimcord } from "@/client/Vimcord.js";

import { importModulesFromDir } from "@vimcord/internal";

export type ModuleIndex<T> =
    | {
          key: IndexFn<T>;
          map: Map<string, T>;
          isArray?: false;
      }
    | {
          key: IndexFn<T>;
          map: Map<string, T[]>;
          isArray: true;
      };

export interface ImportableModule {
    inject(client: Vimcord): void;
}

export abstract class AbstractModuleImporter<T extends ImportableModule, K extends string = string> {
    abstract readonly DEFAULT_SUFFIX: string | undefined;

    readonly modules: Map<string, T> = new Map();
    readonly indexes: Map<K, ModuleIndex<T>> = new Map();

    constructor(readonly client: Vimcord) {}

    protected abstract createModuleKey(module: T): string;

    abstract clear(): void;

    abstract get(id: string): T | undefined;
    abstract getAll(): T[];

    protected getIndex(index: K, key: string, isArray?: false): T;
    protected getIndex(index: K, key: string, isArray: true): T[];
    protected getIndex(index: K, key: string, isArray?: boolean): T | T[] {
        const idx = this.indexes.get(index);
        if (!idx) {
            throw new Error(`Module index '${index}' does not exist; make sure it's implemented`);
        }
        if (isArray && !idx?.isArray) {
            throw new Error(`Module index '${index}' is not an array; use getByIndex(index, key, false)`);
        }
        if (!isArray && idx?.isArray) {
            throw new Error(`Module index '${index}' is an array; use getByIndex(index, key, true)`);
        }
        return isArray ? ((idx?.map.get(key) ?? []) as T[]) : (idx?.map.get(key) as T);
    }

    protected reindex(): void {
        const modules = Array.from(this.modules.values());

        for (const idx of this.indexes.values()) {
            idx.map.clear();

            for (const mod of modules) {
                const rawKey = idx.key(mod);
                if (!rawKey) continue;

                const keys = Array.isArray(rawKey) ? rawKey : [rawKey];

                for (const key of keys) {
                    if (idx.isArray) {
                        const map = idx.map as Map<string, T[]>;
                        const existing = map.get(key) ?? [];
                        existing.push(mod);
                        map.set(key, existing);
                    } else {
                        idx.map.set(key, mod);
                    }
                }
            }
        }
    }

    async importFrom(dir: string | string[], suffix: string | string[], set = false): Promise<Map<string, T>> {
        if (set) this.modules.clear();

        const dirs = Array.isArray(dir) ? dir : [dir];

        for (const _dir of dirs) {
            const results = await importModulesFromDir<{ default: T }>(_dir, suffix);

            for (const result of results) {
                const module = result.module.default;
                const key = this.createModuleKey(module);
                if (this.modules.has(key)) {
                    throw new Error(`Duplicate module key '${key}' imported from '${result.path}'`);
                }

                module.inject(this.client);
                this.modules.set(key, module);
            }

            this.client.logger.debugVerbose(
                `[ModuleImporter] Imported ${results.length} ${results.length === 1 ? "module" : "modules"} from '${_dir}'`
            );
        }

        this.reindex();
        return this.modules;
    }
}
