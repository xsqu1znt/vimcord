import type { IndexFn } from "@vimcord/internal";
import type { Vimcord } from "../Vimcord.js";

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

export abstract class AbstractModuleImporter<T, K extends string = string> {
    readonly modules: Map<string, T> = new Map();
    readonly indexes: Map<K, ModuleIndex<T>> = new Map();
    abstract readonly fileSuffix: string | string[] | undefined;

    constructor(readonly client: Vimcord) {
        this.client = client;
    }

    protected abstract createModuleKey(module: T): string;

    abstract clear(): void;

    abstract get(id: string): T | undefined;

    protected getIndexed(index: K, key: string, isArray?: false): T;
    protected getIndexed(index: K, key: string, isArray: true): T[];
    protected getIndexed(index: K, key: string, isArray?: boolean): T | T[] {
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

    async importFrom(dir: string | string[], set = false): Promise<Map<string, T>> {
        if (set) this.modules.clear();

        const dirs = Array.isArray(dir) ? dir : [dir];
        const modules: T[] = [];

        for (const _dir of dirs) {
            const results = await importModulesFromDir<{ default: T }>(_dir, this.fileSuffix);
            modules.push(...results.map(({ module }) => module.default));
        }

        for (const module of modules) {
            this.modules.set(this.createModuleKey(module), module);
        }

        this.reindex();
        return this.modules;
    }
}
