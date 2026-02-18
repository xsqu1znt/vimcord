import path from "node:path";
import { $ } from "qznt";

export function getProcessDir() {
    const mainPath = process.argv[1];
    if (!mainPath) return "";
    return path.dirname(mainPath);
}

export async function importModulesFromDir<T extends any>(dir: string, suffix?: string) {
    const cwd = getProcessDir();
    const MODULE_RELATIVE_PATH = path.join(cwd, dir);
    const MODULE_LOG_PATH = dir;

    /* Search the directory for event modules */
    const files = $.fs
        .readDir(MODULE_RELATIVE_PATH)
        .filter(fn => fn.endsWith(`${suffix ? `${suffix}` : ""}.js`) || fn.endsWith(`${suffix ? `${suffix}` : ""}.ts`));

    if (!files.length) {
        return [];
    }

    // Import the modules found in the given directory
    const modules = await Promise.all(
        files.map(async fn => {
            let _path = path.join(MODULE_RELATIVE_PATH, fn);
            let _logPath = `./${path.join(MODULE_LOG_PATH, fn)}`;

            let _module;
            try {
                delete require.cache[require.resolve(_path)];
                _module = require(_path);
            } catch (err: any) {
                // Log the warning to the console
                console.warn(`Failed to import module at '${_logPath}'`, err);
                _module = null;
            }

            return { module: _module, path: _logPath };
        })
    );

    /* Filter out modules that failed to import and return */
    const filteredModules = modules.filter(m => m.module) as { module: T; path: string }[];

    if (!filteredModules.length) {
        console.warn(`No valid modules were found in directory '${dir}'`);
    }

    // Return the filtered modules
    return filteredModules;
}
