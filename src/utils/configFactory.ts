import { PartialDeep } from "./typesUtils";
import { deepMerge } from "./mergeUtils";

export function createConfigFactory<T extends object>(defaultConfig: T, validate?: (config: T) => void) {
    return (options: PartialDeep<T> = {} as PartialDeep<T>, existing?: T): T => {
        const base = existing ? { ...existing } : { ...defaultConfig };
        const result = deepMerge(base, options as object) as T;
        validate?.(result);
        return result;
    };
}
