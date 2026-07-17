/** Returns a value as an array without copying existing arrays. */
export function forceArray<T>(value: T | T[]): T[] {
    return Array.isArray(value) ? value : [value];
}
