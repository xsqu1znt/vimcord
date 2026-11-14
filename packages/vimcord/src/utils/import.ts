import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ModuleError } from "@/errors/ModuleError.js";

/** A dynamically imported module and its source path. */
export interface ImportedModule<T> {
    module: T;
    path: string;
}

/** Returns the directory containing the process entrypoint. */
export function getProcessDir(): string {
    const mainPath = process.argv[1];
    if (!mainPath) return "";
    return path.dirname(mainPath);
}

/** Checks whether a filename is a TypeScript or JavaScript module matching a suffix. `null` matches every module. */
export function isTSOrJS(filename: string, suffix: string | string[] | null = null): boolean {
    // Declaration files sit next to compiled modules but have nothing to import.
    if (filename.endsWith(".d.ts")) return false;
    if (suffix === null) return filename.endsWith(".ts") || filename.endsWith(".js");
    const suffixes = typeof suffix === "string" ? [suffix] : suffix;
    return suffixes.some(s => filename.endsWith(`${s}.ts`) || filename.endsWith(`${s}.js`));
}

function walkFiles(dir: string, base = ""): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const relativePath = base ? path.join(base, entry.name) : entry.name;
        if (entry.isDirectory()) return walkFiles(path.join(dir, entry.name), relativePath);
        return entry.isFile() ? [relativePath] : [];
    });
}

/**
 * Recursively imports matching modules from a directory relative to the entry file. Throws naming the directory when it is missing or has no matches, and naming every file that fails to import.
 * @param dir Directory to search
 * @param suffix Filename suffixes to import; `null` imports every module
 * @param allowEmpty Returns nothing instead of throwing when no file matches
 */
export async function importModulesFromDir<T>(
    dir: string,
    suffix: string | string[] | null,
    allowEmpty = false
): Promise<ImportedModule<T>[]> {
    const root = path.resolve(getProcessDir(), dir);
    if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
        throw new ModuleError(`Module directory '${dir}' does not exist (resolved to '${root}')`);
    }

    const files = walkFiles(root).filter(filename => isTSOrJS(filename, suffix));
    if (!files.length) {
        if (allowEmpty) return [];
        throw new ModuleError(`Module directory '${dir}' has no modules matching suffix ${JSON.stringify(suffix)}`);
    }

    const results = await Promise.allSettled(
        files.map(async filename => {
            const moduleUrl = pathToFileURL(path.join(root, filename));
            moduleUrl.searchParams.set("updated", Date.now().toString());
            return { module: (await import(moduleUrl.href)) as T, path: `./${path.join(dir, filename)}` };
        })
    );

    const failures = results.flatMap((result, i) =>
        result.status === "rejected" ? [{ i, error: result.reason as unknown }] : []
    );
    if (failures.length) {
        const details = failures.map(({ i, error }) => {
            const message = error instanceof Error ? error.message : String(error);
            return `'./${path.join(dir, files[i]!)}': ${message}`;
        });
        throw new ModuleError(`Failed to import ${details.join("\n")}`, { cause: failures[0]!.error });
    }

    return results.map(result => (result as PromiseFulfilledResult<ImportedModule<T>>).value);
}
