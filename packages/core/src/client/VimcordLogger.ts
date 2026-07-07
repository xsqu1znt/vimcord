import type { Vimcord } from "./Vimcord.js";

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import ansis from "ansis";
import { Logger, stripAnsi } from "@vimcord/internal";

const STARTUP_LINES = [
    "Initializing Vimcord...",
    "Reverse engineering the mainframe...",
    "Activating really cool features...",
    "Connecting to the matrix...",
    "Revving up the engines...",
    "Pouring a cup of coffee and feeding the cat...",
    "Waiting for the matrix to respond...",
    "Loading up a storm...",
    "Combining the best of the best..."
];

const STARTUP_PADDING_X = 0;
const MIN_CONSOLE_WIDTH = 80;
const PACKAGE_REQUIRE = createRequire(join(process.cwd(), "package.json"));

function readPackageVersion(packagePath: string, packageName: string): string | null {
    try {
        const data = JSON.parse(readFileSync(packagePath, "utf8")) as { name?: unknown; version?: unknown };

        if (data.name === packageName && typeof data.version === "string") {
            return data.version;
        }
    } catch {
        return null;
    }

    return null;
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
        // Fall back to workspace lookup when @vimcord/core is running from this monorepo.
    }

    return findWorkspacePackageVersion("@vimcord/core", "packages/core") ?? "unknown";
}

function getVimcordPackageVersion(): string {
    try {
        const packageEntry = PACKAGE_REQUIRE.resolve("vimcord");
        const version = findPackageVersion(packageEntry, "vimcord");
        if (version) return version;
    } catch {
        // Fall back to core when the wrapper package is not installed, such as direct @vimcord/core usage.
    }

    const workspaceVersion = findWorkspacePackageVersion("vimcord", "packages/vimcord");
    if (workspaceVersion) return workspaceVersion;

    return getCorePackageVersion();
}

export class VimcordLogger extends Logger {
    constructor() {
        super({ prefix: "vimcord", prefixEmoji: "⚡" });
    }

    private buildStartupFooter(client: Vimcord): string {
        const { colors } = this.options;
        const consoleWidth = Math.max(MIN_CONSOLE_WIDTH, process.stdout.columns ?? MIN_CONSOLE_WIDTH);
        const maxWidth = consoleWidth - STARTUP_PADDING_X * 2;
        const padding = " ".repeat(STARTUP_PADDING_X);
        const border = ansis.hex(colors.primary);
        const muted = ansis.hex(colors.muted);
        const plugins = client.plugins.getAll(true);
        const row = (label: string, value: string): string => {
            const key = muted(label);
            const val = muted(value);
            const spacing = Math.max(1, maxWidth - stripAnsi(key).length - stripAnsi(val).length - 6);

            return `${border("│")}  ${key}${" ".repeat(spacing)}${val}  ${border("│")}`;
        };
        const spacer = `${border("│")}${" ".repeat(Math.max(0, maxWidth - 2))}${border("│")}`;
        const mode = client.$devMode
            ? ansis.bold.bgHex(colors.caution)("  ⚠ DEV_MODE  ")
            : ansis.bold.bgHex(colors.primary)("  ⚠ PRODUCTION  ");
        const node = `Node ${process.version}  `;
        const runtimeBand = ansis
            .bgHex(colors.primary)
            .black(`${" ".repeat(Math.max(0, maxWidth - node.length - stripAnsi(mode).length))}${node}${mode}`);
        const moduleRows = [
            row("📦 Events", client.modules.events.getAll().length.toString()),
            row("📦 Slash Commands", client.modules.commands.slash.getAll().length.toString()),
            row("📦 Prefix Commands", client.modules.commands.prefix.getAll().length.toString()),
            row("📦 Context Commands", client.modules.commands.getAllContextCommands().length.toString())
        ];
        const pluginRows = plugins.map(plugin => row("🔌 Plugin", plugin.name));
        const footerLabel = `${border("╰──[")} ${ansis.bold(client.$name)} ${muted(`v${client.$version}`)} ${border("]")}`;
        const footerLine = `${footerLabel}${border("─".repeat(Math.max(0, maxWidth - stripAnsi(footerLabel).length - 1)))}${border("╯")}`;

        return [
            runtimeBand,
            spacer,
            ...moduleRows,
            ...(pluginRows.length ? [spacer, ...pluginRows] : []),
            spacer,
            footerLine,
            ""
        ]
            .map(line => `${padding}${line}`)
            .join("\n");
    }

