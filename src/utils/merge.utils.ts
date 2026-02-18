/**
 * Deep merge utility - recursively merges objects
 * Replaces lodash's _.merge
 */

/** Check if value is a plain object */
function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null) return false;
    if (Array.isArray(value)) return false;
    return Object.prototype.toString.call(value) === "[object Object]";
}

/** Deep merge objects - mutates target and returns it */
export function deepMerge<T extends object>(target: T, ...sources: Array<object | undefined>): T {
    for (const source of sources) {
        if (!source) continue;

        for (const key in source) {
            if (!Object.prototype.hasOwnProperty.call(source, key)) continue;

            const sourceValue = (source as Record<string, unknown>)[key];
            const targetValue = (target as Record<string, unknown>)[key];

            if (isPlainObject(sourceValue) && isPlainObject(targetValue)) {
                deepMerge(targetValue, sourceValue);
            } else if (sourceValue !== undefined) {
                (target as Record<string, unknown>)[key] = sourceValue;
            }
        }
    }

    return target;
}
