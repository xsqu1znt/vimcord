import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Reads the `package.json` file from the current working directory. */
export function getPackageJson(): Record<string, unknown> {
    return JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8")) as Record<string, unknown>;
}

/** Checks if the process was ran using the `--dev` flag. */
export function getDevMode(): boolean {
    return process.argv.includes("--dev");
}
