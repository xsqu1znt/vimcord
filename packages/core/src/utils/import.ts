import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

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

/** Checks whether a filename is a TypeScript or JavaScript module with an optional suffix. */
export function isTSOrJS(filename: string, suffix?: string | string[]): boolean {
    if (!suffix) return filename.endsWith(".ts") || filename.endsWith(".js");
    if (Array.isArray(suffix)) {
        return suffix.some(s => filename.endsWith(`${s}.ts`) || filename.endsWith(`${s}.js`));
    } else {
        return filename.endsWith(`${suffix}.ts`) || filename.endsWith(`${suffix}.js`);
    }
}

/** Recursively imports matching TypeScript or JavaScript modules from a process-relative directory. */
export async function importModulesFromDir<T>(dir: string, suffix?: string | string[]): Promise<ImportedModule<T>[]> {
    const cwd = getProcessDir();
    const MODULE_RELATIVE_PATH = path.join(cwd, dir);
    const MODULE_LOG_PATH = dir;

    // Search the directory for event modules
    const files = (() => {
        if (!existsSync(MODULE_RELATIVE_PATH)) return [];

        const walk = (targetDir: string, base = ""): string[] => {
            return readdirSync(targetDir, { withFileTypes: true }).flatMap(entry => {
                const relativePath = base ? path.join(base, entry.name) : entry.name;
                const fullPath = path.join(targetDir, entry.name);

                if (entry.isDirectory()) return walk(fullPath, relativePath);
                if (entry.isFile()) return [relativePath];

                return [];
            });
        };

        return walk(MODULE_RELATIVE_PATH);
    })().filter(filename => isTSOrJS(filename, suffix));
    if (!files.length) return [];

    // Import the modules found in the given directory
    const modules = await Promise.all(
        files.map(async fn => {
            const modulePath = path.join(MODULE_RELATIVE_PATH, fn);
            const logPath = `./${path.join(MODULE_LOG_PATH, fn)}`;

            try {
                const moduleUrl = pathToFileURL(modulePath);
                moduleUrl.searchParams.set("updated", Date.now().toString());
                const importedModule = (await import(moduleUrl.href)) as T;

                return { module: importedModule, path: logPath };
            } catch (err) {
                // Log the warning to the console
                console.warn(`Failed to import module at '${logPath}'`, err);
                return null;
            }
        })
    );

    // Filter out modules that failed to import and return
    const filteredModules = modules.filter((m): m is ImportedModule<T> => Boolean(m));
    if (!filteredModules.length) {
        console.warn(`No valid modules were found in directory '${dir}'`);
    }

    // Return the filtered modules
    return filteredModules;
}
