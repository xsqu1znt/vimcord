/**
 * Recognizes MongoDB duplicate-key errors, including plain objects from bulk writes or wrappers.
 * A path matches any field in keyPattern, including compound indexes; absent keyPattern cannot match a path.
 * @param error Error to inspect
 * @param path Optional indexed field
 */
export function isDuplicateKeyError(error: unknown, path?: string): boolean {
    if (error === null || typeof error !== "object") return false;
    if (!("code" in error && error.code === 11000) && !("codeName" in error && error.codeName === "DuplicateKey")) {
        return false;
    }
    if (path === undefined) return true;
    if (!("keyPattern" in error) || error.keyPattern === null || typeof error.keyPattern !== "object") return false;
    return Object.hasOwn(error.keyPattern, path);
}
