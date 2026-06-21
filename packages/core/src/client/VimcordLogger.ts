import { createRequire } from "node:module";
import { isAbsolute, join } from "node:path";
import ansis from "ansis";
import { DEFAULT_COLORS, Logger, stripAnsi } from "@vimcord/internal";
import { Vimcord } from "./Vimcord.js";

export type VimcordModuleLogger = {
    log(message: string, ...data: unknown[]): void;
    logVerbose(message: string, ...data: unknown[]): void;
    debug(message: string, ...data: unknown[]): void;
    debugVerbose(message: string, ...data: unknown[]): void;
    info(message: string, ...data: unknown[]): void;
    infoVerbose(message: string, ...data: unknown[]): void;
    success(message: string, ...data: unknown[]): void;
    successVerbose(message: string, ...data: unknown[]): void;
    warn(message: string, ...data: unknown[]): void;
    warnVerbose(message: string, ...data: unknown[]): void;
    error(message: string, error?: Error, ...data: unknown[]): void;
    errorVerbose(message: string, error?: Error, ...data: unknown[]): void;
};

export type VimcordModuleLoggerOptions = {
    emoji?: string;
};

export type BannerOptions = {
    /** Bot name displayed in the top border and left column */
    name: string;
    /** Bot version displayed in the left column */
    version: string;
    /** Shows a DEV badge in the bottom border @defaultValue false */
    devMode?: boolean;
    /** Secondary line shown at the bottom of the left column */
    poweredBy?: string;
    /** Key/value pairs rendered in the right column */
    meta?: [string, string][];
};

type StartupBannerState = {
    active: boolean;
    capturedLines: number;
    messageIndex: number;
    stopLoader: (finalMessage?: string, clear?: boolean) => void;
};

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

const STARTUP_PADDING_X = 2;
const MIN_CONSOLE_WIDTH = 80;
const WRAPPER_PACKAGE_NAME = "vimcord";

function getCorePackageVersion(): string {
    const { version } = require("../../package.json");
    return version;
}

function getVimcordPackageVersion(): string {
    const mainPath = process.argv[1];
    const requireBases = [
        mainPath ? (isAbsolute(mainPath) ? mainPath : join(process.cwd(), mainPath)) : null,
        join(process.cwd(), "package.json")
    ].filter((base): base is string => Boolean(base));

    for (const base of requireBases) {
        try {
            const packageJson = createRequire(base)(`${WRAPPER_PACKAGE_NAME}/package.json`) as { version?: unknown };
            if (typeof packageJson.version === "string") return packageJson.version;
        } catch {
            continue;
        }
    }

    return getCorePackageVersion();
}

function padLine(text: string, amount: number = 0): string {
    return `${" ".repeat(amount)}${text}${" ".repeat(amount)}`;
}

function getConsoleWidth(): number {
    return Math.max(MIN_CONSOLE_WIDTH, process.stdout.columns ?? MIN_CONSOLE_WIDTH);
}

function countTerminalLines(text: string, width = getConsoleWidth()): number {
    return text.split("\n").reduce((lines, line) => {
        return lines + Math.max(1, Math.ceil(stripAnsi(line).length / width));
    }, 0);
}

function countConsoleLines(data: unknown[]): number {
    return countTerminalLines(data.map(item => String(item)).join(" "));
}

function drawTextThroughLine(
    text: string,
    maxWidth: number,
    align: "left" | "center" | "right" = "left",
    padding = 0
): string {
    const visible = stripAnsi(text).length;
    const total = Math.max(0, maxWidth - visible) - padding * 2;
    let result = "";

    const drawLine = (len: number): string => {
        return ansis.hex(DEFAULT_COLORS.muted)("─".repeat(len));
    };

    switch (align) {
        case "left":
            result = `${drawLine(2)}${text}${drawLine(total - 2)}`;
            break;
        case "center":
            const left = Math.floor(total / 2);
            const right = total - left;
            result = `${drawLine(left)}${text}${drawLine(right)}`;
            break;
        case "right":
            result = `${drawLine(total - 2)}${text}${drawLine(2)}`;
            break;
    }

    return padLine(result, padding);
}

export class VimcordLogger extends Logger {
    private startupState: StartupBannerState | null = null;

    constructor() {
        super({ prefix: "vimcord", prefixEmoji: "⚡" });
    }

    private buildModulePrefix(moduleName: string, options: VimcordModuleLoggerOptions): string {
        const emoji = options.emoji ? `${options.emoji} ` : "";
        const name = ansis.bold.hex(this.options.colors.primary)(`[${moduleName}]`);
        return `${emoji}${name}`;
    }

    private writeModuleLog(
        stream: "log" | "warn" | "error",
        modulePrefix: string,
        message: string,
        ...data: unknown[]
    ): void {
        this.write(stream, this.buildLine(this.fmtTimestamp(), modulePrefix), message, ...data);
    }

    protected override write(stream: "log" | "warn" | "error", ...data: unknown[]): void {
        const state = this.startupState;
        if (!state?.active) {
            super.write(stream, ...data);
            return;
        }

        super.write(stream, ...data);
        state.capturedLines += countConsoleLines(data);
    }

