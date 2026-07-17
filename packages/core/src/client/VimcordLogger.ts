import type { LoggerOptions } from "@/utils/Logger.js";
import type { Vimcord } from "./Vimcord.js";

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import ansis from "ansis";
import { Logger, stripAnsi } from "@/utils/Logger.js";

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

const MIN_CONSOLE_WIDTH = 80;
const PACKAGE_REQUIRE = createRequire(join(process.cwd(), "package.json"));

function readPackageVersion(packagePath: string, packageName: string): string | null {
    try {
        const data = JSON.parse(readFileSync(packagePath, "utf8")) as { name?: unknown; version?: unknown };

        if (data.name === packageName && typeof data.version === "string") return data.version;
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
        // Fall back to workspace lookup when core is running from this monorepo.
    }

    return findWorkspacePackageVersion("@vimcord/core", "packages/core") ?? "unknown";
}

function getVimcordPackageVersion(): string {
    try {
        const packageEntry = PACKAGE_REQUIRE.resolve("vimcord");
        const version = findPackageVersion(packageEntry, "vimcord");
        if (version) return version;
    } catch {
        // Fall back to core when the wrapper package is not installed.
    }

    return findWorkspacePackageVersion("vimcord", "packages/vimcord") ?? getCorePackageVersion();
}

/** Controls the in-progress Vimcord startup banner. */
export interface VimcordStartupBannerHandle {
    /** Completes the banner with the loaded client summary. */
    complete(): void;
    /** Removes the in-progress banner without rendering a success summary. */
    clear(): void;
}

/** Plugin-scoped logger API exposed by `VimcordLogger`. */
export interface VimcordPluginLogger {
    /** Logs normal plugin output. */
    log(pluginName: string, ...data: unknown[]): void;
    /** Logs plugin diagnostics when verbose mode is enabled. */
    debug(pluginName: string, ...data: unknown[]): void;
    /** Logs successful plugin output. */
    success(pluginName: string, ...data: unknown[]): void;
    /** Logs a plugin error with optional stack details. */
    error(pluginName: string, message: string, error?: unknown, ...data: unknown[]): void;
}

/** Structured data for one completed command log entry. */
export interface VimcordCommandLogData {
    /** Command name. */
    commandName: string;
    /** Display name of the user who ran the command. */
    userName: string;
    /** Guild name, when available. */
    guildName?: string;
    /** Guild ID, when available. */
    guildId?: string;
    /** Total execution time in milliseconds. */
    durationMs?: number;
}

/** Vimcord-specific logger for startup, command, module, and plugin output. */
export class VimcordLogger extends Logger {
    /** Creates a Vimcord logger with optional display overrides. */
    constructor(options: LoggerOptions = {}) {
        super({ prefix: "⚡ vimcord", ...options });
    }

    private buildStartupFooter(client: Vimcord): string {
        const { colors } = this.options;
        const consoleWidth = process.stdout.columns ?? MIN_CONSOLE_WIDTH;
        const plugins = client.plugins.getAll(true);
        const eventCount = client.modules.events.getAll().length;
        const slashCount = client.modules.commands.slash.getAll().length;
        const prefixCount = client.modules.commands.prefix.getAll().length;
        const contextCount = client.modules.commands.getAllContextCommands().length;

        if (process.stdout.isTTY === true && consoleWidth < MIN_CONSOLE_WIDTH) {
            const mode = client.$devMode ? "DEV" : "PRODUCTION";
            return [
                `${ansis.bold.hex(colors.primary)(client.$name)} ${ansis.hex(colors.muted)(`v${client.$version}`)} ${ansis.hex(colors.caution)(mode)}`,
                ansis.hex(colors.muted)(
                    `${eventCount} events • ${slashCount} slash • ${prefixCount} prefix • ${contextCount} context • ${plugins.length} plugins`
                ),
                ""
            ].join("\n");
        }

        const border = ansis.hex(colors.primary);
        const muted = ansis.hex(colors.muted);
        const row = (label: string, value: string): string => {
            const key = muted(label);
            const val = muted(value);
            const spacing = Math.max(1, consoleWidth - stripAnsi(key).length - stripAnsi(val).length - 6);

            return `${border("│")}  ${key}${" ".repeat(spacing)}${val}  ${border("│")}`;
        };
        const spacer = `${border("│")}${" ".repeat(Math.max(0, consoleWidth - 2))}${border("│")}`;
        const mode = client.$devMode
            ? ansis.bold.bgHex(colors.caution)("  ⚠ DEV_MODE  ")
            : ansis.bold.bgHex(colors.primary)("  PRODUCTION  ");
        const node = `Node ${process.version}  `;
        const runtimeBand = ansis
            .bgHex(colors.primary)
            .black(`${" ".repeat(Math.max(0, consoleWidth - node.length - stripAnsi(mode).length))}${node}${mode}`);
        const moduleRows = [
            row("📦 Events", eventCount.toString()),
            row("📦 Slash Commands", slashCount.toString()),
            row("📦 Prefix Commands", prefixCount.toString()),
            row("📦 Context Commands", contextCount.toString())
        ];
        const pluginRows = plugins.map(plugin => row("🔌 Plugin", plugin.name));
        const footerLabel = `${border("╰──[")} ${ansis.bold(client.$name)} ${muted(`v${client.$version}`)} ${border("]")}`;
        const footerLine = `${footerLabel}${border("─".repeat(Math.max(0, consoleWidth - stripAnsi(footerLabel).length - 1)))}${border("╯")}`;

        return [
            runtimeBand,
            spacer,
            ...moduleRows,
            ...(pluginRows.length ? [spacer, ...pluginRows] : []),
            spacer,
            footerLine,
            ""
        ].join("\n");
    }

