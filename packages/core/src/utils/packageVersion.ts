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

function getCorePackageVersion(): string {
    try {
        const packageEntry = PACKAGE_REQUIRE.resolve("@vimcord/core");
        const version = findPackageVersion(packageEntry, "@vimcord/core");
        if (version) return version;
    } catch {
        // Core may be executing directly from this monorepo instead of an installed package.
    }

    return findWorkspacePackageVersion("@vimcord/core", "packages/core") ?? "unknown";
}

/** Resolves the installed Vimcord wrapper version, including monorepo development environments. */
export function getVimcordPackageVersion(): string {
    try {
        const packageEntry = PACKAGE_REQUIRE.resolve("vimcord");
        const version = findPackageVersion(packageEntry, "vimcord");
        if (version) return version;
    } catch {
        // Consumers may install core directly without the wrapper package.
    }

    return findWorkspacePackageVersion("vimcord", "packages/vimcord") ?? getCorePackageVersion();
}