    startupBanner(client: Vimcord) {
        const state: StartupBannerState = {
            active: true,
            capturedLines: 0,
            messageIndex: 0,
            stopLoader: () => undefined
        };

        this.writeStartupLogo();
        this.startupState = state;
        state.stopLoader = this.loader(STARTUP_LINES[0]!, () => {
            state.messageIndex = (state.messageIndex + 1) % STARTUP_LINES.length;
            return STARTUP_LINES[state.messageIndex] ?? STARTUP_LINES[0]!;
        });

        return {
            addStartupLog: (msg: string) => {
                this.log(ansis.dim(msg));
            },
            clearBanner: () => {
                if (!state.active) return;

                state.active = false;
                this.clearStartupTransients(state);
                this.startupState = null;
            },
            resolveBanner: () => {
                if (!state.active) return;

                state.active = false;
                this.clearStartupTransients(state);
                this.startupState = null;
                this.writeFinalStartupBanner(client);
            }
        };
    }

    private clearStartupTransients(state: StartupBannerState): void {
        state.stopLoader(undefined, true);

        const lines = state.capturedLines;
        if (!lines) return;

        process.stdout.write(`\x1b[${lines}A\x1b[J`);
        state.capturedLines = 0;
    }

    private writeFinalStartupBanner(client: Vimcord): void {
        const consoleWidth = getConsoleWidth();
        const maxWidth = consoleWidth - STARTUP_PADDING_X * 2;

        this.write("log", this.buildStartupBannerBodyLines(client, maxWidth).join("\n"));
        this.write(
            "log",
            drawTextThroughLine(
                ` 🚀 ${ansis.bold.hex(this.options.colors.primary)("CLI")} ${ansis.bold("~ Type /help to view available commands")} `,
                consoleWidth,
                "right"
            )
        );
    }

    private buildStartupBannerBodyLines(client: Vimcord, maxWidth: number): string[] {
        const { colors } = this.options;
        const plugins = client.plugins.getAll(true);
        const moduleRows = [
            this.formatBannerRow("📦 Events", client.modules.events.getAll().length.toString(), maxWidth),
            this.formatBannerRow("📦 Slash Commands", client.modules.commands.slash.getAll().length.toString(), maxWidth),
            this.formatBannerRow("📦 Prefix Commands", client.modules.commands.prefix.getAll().length.toString(), maxWidth),
            this.formatBannerRow(
                "📦 Context Commands",
                client.modules.commands.getAllContextCommands().length.toString(),
                maxWidth
            )
        ];
        const pluginRows = plugins.map(plugin => this.formatBannerRow("🔌 Plugin", plugin.name, maxWidth));
        const rows = pluginRows.length ? [...moduleRows, this.formatBannerSpacer(maxWidth), ...pluginRows] : moduleRows;

        return [
            this.formatRuntimeBand(client, maxWidth),
            ansis.hex(colors.primary)(`${"│".padEnd(maxWidth - 1)}│`),
            ...rows,
            ansis.hex(colors.primary)(`${"│".padEnd(maxWidth - 1)}│`),
            this.formatBannerFooter(client, maxWidth),
            ""
        ].map(line => padLine(line, STARTUP_PADDING_X));
    }

    private writeStartupLogo(): void {
        this.write(
            "log",
            this.buildStartupLogoLines()
                .map(line => padLine(line, STARTUP_PADDING_X))
                .join("\n")
        );
    }

    private buildStartupLogoLines(): string[] {
        const { colors } = this.options;
        const version = ansis.hex(colors.muted)(`v${getVimcordPackageVersion()}`);

        return [
            ansis.hex(colors.muted)("Powered by"),
            ansis.hex(colors.primary)("██╗   ██╗██╗███╗   ███╗ ██████╗ ██████╗ ██████╗ ██████╗"),
            ansis.hex(colors.primary)("██║   ██║██║████╗ ████║██╔════╝██╔═══██╗██╔══██╗██╔══██╗"),
            ansis.hex(colors.primary)("██║   ██║██║██╔████╔██║██║     ██║   ██║██████╔╝██║  ██║"),
            ansis.hex(colors.primary)("╚██╗ ██╔╝██║██║╚██╔╝██║██║     ██║   ██║██╔══██╗██║  ██║"),
            ansis.hex(colors.primary)(" ╚████╔╝ ██║██║ ╚═╝ ██║╚██████╗╚██████╔╝██║  ██║██████╔╝"),
            ansis.hex(colors.primary)(`  ╚═══╝  ╚═╝╚═╝     ╚═╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝ ${version}`),
            ""
        ];
    }

    private formatRuntimeBand(client: Vimcord, maxWidth: number): string {
        const { colors } = this.options;
        const mode = client.$devMode
            ? ansis.bold.bgHex(colors.caution)("  ⚠ DEV_MODE  ")
            : ansis.bold.bgHex(colors.primary)("  ⚠ PRODUCTION  ");
        const node = `Node ${process.version}  `;
        const padding = Math.max(0, maxWidth - node.length - stripAnsi(mode).length);

        return ansis.bgHex(colors.primary).black(`${" ".repeat(padding)}${node}${mode}`);
    }

