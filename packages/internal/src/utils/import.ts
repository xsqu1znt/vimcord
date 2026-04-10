import path from "node:path";
import { $ } from "qznt";

interface ImportedModule<T> {
    module: T;
    path: string;
}

export function getProcessDir(): string {
    const mainPath = process.argv[1];
    if (!mainPath) return "";
    return path.dirname(mainPath);
}

export function isTSOrJS(filename: string, suffix?: string | string[]): boolean {
    if (!suffix) return filename.endsWith(".ts") || filename.endsWith(".js");
    if (Array.isArray(suffix)) {
        return suffix.some(s => filename.endsWith(`${s}.ts`) || filename.endsWith(`${s}.js`));
    } else {
        return filename.endsWith(`${suffix}.ts`) || filename.endsWith(`${suffix}.js`);
    }
}

export async function importModulesFromDir<T>(dir: string, suffix?: string | string[]): Promise<ImportedModule<T>[]> {
    const cwd = getProcessDir();
    const MODULE_RELATIVE_PATH = path.join(cwd, dir);
    const MODULE_LOG_PATH = dir;

    // Search the directory for event modules
    const files = $.fs.readDir(MODULE_RELATIVE_PATH).filter(filename => isTSOrJS(filename, suffix));
    if (!files.length) return [];

    // Import the modules found in the given directory
    const modules = await Promise.all(
        files.map(async fn => {
            const modulePath = path.join(MODULE_RELATIVE_PATH, fn);
            const logPath = `./${path.join(MODULE_LOG_PATH, fn)}`;

            let importedModule;
            try {
                delete require.cache[require.resolve(modulePath)];
                importedModule = require(modulePath);
            } catch (err) {
                // Log the warning to the console
                console.warn(`Failed to import module at '${logPath}'`, err);
                importedModule = null;
            }

            return { module: importedModule, path: logPath };
        })
    );

    // Filter out modules that failed to import and return
    const filteredModules: ImportedModule<T>[] = modules.filter(m => m.module);
    if (!filteredModules.length) {
        console.warn(`No valid modules were found in directory '${dir}'`);
    }

    // Return the filtered modules
    return filteredModules;
}