    startupBanner(client: Vimcord): () => void {
        const { colors } = this.options;
        const padding = " ".repeat(STARTUP_PADDING_X);
        const version = ansis.hex(colors.muted)(`v${getVimcordPackageVersion()}`);
        const state = { messageIndex: 0, resolved: false };

        this.write(
            "log",
            [
                ansis.hex(colors.muted)("Powered by"),
                ansis.hex(colors.primary)("██╗   ██╗██╗███╗   ███╗ ██████╗ ██████╗ ██████╗ ██████╗"),
                ansis.hex(colors.primary)("██║   ██║██║████╗ ████║██╔════╝██╔═══██╗██╔══██╗██╔══██╗"),
                ansis.hex(colors.primary)("██║   ██║██║██╔████╔██║██║     ██║   ██║██████╔╝██║  ██║"),
                ansis.hex(colors.primary)("╚██╗ ██╔╝██║██║╚██╔╝██║██║     ██║   ██║██╔══██╗██║  ██║"),
                ansis.hex(colors.primary)(" ╚████╔╝ ██║██║ ╚═╝ ██║╚██████╗╚██████╔╝██║  ██║██████╔╝"),
                ansis.hex(colors.primary)(`  ╚═══╝  ╚═╝╚═╝     ╚═╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝ ${version}`),
                ""
            ]
                .map(line => `${padding}${line}`)
                .join("\n")
        );

        const stopLoader = this.loader(STARTUP_LINES[0]!, {
            interval: 3000,
            cycle: () => {
                state.messageIndex = (state.messageIndex + 1) % STARTUP_LINES.length;
                return STARTUP_LINES[state.messageIndex] ?? STARTUP_LINES[0]!;
            }
        });

        return () => {
            if (state.resolved) return;
            state.resolved = true;

            stopLoader("", true);
            this.write("log", this.buildStartupFooter(client));

            const cliLine = ` 🚀 ${ansis.bold.hex(colors.primary)("CLI")} ${ansis.bold("~ Type /help to view available commands")} `;
            const consoleWidth = Math.max(MIN_CONSOLE_WIDTH, process.stdout.columns ?? MIN_CONSOLE_WIDTH);
            const leftLine = ansis.hex(colors.muted)("─".repeat(Math.max(0, consoleWidth - stripAnsi(cliLine).length - 2)));
            this.write("log", `${leftLine}${cliLine}${ansis.hex(colors.muted)("──")}`);
        };
    }

    clientReady(client: Vimcord<true>): void {
        this.log(
            `${ansis.hex(this.options.colors.success)(`🤖 READY`)} Connected as ${ansis.bold.hex(this.options.colors.primary)(client.user.tag)} ${ansis.hex(this.options.colors.muted)(`• ${client.guilds.cache.size} ${client.guilds.cache.size === 1 ? "guild" : "guilds"}`)}`
        );
    }

    commandUsed(commandName: string, userName: string, guildName?: string, guildId?: string): void {
        const { colors } = this.options;
        this.log(
            ansis.hex(colors.muted)("COMMAND"),
            ansis.yellow(`/${commandName}`),
            `used by ${userName}`,
            ansis.hex(colors.muted)(`in ${guildName ?? "Unknown Guild"}${guildId ? ` (${guildId})` : ""}`)
        );
    }

    module(moduleName: string, ...data: unknown[]): void {
        const { colors } = this.options;
        this.log(ansis.hex(colors.muted)("MODULE"), ansis.yellow(`[${moduleName}]`), ansis.dim(data.join("\n")));
    }

    moduleSuccess(moduleName: string, ...data: unknown[]): void {
        const { colors } = this.options;
        this.log(
            ansis.hex(colors.muted)("MODULE"),
            ansis.yellow(`[${moduleName}]`),
            ansis.hex(colors.success)("🗸"),
            ansis.dim(data.join("\n"))
        );
    }

    moduleError(moduleName: string, message: string, error: Error, ...data: unknown[]): void {
        const { colors } = this.options;
        this.log(
            ansis.hex(colors.muted)("MODULE"),
            `${ansis.yellow(`[${moduleName}]`)}`,
            ansis.hex(colors.error)(message),
            ansis.dim(data.join("\n")),
            `\n${error}`
        );
    }

    plugin = {
        log: (pluginName: string, ...data: unknown[]): void => {
            const { colors } = this.options;
            this.log(
                ansis.hex(colors.muted)("PLUGIN"),
                ansis.hex(colors.muted)(`<${pluginName}>`),
                ansis.dim(data.join(" "))
            );
        },

        debugVerbose: (pluginName: string, ...data: unknown[]): void => {
            if (!this.options.verbose) return;

            const { colors } = this.options;
            this.log(
                ansis.hex(colors.muted)("PLUGIN DEBUG"),
                ansis.hex(colors.muted)(`<${pluginName}>`),
                ansis.dim(data.join(" "))
            );
        },

        success: (pluginName: string, ...data: unknown[]): void => {
            const { colors } = this.options;
            this.log(
                ansis.hex(colors.muted)("PLUGIN"),
                ansis.hex(colors.muted)(`<${pluginName}>`),
                ansis.hex(colors.success)("🗸"),
                ansis.dim(data.join(" "))
            );
        },

        successVerbose: (pluginName: string, ...data: unknown[]): void => {
            if (!this.options.verbose) return;

            const { colors } = this.options;
            this.log(
                ansis.hex(colors.muted)("PLUGIN"),
                ansis.hex(colors.muted)(`<${pluginName}>`),
                ansis.hex(colors.success)("🗸"),
                ansis.dim(data.join(" "))
            );
        },

        error: (pluginName: string, message: string, error: Error, ...data: unknown[]): void => {
            const { colors } = this.options;
            this.log(
                ansis.hex(colors.muted)("PLUGIN"),
                ansis.hex(colors.muted)(`<${pluginName}>`),
                ansis.hex(colors.error)(message),
                ansis.dim(data.join(" ")),
                `\n${error}`
            );
        }
    };
}

export const vimcordLogger: VimcordLogger = new VimcordLogger();