    private formatBannerRow(label: string, value: string, maxWidth: number): string {
        const { colors } = this.options;
        const keyStyled = ansis.hex(colors.muted)(label);
        const valStyled = ansis.hex(colors.muted)(value);
        const spacing = Math.max(1, maxWidth - stripAnsi(keyStyled).length - stripAnsi(valStyled).length - 6);

        return `${ansis.hex(colors.primary)("│")}  ${keyStyled}${" ".repeat(spacing)}${valStyled}  ${ansis.hex(colors.primary)("│")}`;
    }

    private formatBannerSpacer(maxWidth: number): string {
        return `${ansis.hex(this.options.colors.primary)("│")}${" ".repeat(Math.max(0, maxWidth - 2))}${ansis.hex(this.options.colors.primary)("│")}`;
    }

    private formatBannerFooter(client: Vimcord, maxWidth: number): string {
        const { colors } = this.options;
        const label = `${ansis.hex(colors.primary)("╰──[")} ${ansis.bold(client.$name)} ${ansis.hex(colors.muted)(`v${client.$version}`)} ${ansis.hex(colors.primary)("]")}`;
        const remainingLength = Math.max(0, maxWidth - stripAnsi(label).length - 1);

        return `${label}${ansis.hex(colors.primary)("─".repeat(remainingLength))}${ansis.hex(colors.primary)("╯")}`;
    }

    clientReady(client: Vimcord<true>): void {
        this.log(
            `${ansis.hex(this.options.colors.success)(`🤖 READY`)} Connected as ${ansis.bold.hex(this.options.colors.primary)(client.user.tag)} ${ansis.hex(this.options.colors.muted)(`• ${client.guilds.cache.size} ${client.guilds.cache.size === 1 ? "guild" : "guilds"}`)}`
        );
    }

    module(moduleName: string, options: VimcordModuleLoggerOptions = {}): VimcordModuleLogger {
        const modulePrefix = this.buildModulePrefix(moduleName, options);

        return {
            log: (message, ...data) => this.writeModuleLog("log", modulePrefix, message, ...data),
            logVerbose: (message, ...data) => {
                if (!this.options.verbose) return;
                this.writeModuleLog("log", modulePrefix, message, ...data);
            },
            debug: (message, ...data) => {
                if (!this.shouldLog("debug")) return;
                this.writeModuleLog("log", modulePrefix, ansis.dim(message), ...data);
            },
            debugVerbose: (message, ...data) => {
                if (!this.options.verbose || !this.shouldLog("debug")) return;
                this.writeModuleLog("log", modulePrefix, ansis.dim(message), ...data);
            },
            info: (message, ...data) => {
                if (!this.shouldLog("info")) return;
                this.writeModuleLog("log", modulePrefix, message, ...data);
            },
            infoVerbose: (message, ...data) => {
                if (!this.options.verbose || !this.shouldLog("info")) return;
                this.writeModuleLog("log", modulePrefix, message, ...data);
            },
            success: (message, ...data) => {
                if (!this.shouldLog("success")) return;
                this.writeModuleLog("log", modulePrefix, ansis.hex(this.options.colors.success)(message), ...data);
            },
            successVerbose: (message, ...data) => {
                if (!this.options.verbose || !this.shouldLog("success")) return;
                this.writeModuleLog("log", modulePrefix, ansis.hex(this.options.colors.success)(message), ...data);
            },
            warn: (message, ...data) => {
                if (!this.shouldLog("warn")) return;
                this.writeModuleLog("warn", modulePrefix, ansis.hex(this.options.colors.warn)(message), ...data);
            },
            warnVerbose: (message, ...data) => {
                if (!this.options.verbose || !this.shouldLog("warn")) return;
                this.writeModuleLog("warn", modulePrefix, ansis.hex(this.options.colors.warn)(message), ...data);
            },
            error: (message, error, ...data) => {
                if (!this.shouldLog("error")) return;

                this.writeModuleLog("error", modulePrefix, ansis.hex(this.options.colors.error)(message), ...data);
                if (error?.stack) this.write("error", ansis.dim(error.stack));
            },
            errorVerbose: (message, error, ...data) => {
                if (!this.options.verbose || !this.shouldLog("error")) return;

                this.writeModuleLog("error", modulePrefix, ansis.hex(this.options.colors.error)(message), ...data);
                if (error?.stack) this.write("error", ansis.dim(error.stack));
            }
        };
    }

    command(commandName: string, userName: string, guildName?: string, guildId?: string): void {
        const { colors } = this.options;
        this.log(
            ansis.cyan("COMMAND"),
            ansis.yellow(`/${commandName}`),
            `used by ${userName}`,
            ansis.hex(colors.muted)(`in ${guildName ?? "Unknown Guild"}${guildId ? ` (${guildId})` : ""}`)
        );
    }
}

export const vimcordLogger: VimcordLogger = new VimcordLogger();
