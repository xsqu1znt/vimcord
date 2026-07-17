import type { Interface as ReadlineInterface } from "node:readline/promises";

import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

interface PackageManifest extends Record<string, unknown> {
    name: string;
    version: string;
    private?: boolean;
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
}

/** Publishable package discovered from the active PNPM workspace. */
export interface WorkspacePackage {
    /** Package name used by PNPM and the registry. */
    name: string;
    /** Stable version currently stored in the package manifest. */
    version: string;
    /** Absolute path to the package directory. */
    path: string;
    /** Absolute path to the package manifest. */
    manifestPath: string;
    /** Parsed package manifest used to prepare its release version. */
    manifest: PackageManifest;
    /** Original manifest text retained for safe pre-commit restoration. */
    originalManifest: string;
    /** Names of dependencies that belong to the same workspace. */
    workspaceDependencies: readonly string[];
}

/** One selected package and the unused stable version it will publish. */
export interface ReleasePlanEntry {
    /** Selected workspace package. */
    package: WorkspacePackage;
    /** Stable version confirmed to be unused in the package registry. */
    nextVersion: string;
}

interface CommandResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

interface StableVersion {
    major: number;
    minor: number;
    patch: number;
}

const PNPM_COMMAND = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const GIT_COMMAND = process.platform === "win32" ? "git.exe" : "git";

interface GitReleaseContext {
    branch: string;
    remoteName: string;
    remoteBranch: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseStableVersion(version: string): StableVersion | null {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
    if (!match) return null;

    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3])
    };
}