    /** Starts the branded startup banner and returns controls for resolving it. */
    startupBanner(client: Vimcord): VimcordStartupBannerHandle {
        const { colors } = this.options;
        const version = ansis.hex(colors.muted)(`v${getVimcordPackageVersion()}`);
        const compact = process.stdout.isTTY === true && (process.stdout.columns ?? MIN_CONSOLE_WIDTH) < MIN_CONSOLE_WIDTH;
        let messageIndex = 0;
        let resolved = false;

        if (compact) {
            this.write("log", `${ansis.bold.hex(colors.primary)("⚡ Vimcord")} ${version}`);
        } else {
            this.write(
                "log",
                [
                    ansis.hex(colors.muted)("Powered by"),
                    ansis.hex(colors.primary)("██╗   ██╗███╗   ███╗ ██████╗ ██████╗ ██████╗ ██████╗"),
                    ansis.hex(colors.primary)("██║   ██║████╗ ████║██╔════╝██╔═══██╗██╔══██╗██╔══██╗"),
                    ansis.hex(colors.primary)("██║   ██║██╔████╔██║██║     ██║   ██║██████╔╝██║  ██║"),
                    ansis.hex(colors.primary)("╚██╗ ██╔╝██║██║╚██╔╝██║██║     ██║   ██║██╔══██╗██║  ██║"),
                    ansis.hex(colors.primary)(" ╚████╔╝ ██║██║ ╚═╝ ██║╚██████╗╚██████╔╝██║  ██║██████╔╝"),
                    ansis.hex(colors.primary)(`  ╚═══╝  ╚═╝╚═╝     ╚═╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝ ${version}`),
                    ""
                ].join("\n")
            );
        }

        const loader = this.loader(STARTUP_LINES[0]!, {
            interval: 3_000,
            cycle: () => {
                messageIndex = (messageIndex + 1) % STARTUP_LINES.length;
                return STARTUP_LINES[messageIndex] ?? STARTUP_LINES[0]!;
            }
        });

        return {
            complete: () => {
                if (resolved) return;
                resolved = true;

                loader.stop();
                this.write("log", this.buildStartupFooter(client));

                if (!client.globals.app.enableCLI) return;

                const cliLine = ` 🚀 ${ansis.bold.hex(colors.primary)("CLI")} ${ansis.bold("~ Type /help to view available commands")} `;
                const consoleWidth = process.stdout.columns ?? MIN_CONSOLE_WIDTH;
                const leftLine = ansis.hex(colors.muted)(
                    "─".repeat(Math.max(0, consoleWidth - stripAnsi(cliLine).length - 2))
                );
                this.write("log", `${leftLine}${cliLine}${ansis.hex(colors.muted)("──")}`);
            },
            clear: () => {
                if (resolved) return;
                resolved = true;
                loader.stop();
            }
        };
    }

    /** Logs the connected Discord client identity and guild count. */
    clientReady(client: Vimcord<true>): void {
        this.log(
            `${ansis.hex(this.options.colors.success)("🤖 READY")} Connected as ${ansis.bold.hex(this.options.colors.primary)(client.user.tag)} ${ansis.hex(this.options.colors.muted)(`• ${client.guilds.cache.size} ${client.guilds.cache.size === 1 ? "guild" : "guilds"}`)}`
        );
    }

    /** Logs a completed command execution. */
    commandUsed({ commandName, userName, guildName, guildId, durationMs }: VimcordCommandLogData): void {
        const { colors } = this.options;
        this.log(
            ansis.hex(colors.muted)("COMMAND"),
            ansis.yellow(`/${commandName}`),
            `used by ${userName}`,
            ansis.hex(colors.muted)(`in ${guildName ?? "Unknown Guild"}${guildId ? ` (${guildId})` : ""}`),
            ...(durationMs === undefined ? [] : [ansis.dim(`${durationMs.toFixed(1)}ms`)])
        );
    }

    /** Logs module-scoped output without flattening structured values. */
    module(moduleName: string, ...data: unknown[]): void {
        const { colors } = this.options;
        this.log(ansis.hex(colors.muted)("MODULE"), ansis.yellow(`[${moduleName}]`), ...data);
    }

    /** Plugin-scoped logging methods. */
    readonly plugin: VimcordPluginLogger = {
        log: (pluginName: string, ...data: unknown[]): void => {
            const { colors } = this.options;
            this.log(ansis.hex(colors.muted)("PLUGIN"), ansis.hex(colors.muted)(`<${pluginName}>`), ...data);
        },
        debug: (pluginName: string, ...data: unknown[]): void => {
            this.debug(`Plugin <${pluginName}>`, ...data);
        },
        success: (pluginName: string, ...data: unknown[]): void => {
            this.success(`Plugin <${pluginName}>`, ...data);
        },
        error: (pluginName: string, message: string, error?: unknown, ...data: unknown[]): void => {
            this.error(`Plugin <${pluginName}>: ${message}`, error, ...data);
        }
    };
}
