import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const PACKAGE_REQUIRE = createRequire(join(process.cwd(), "package.json"));

function readPackageVersion(packagePath: string, packageName: string): string | null {
    try {
        const data = JSON.parse(readFileSync(packagePath, "utf8")) as { name?: unknown; version?: unknown };
        return data.name === packageName && typeof data.version === "string" ? data.version : null;
    } catch {
        return null;
    }
}

function findPackageVersion(startPath: string, packageName: string): string | null {
    const currentDir = dirname(startPath);
    const parentDir = dirname(currentDir);
    const version = readPackageVersion(join(currentDir, "package.json"), packageName);

    if (version) return version;
    if (currentDir === parentDir) return null;
    return findPackageVersion(currentDir, packageName);
}

function findWorkspacePackageVersion(packageName: string, packagePath: string, currentDir = process.cwd()): string | null {
    const version = readPackageVersion(join(currentDir, packagePath, "package.json"), packageName);
    const parentDir = dirname(currentDir);

    if (version) return version;
    if (currentDir === parentDir) return null;
    return findWorkspacePackageVersion(packageName, packagePath, parentDir);
}

/**
 * Resolves the installed version of a package, including monorepo development environments.
 *
 * The package is resolved from the consuming app first. When that fails, which happens while working inside this
 * monorepo, the workspace path is walked upwards from the current directory instead.
 *
 * @param packageName The package name to read the version from
 * @param workspacePath The path to the package inside this monorepo, relative to the workspace root
 */
export function getPackageVersion(packageName: string, workspacePath: string): string | null {
    try {
        const packageEntry = PACKAGE_REQUIRE.resolve(packageName);
        const version = findPackageVersion(packageEntry, packageName);
        if (version) return version;
    } catch {
        // The package may be executing directly from this monorepo instead of an installed package.
    }

    return findWorkspacePackageVersion(packageName, workspacePath);
}

/** Resolves the installed Vimcord wrapper version, including monorepo development environments. */
export function getVimcordPackageVersion(): string {
    return (
        getPackageVersion("vimcord", "packages/vimcord") ?? getPackageVersion("@vimcord/core", "packages/core") ?? "unknown"
    );
}