function compareVersions(left: StableVersion, right: StableVersion): number {
    return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

/** Returns the patch version immediately after the highest local or published stable version. */
export function getNextAvailableVersion(localVersion: string, publishedVersions: readonly string[]): string {
    const local = parseStableVersion(localVersion);
    if (!local) throw new Error(`Local version '${localVersion}' is not a stable major.minor.patch version`);

    const highest = publishedVersions.reduce<StableVersion>((current, version) => {
        const parsed = parseStableVersion(version);
        return parsed && compareVersions(parsed, current) > 0 ? parsed : current;
    }, local);
    const published = new Set(publishedVersions);
    let patch = highest.patch + 1;
    let candidate = `${highest.major}.${highest.minor}.${patch}`;

    // Registry gaps are allowed, but never return a version that already exists.
    while (published.has(candidate)) {
        patch++;
        candidate = `${highest.major}.${highest.minor}.${patch}`;
    }
    return candidate;
}

/** Normalizes the JSON shape returned by `pnpm view`, including its successful 404 response. */
export function parsePublishedVersionsResponse(packageName: string, response: unknown): string[] {
    if (typeof response === "string") return [response];
    if (Array.isArray(response)) return response.filter((version): version is string => typeof version === "string");

    // PNPM currently returns registry 404 details as JSON with a successful process exit code.
    if (isRecord(response) && isRecord(response.error) && /404/.test(String(response.error.code))) return [];
    throw new Error(`Registry returned invalid version data for '${packageName}'`);
}

/** Parses comma-separated package numbers, inclusive ranges, or `all`. */
export function parsePackageSelection(input: string, packageCount: number): number[] {
    const value = input.trim().toLowerCase();
    if (!value) return [];
    if (value === "all") return Array.from({ length: packageCount }, (_, index) => index);

    const selected = new Set<number>();
    for (const part of value.split(",").map(token => token.trim())) {
        const range = /^(\d+)-(\d+)$/.exec(part);
        const rangeStart = range ? Number(range[1]) : 0;
        const rangeEnd = range ? Number(range[2]) : 0;
        const indexes =
            range && rangeStart <= rangeEnd
                ? Array.from({ length: rangeEnd - rangeStart + 1 }, (_, offset) => rangeStart + offset)
                : /^\d+$/.test(part)
                  ? [Number(part)]
                  : [];

        if (!indexes.length || indexes.some(index => index < 1 || index > packageCount)) {
            throw new Error(`Invalid package selection '${part}'`);
        }
        for (const index of indexes) selected.add(index - 1);
    }

    return Array.from(selected).sort((left, right) => left - right);
}

/** Orders selected packages so workspace dependencies publish before their dependents. */
export function sortPackagesForPublish(packages: readonly WorkspacePackage[]): WorkspacePackage[] {
    const selected = new Map(packages.map(pkg => [pkg.name, pkg]));
    const states = new Map<string, "visiting" | "visited">();
    const ordered: WorkspacePackage[] = [];

    const visit = (pkg: WorkspacePackage): void => {
        const state = states.get(pkg.name);
        if (state === "visited") return;
        if (state === "visiting") throw new Error(`Circular workspace dependency detected at '${pkg.name}'`);

        states.set(pkg.name, "visiting");
        for (const dependencyName of pkg.workspaceDependencies) {
            const dependency = selected.get(dependencyName);
            if (dependency) visit(dependency);
        }
        states.set(pkg.name, "visited");
        ordered.push(pkg);
    };

    for (const pkg of packages) visit(pkg);
    return ordered;
}

async function runCaptured(command: string, args: readonly string[], cwd: string): Promise<CommandResult> {
    return await new Promise((resolveCommand, reject) => {
        const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";

        child.stdout.on("data", chunk => (stdout += String(chunk)));
        child.stderr.on("data", chunk => (stderr += String(chunk)));
        child.on("error", reject);
        child.on("close", exitCode => resolveCommand({ exitCode: exitCode ?? 1, stdout, stderr }));
    });
}

async function runInherited(command: string, args: readonly string[], cwd: string): Promise<void> {
    await new Promise<void>((resolveCommand, reject) => {
        const child = spawn(command, args, { cwd, stdio: "inherit" });
        child.on("error", reject);
        child.on("close", exitCode => {
            if (exitCode === 0) resolveCommand();
            else reject(new Error(`${command} ${args.join(" ")} failed with exit code ${exitCode ?? 1}`));
        });
    });
}

function readDependencyNames(manifest: PackageManifest, workspaceNames: ReadonlySet<string>): string[] {
    const dependencies = {
        ...manifest.dependencies,
        ...manifest.optionalDependencies,
        ...manifest.peerDependencies
    };
    return Object.keys(dependencies).filter(name => workspaceNames.has(name));
}

async function discoverWorkspacePackages(rootDir: string): Promise<WorkspacePackage[]> {
    const result = await runCaptured(PNPM_COMMAND, ["list", "--recursive", "--depth", "-1", "--json"], rootDir);
    if (result.exitCode !== 0) throw new Error("Unable to discover PNPM workspace packages");

    const data: unknown = JSON.parse(result.stdout);
    if (!Array.isArray(data)) throw new Error("PNPM returned an invalid workspace package list");

    const entries = data.filter(isRecord);
    const names = new Set(entries.map(entry => entry.name).filter((name): name is string => typeof name === "string"));
    const packages: WorkspacePackage[] = [];

    for (const entry of entries) {
        if (typeof entry.path !== "string") continue;
        const packagePath = resolve(entry.path);
        const relativePath = relative(rootDir, packagePath);
        if (relativePath.startsWith("..") || resolve(rootDir, relativePath) !== packagePath) {
            throw new Error(`Workspace package path '${packagePath}' is outside the repository`);
        }

        const manifestPath = resolve(packagePath, "package.json");
        const originalManifest = await readFile(manifestPath, "utf8");
        const parsed: unknown = JSON.parse(originalManifest);
        if (!isRecord(parsed) || typeof parsed.name !== "string" || typeof parsed.version !== "string") continue;

        const manifest = parsed as PackageManifest;
        if (manifest.private === true) continue;
        packages.push({
            name: manifest.name,
            version: manifest.version,
            path: packagePath,
            manifestPath,
            manifest,
            originalManifest,
            workspaceDependencies: readDependencyNames(manifest, names)
        });
    }

    return packages.sort((left, right) => left.name.localeCompare(right.name));
}

async function getPublishedVersions(packageName: string, rootDir: string): Promise<string[]> {
    const result = await runCaptured(PNPM_COMMAND, ["view", packageName, "versions", "--json"], rootDir);
    if (result.exitCode !== 0) {
        const output = `${result.stdout}\n${result.stderr}`;
        if (/E404|404|not found|is not in this registry/i.test(output)) return [];
        throw new Error(`Unable to read published versions for '${packageName}'`);
    }

    const data: unknown = JSON.parse(result.stdout || "[]");
    return parsePublishedVersionsResponse(packageName, data);
}

async function assertRegistryAuthentication(rootDir: string): Promise<void> {
    const result = await runCaptured(PNPM_COMMAND, ["whoami"], rootDir);
    if (result.exitCode !== 0) throw new Error("Registry authentication failed; run 'pnpm login' before publishing");
    console.log(`\nRegistry user: ${result.stdout.trim()}`);
}

async function assertGitClean(rootDir: string): Promise<void> {
    const result = await runCaptured(GIT_COMMAND, ["status", "--porcelain=v1", "--untracked-files=all"], rootDir);
    if (result.exitCode !== 0) throw new Error("Unable to inspect the Git workspace");
    if (result.stdout.trim()) {
        throw new Error("The Git workspace must be clean before publishing; commit or stash the current changes first");
    }
}

async function prepareGitRelease(rootDir: string): Promise<GitReleaseContext> {
    await assertGitClean(rootDir);

    const branchResult = await runCaptured(GIT_COMMAND, ["branch", "--show-current"], rootDir);
    const branch = branchResult.stdout.trim();
    if (branchResult.exitCode !== 0 || !branch) throw new Error("Publishing from a detached Git HEAD is not supported");

    const upstreamResult = await runCaptured(
        GIT_COMMAND,
        ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
        rootDir
    );
    const upstream = upstreamResult.stdout.trim();
    const separator = upstream.indexOf("/");
    if (upstreamResult.exitCode !== 0 || separator < 1 || separator === upstream.length - 1) {
        throw new Error(`Git branch '${branch}' needs an upstream GitHub branch before publishing`);
    }

    const remoteName = upstream.slice(0, separator);
    const remoteBranch = upstream.slice(separator + 1);
    const remoteResult = await runCaptured(GIT_COMMAND, ["remote", "get-url", "--push", remoteName], rootDir);
    if (remoteResult.exitCode !== 0 || !/github\.com(?::|\/)/i.test(remoteResult.stdout.trim())) {
        throw new Error(`Git upstream remote '${remoteName}' is not a GitHub remote`);
    }

    console.log(`\nChecking ${upstream} for remote changes...`);
    await runInherited(GIT_COMMAND, ["fetch", "--quiet", remoteName, remoteBranch], rootDir);
    const divergenceResult = await runCaptured(
        GIT_COMMAND,
        ["rev-list", "--left-right", "--count", `${upstream}...HEAD`],
        rootDir
    );
    const [behindText] = divergenceResult.stdout.trim().split(/\s+/);
    const behind = Number(behindText);
    if (divergenceResult.exitCode !== 0 || !Number.isInteger(behind)) {
        throw new Error(`Unable to compare the current branch with '${upstream}'`);
    }
    if (behind > 0) {
        throw new Error(`Git branch '${branch}' is behind '${upstream}'; update it before publishing`);
    }

    return { branch, remoteName, remoteBranch };
}

function printPackageChoices(packages: readonly WorkspacePackage[]): void {
    console.log("Publishable workspace packages:\n");
    const nameWidth = Math.max(...packages.map(pkg => pkg.name.length));
    packages.forEach((pkg, index) => {
        console.log(`  ${String(index + 1).padStart(2)}. ${pkg.name.padEnd(nameWidth)}  ${pkg.version}`);
    });
}

function printReleasePlan(plan: readonly ReleasePlanEntry[], dryRun: boolean): void {
    console.log(`\n${dryRun ? "Dry-run release plan" : "Release plan"}:\n`);
    const nameWidth = Math.max(...plan.map(entry => entry.package.name.length));
    for (const entry of plan) {
        console.log(`  ${entry.package.name.padEnd(nameWidth)}  ${entry.package.version} -> ${entry.nextVersion}`);
    }
}

async function validateUnselectedDependencies(
    selected: readonly WorkspacePackage[],
    allPackages: readonly WorkspacePackage[],
    getVersions: (packageName: string) => Promise<readonly string[]>
): Promise<void> {
    const selectedNames = new Set(selected.map(pkg => pkg.name));
    const workspace = new Map(allPackages.map(pkg => [pkg.name, pkg]));

    for (const pkg of selected) {
        for (const dependencyName of pkg.workspaceDependencies) {
            if (selectedNames.has(dependencyName)) continue;
            const dependency = workspace.get(dependencyName);
            if (!dependency) continue;

            const publishedVersions = await getVersions(dependencyName);
            if (!publishedVersions.includes(dependency.version)) {
                throw new Error(
                    `'${pkg.name}' depends on unpublished local version ${dependencyName}@${dependency.version}; select '${dependencyName}' too`
                );
            }
        }
    }
}

async function writeReleaseVersions(plan: readonly ReleasePlanEntry[]): Promise<void> {
    const written: ReleasePlanEntry[] = [];
    try {
        for (const entry of plan) {
            const manifest = { ...entry.package.manifest, version: entry.nextVersion };
            await writeFile(entry.package.manifestPath, `${JSON.stringify(manifest, null, 4)}\n`);
            written.push(entry);
        }
    } catch (error) {
        await Promise.all(written.map(entry => writeFile(entry.package.manifestPath, entry.package.originalManifest)));
        throw error;
    }
}

async function commitReleasePlan(plan: readonly ReleasePlanEntry[], rootDir: string): Promise<void> {
    const manifestPaths = plan.map(entry => relative(rootDir, entry.package.manifestPath));
    const headResult = await runCaptured(GIT_COMMAND, ["rev-parse", "HEAD"], rootDir);
    if (headResult.exitCode !== 0) throw new Error("Unable to read the current Git commit");

    await writeReleaseVersions(plan);
    try {
        await runInherited(GIT_COMMAND, ["add", "--", ...manifestPaths], rootDir);
        const releases = plan.map(entry => `${entry.package.name}@${entry.nextVersion}`).join(", ");
        await runInherited(GIT_COMMAND, ["commit", "-m", `chore(release): ${releases}`], rootDir);
    } catch (error) {
        const currentHead = await runCaptured(GIT_COMMAND, ["rev-parse", "HEAD"], rootDir);
        if (currentHead.stdout.trim() === headResult.stdout.trim()) {
            // Restore only this script's manifest edits when no release commit was created.
            await Promise.all(plan.map(entry => writeFile(entry.package.manifestPath, entry.package.originalManifest)));
            await runInherited(GIT_COMMAND, ["add", "--", ...manifestPaths], rootDir);
        }
        throw error;
    }
}

async function publishReleasePlan(
    plan: readonly ReleasePlanEntry[],
    rootDir: string,
    branch: string,
    getVersions: (packageName: string, refresh?: boolean) => Promise<readonly string[]>
): Promise<void> {
    const publishedNames = new Set<string>();

    for (const entry of plan) {
        console.log(`\nPublishing ${entry.package.name}@${entry.nextVersion}...`);
        try {
            await runInherited(
                PNPM_COMMAND,
                ["--filter", entry.package.name, "publish", "--access", "public", "--publish-branch", branch],
                rootDir
            );
            publishedNames.add(entry.package.name);
        } catch (error) {
            // A registry can accept a publish before a later lifecycle step fails, so verify the final state.
            const publishedVersions = await getVersions(entry.package.name, true).catch<readonly string[]>(() => []);
            if (publishedVersions.includes(entry.nextVersion)) publishedNames.add(entry.package.name);

            const completed = plan.filter(item => publishedNames.has(item.package.name));
            if (completed.length) {
                console.error(
                    `\nPublished before failure: ${completed.map(item => `${item.package.name}@${item.nextVersion}`).join(", ")}`
                );
            }
            console.error("The pushed release commit was retained; package versions were not rolled back.");
            throw error;
        }
    }
}

function printUsage(): void {
    console.log(
        `Usage: pnpm publish:workspace [--dry-run]\n\nOptions:\n  --dry-run  Resolve and display versions without modifying or publishing packages\n  --help     Show this help`
    );
}

async function askForSelection(readline: ReadlineInterface, packages: readonly WorkspacePackage[]): Promise<number[]> {
    printPackageChoices(packages);
    const answer = await readline.question("\nSelect packages (for example 1,3-5 or all): ");
    return parsePackageSelection(answer, packages.length);
}

/** Runs the interactive workspace publisher. */
export async function main(args: readonly string[] = process.argv.slice(2)): Promise<void> {
    const allowedArgs = new Set<string>(["--dry-run", "--help", "-h"]);
    const unknownArgs = args.filter(arg => !allowedArgs.has(arg));
    if (unknownArgs.length)
        throw new Error(`Unknown option${unknownArgs.length === 1 ? "" : "s"}: ${unknownArgs.join(", ")}`);
    if (args.includes("--help") || args.includes("-h")) {
        printUsage();
        return;
    }

    const rootDir = process.cwd();
    const dryRun = args.includes("--dry-run");
    const packages = await discoverWorkspacePackages(rootDir);
    if (!packages.length) throw new Error("No publishable packages were found in the current PNPM workspace");

    const readline = createInterface({ input: process.stdin, output: process.stdout });
    let selected: WorkspacePackage[] = [];
    try {
        const indexes = await askForSelection(readline, packages);
        if (!indexes.length) {
            console.log("\nNo packages selected; nothing to publish.");
            return;
        }
        selected = indexes.map(index => packages[index]!);

        const git = dryRun ? null : await prepareGitRelease(rootDir);
        if (!dryRun) await assertRegistryAuthentication(rootDir);

        const versionCache = new Map<string, Promise<readonly string[]>>();
        const getVersions = (packageName: string, refresh = false): Promise<readonly string[]> => {
            if (refresh) versionCache.delete(packageName);
            const existing = versionCache.get(packageName);
            if (existing) return existing;

            const request = getPublishedVersions(packageName, rootDir);
            versionCache.set(packageName, request);
            return request;
        };

        await validateUnselectedDependencies(selected, packages, getVersions);
        const unorderedPlan = await Promise.all(
            selected.map(async pkg => ({
                package: pkg,
                nextVersion: getNextAvailableVersion(pkg.version, await getVersions(pkg.name))
            }))
        );
        const order = sortPackagesForPublish(selected);
        const planByName = new Map(unorderedPlan.map(entry => [entry.package.name, entry]));
        const plan = order.map(pkg => planByName.get(pkg.name)!);
        printReleasePlan(plan, dryRun);

        if (dryRun) {
            console.log("\nDry run complete; no files were changed and nothing was published.");
            return;
        }

        const confirmation = await readline.question("\nPublish this release plan? (y/N): ");
        if (!/^(y|yes)$/i.test(confirmation.trim())) {
            console.log("\nPublish cancelled; no files were changed.");
            return;
        }
        readline.close();

        // Verify and build in dependency order before any package manifest is changed.
        for (const entry of plan) {
            console.log(`\nChecking ${entry.package.name}...`);
            await runInherited(PNPM_COMMAND, ["--filter", entry.package.name, "check"], rootDir);
            console.log(`Building ${entry.package.name}...`);
            await runInherited(PNPM_COMMAND, ["--filter", entry.package.name, "build"], rootDir);
        }

        // A build must not leave generated changes that would invalidate PNPM's Git checks.
        await assertGitClean(rootDir);
        await commitReleasePlan(plan, rootDir);
        await assertGitClean(rootDir);

        if (!git) throw new Error("Git release state was not initialized");
        console.log(`\nPushing release commit to ${git.remoteName}/${git.remoteBranch}...`);
        try {
            await runInherited(GIT_COMMAND, ["push", git.remoteName, `HEAD:${git.remoteBranch}`], rootDir);
        } catch (error) {
            console.error("The release commit remains local; verify the remote before retrying the push.");
            throw error;
        }
        await publishReleasePlan(plan, rootDir, git.branch, getVersions);
        console.log(`\nPublished ${plan.length} package${plan.length === 1 ? "" : "s"} successfully.`);
    } finally {
        readline.close();
    }
}

if (process.argv[1]?.endsWith("publishWorkspace.ts")) {
    main().catch(error => {
        console.error(`\nPublish failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
    });
}
