import type { Vimcord } from "./Vimcord.js";

import { createRequire } from "node:module";
import { isAbsolute, join } from "node:path";
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

const STARTUP_PADDING_X = 2;
const MIN_CONSOLE_WIDTH = 80;

function getCorePackageVersion(): string {
    const { version } = require("../../package.json") as { version: string };
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
            const packageJson = createRequire(base)(`vimcord/package.json`) as { version?: unknown };
            if (typeof packageJson.version === "string") return packageJson.version;
        } catch {
            continue;
        }
    }

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

            stopLoader();
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
            ansis.cyan("COMMAND"),
            ansis.yellow(`/${commandName}`),
            `used by ${userName}`,
            ansis.hex(colors.muted)(`in ${guildName ?? "Unknown Guild"}${guildId ? ` (${guildId})` : ""}`)
        );
    }

    module(moduleName: string, ...data: unknown[]): void {
        this.log(`📦 ${ansis.bold(`[${moduleName}]`)}`, ...data);
    }

    plugin(pluginName: string, ...data: unknown[]): void {
        this.log(`🔌 ${ansis.bold(`[${pluginName}]`)}`, ...data);
    }

    pluginError(pluginName: string, message: string, error: Error, ...data: unknown[]): void {
        this.error(`🔌 ${ansis.bold(`[${pluginName}]`)}`);
    }
}

export const vimcordLogger: VimcordLogger = new VimcordLogger();
