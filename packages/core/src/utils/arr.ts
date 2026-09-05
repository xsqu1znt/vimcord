/** Returns a value as an array without copying existing arrays. */
export function forceArray<T>(value: T | T[]): T[] {
    return Array.isArray(value) ? value : [value];
}

/**
 * Runs `task` over `items` with at most `limit` running at once.
 * @param items The items to process
 * @param limit Maximum number of tasks in flight
 * @param task Called once per item
 */
export async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    task: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let cursor = 0;

    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor++;
            results[index] = await task(items[index]!, index);
        }
    });

    await Promise.all(workers);
    return results;
}
