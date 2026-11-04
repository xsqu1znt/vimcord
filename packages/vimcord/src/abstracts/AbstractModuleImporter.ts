import type { Vimcord } from "@/client/Vimcord.js";
import type { IndexFn } from "@/types/helpers.js";

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
    readonly modules: Map<string, T> = new Map();
    readonly indexes: Map<K, ModuleIndex<T>> = new Map();

    constructor(readonly client: Vimcord) {}

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
}
