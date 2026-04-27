import ansis from "ansis";
import { DEFAULT_COLORS, Logger, stripAnsi } from "@vimcord/logger";
import { PluginManager } from "@/plugins/PluginManager.js";
import { Vimcord } from "./Vimcord.js";

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

function getRandomStartupLine(): string {
    return STARTUP_LINES[Math.floor(Math.random() * STARTUP_LINES.length)]!;
}

function getPackageVersion(): string {
    const { version } = require("../../package.json");
    return version;
}

function padLine(text: string, amount: number = 0): string {
    return `${" ".repeat(amount)}${text}${" ".repeat(amount)}`;
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
    constructor() {
        super({ prefix: "vimcord", prefixEmoji: "⚡" });
    }

    startupBanner(client: Vimcord) {
        const { colors } = this.options;

        const pX = 2;
        const consoleWidth = process.stdout.columns;
        // const maxWidth = 58;
        const maxWidth = consoleWidth - 2;

        const version_f = ansis.hex(colors.muted)(`v${getPackageVersion()}`);
        const _lines1 = [
            "",
            ansis.hex(colors.muted)("Powered by"),
            ansis.hex(colors.primary)("██╗   ██╗██╗███╗   ███╗ ██████╗ ██████╗ ██████╗ ██████╗"),
            ansis.hex(colors.primary)("██║   ██║██║████╗ ████║██╔════╝██╔═══██╗██╔══██╗██╔══██╗"),
            ansis.hex(colors.primary)("██║   ██║██║██╔████╔██║██║     ██║   ██║██████╔╝██║  ██║"),
            ansis.hex(colors.primary)("╚██╗ ██╔╝██║██║╚██╔╝██║██║     ██║   ██║██╔══██╗██║  ██║"),
            ansis.hex(colors.primary)(" ╚████╔╝ ██║██║ ╚═╝ ██║╚██████╗╚██████╔╝██║  ██║██████╔╝"),
            ansis.hex(colors.primary)(`  ╚═══╝  ╚═╝╚═╝     ╚═╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝ ${version_f}`),
            ""
        ];
        this.write("log", _lines1.map(l => padLine(l, pX)).join("\n"));

        let stopLoader = this.loader(getRandomStartupLine());

        const formatKV = (k: string, v: string) => {
            const keyStyled = ansis.dim.hex(colors.muted)(k);
            const valStyled = ansis.hex(colors.muted)(v);
            const remainingLength = maxWidth - pX - stripAnsi(keyStyled).length - stripAnsi(valStyled).length - 6;
            return `${ansis.hex(colors.primary)("│")}  ${keyStyled}${" ".repeat(remainingLength)}${valStyled}  ${ansis.hex(colors.primary)("│")}`;
        };

        return {
            setLoader: (msg: string) => {
                stopLoader("\x1b[1A\x1b[2K", true);
                stopLoader = this.loader(msg);
            },
            resolveBanner: () => {
                const _lines2 = [
                    (() => {
                        const str1 = `Node ${process.version}  `;
                        const str2 = client.$devMode
                            ? ansis.bold.bgHex(colors.caution)("  ⚠ DEV_MODE  ")
                            : ansis.bold.bgHex(colors.primary)("  ⚠ PRODUCTION  ");
                        const padding = maxWidth - str1.length - stripAnsi(str2).length - pX;
                        return ansis.bgHex(colors.primary).black(`${" ".repeat(padding)}${str1}${str2}`);
                    })(),
                    ansis.hex(colors.primary)(`${"│".padEnd(maxWidth - 3)}│`),

                    // Plugins
                    ...client.plugins.getAll(true).map(p => formatKV("🔌 Plugin", p.name)),

                    /* ...meta.map(([k, v]) => {
                        const keyStyled = ansis.dim.hex(colors.muted)(k);
                        const valStyled = ansis.hex(colors.muted)(v);
                        const remainingLength = maxWidth - pX - stripAnsi(keyStyled).length - stripAnsi(valStyled).length - 6;
                        return `${ansis.hex(colors.primary)("│")}  ${keyStyled}${" ".repeat(remainingLength)}${valStyled}  ${ansis.hex(colors.primary)("│")}`;
                    }), */

                    ansis.hex(colors.primary)(`${"│".padEnd(maxWidth - 3)}│`),
                    (() => {
                        const str = `${ansis.hex(colors.primary)("╰──")}${ansis.hex(colors.primary)("i0(")} ${ansis.bold(client.$name)} ${ansis.hex(colors.muted)(`v${client.$version}`)} ${ansis.hex(colors.primary)(")")}`;
                        const remainingLength = maxWidth - pX - stripAnsi(str).length - 1;
                        return `${str}${ansis.hex(colors.primary)(`─`.repeat(remainingLength))}${ansis.hex(colors.primary)("╯")}`;
                    })(),
                    ""
                ];

                const clearPrevLine = "\x1b[1A\x1b[2K";
                stopLoader(`${clearPrevLine}${_lines2.map(l => padLine(l, pX)).join("\n")}`, true);

                this.write(
                    "log",
                    drawTextThroughLine(
                        ` 🚀 ${ansis.bold.hex(colors.primary)("CLI")} ${ansis.bold("~ Type /help to view available commands")} `,
                        consoleWidth,
                        "right"
                    )
                );
            }
        };
    }

    clientReady(client: Vimcord<true>) {
        this.log(
            `${ansis.hex(this.options.colors.success)(`🤖 READY`)} Connected as ${ansis.bold.hex(this.options.colors.primary)(client.user.tag)} ${ansis.hex(this.options.colors.muted)(`• ${client.guilds.cache.size} ${client.guilds.cache.size === 1 ? "guild" : "guilds"}`)}`
        );
    }
}

export const vimcordLogger: VimcordLogger = new VimcordLogger();
