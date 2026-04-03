/** Ensures a value is always returned as an array */
export function forceArray<T>(value: T | T[]): T[] {
    return Array.isArray(value) ? value : [value];
}
