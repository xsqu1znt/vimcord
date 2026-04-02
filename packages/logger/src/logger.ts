import ansis from "ansis";

// --- Types ---

export type LogLevel = "debug" | "info" | "success" | "warn" | "error";

export type ColorScheme = {
    primary: string;
    success: string;
    warn: string;
    caution: string;
    error: string;
    muted: string;
    text: string;
};

export type LoggerOptions = {
    /** Prefix label shown before each message */
    prefix?: string | null;
    /** Emoji shown before the prefix */
    prefixEmoji?: string | null;
    /** Minimum log level to output
     * @defaultValue "debug"
     */
    minLevel?: LogLevel;
    /** Show timestamp before each message
     * @defaultValue true
     */
    showTimestamp?: boolean;
    /** Override default color scheme */
    colors?: Partial<ColorScheme>;
};

type LoaderEntry = {
    message: string;
    frame: string;
};

// --- Constants ---

const LEVEL_PRIORITY: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    success: 2,
    warn: 3,
    error: 4
};

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export const DEFAULT_COLORS: ColorScheme = {
    primary: "#5865F2",
    success: "#57F287",
    warn: "#FEE75C",
    caution: "#FF9D00",
    error: "#ED4245",
    muted: "#747F8D",
    text: "#FFFFFF"
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
    meta?: Record<string, string>;
};

// --- Helpers ---

/** Strips ANSI escape codes from a string for accurate length measurement */
function stripAnsi(str: string): string {
    return str.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Pads a string by its visible length, ignoring ANSI codes */
function padVisible(str: string, length: number): string {
    const visible = stripAnsi(str).length;
    return str + " ".repeat(Math.max(0, length - visible));
}

// --- Logger ---

export class Logger {
    protected colors: ColorScheme;
    protected prefix: string | null;
    protected prefixEmoji: string | null;
    protected minLevel: LogLevel;
    protected showTimestamp: boolean;

    private activeLoaders: Map<number, LoaderEntry> = new Map();
    private nextLoaderId = 0;
    private renderInterval: ReturnType<typeof setInterval> | null = null;
    private frameIndex = 0;

    private startRenderLoop(): void {
        if (this.renderInterval) return;
        this.renderInterval = setInterval(() => {
            this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length;

            // Redraw all loaders in one pass
            const count = this.activeLoaders.size;
            if (count === 0) return;

            // Move cursor up to first loader line
            process.stdout.write(`\x1b[${count}A`);

            for (const [, loader] of this.activeLoaders) {
                const frame = ansis.hex(this.colors.warn)(SPINNER_FRAMES[this.frameIndex]!);
                const prefix = this.buildLine(this.formatTimestamp(), this.formatPrefix());
                process.stdout.write(`\r\x1b[K${prefix} ${frame} ${loader.message}\n`);
            }
        }, 80);
    }

    private stopRenderLoop(): void {
        if (!this.renderInterval) return;
        clearInterval(this.renderInterval);
        this.renderInterval = null;
        this.frameIndex = 0;
    }

    constructor(options: LoggerOptions = {}) {
        const { prefix = null, prefixEmoji = null, minLevel = "debug", showTimestamp = true, colors = {} } = options;

        this.prefix = prefix;
        this.prefixEmoji = prefixEmoji;
        this.minLevel = minLevel;
        this.showTimestamp = showTimestamp;
        this.colors = { ...DEFAULT_COLORS, ...colors };
    }

    // --- Formatting ---

    protected formatTimestamp(): string {
        if (!this.showTimestamp) return "";
        const now = new Date();
        const time = now.toLocaleTimeString("en-US", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        });
        return ansis.hex(this.colors.muted)(`[${time}]`);
    }

    protected formatPrefix(): string {
        if (!this.prefix) return "";
        const emoji = this.prefixEmoji ? `${this.prefixEmoji} ` : "";
        return ansis.bold.hex(this.colors.primary)(`${emoji}${this.prefix}`);
    }

    protected formatLevel(level: LogLevel): string {
        switch (level) {
            case "debug":
                return ansis.hex(this.colors.muted)("DEBUG");
            case "info":
                return ansis.hex("#87CEEB")("INFO");
            case "success":
                return ansis.bold.hex(this.colors.success)("✓ SUCCESS");
            case "warn":
                return ansis.bold.hex(this.colors.warn)("⚠ WARN");
            case "error":
                return ansis.bold.hex(this.colors.error)("✕ ERROR");
        }
    }

    protected buildLine(...parts: (string | undefined)[]): string {
        return parts.filter(Boolean).join(" ");
    }

    // --- Level Guard ---

    protected shouldLog(level: LogLevel): boolean {
        return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.minLevel];
    }

    // --- Loader Rendering ---

    private clearLoaders(): void {
        const count = this.activeLoaders.size;
        if (count === 0) return;
        process.stdout.write(`\x1b[${count}A`);
        process.stdout.write("\x1b[J");
    }

    private redrawLoaders(): void {
        for (const [, loader] of this.activeLoaders) {
            const frame = ansis.hex(this.colors.warn)(loader.frame);
            const prefix = this.buildLine(this.formatTimestamp(), this.formatPrefix());
            process.stdout.write(`${prefix} ${frame} ${loader.message}\n`);
        }
    }

    // --- Core Write ---

    /** Overridable write method — subclasses can intercept all output here */
    protected write(stream: "log" | "warn" | "error", ...parts: unknown[]): void {
        const hasLoaders = this.activeLoaders.size > 0;

        if (hasLoaders) this.clearLoaders();
        console[stream](...parts);
        if (hasLoaders) this.redrawLoaders();
    }

    // --- Public Log Methods ---

    /** Raw log with no level label or filtering */
    log(message: string, ...args: unknown[]): void {
        this.write("log", this.buildLine(this.formatTimestamp(), this.formatPrefix()), message, ...args);
    }

    debug(message: string, ...args: unknown[]): void {
        if (!this.shouldLog("debug")) return;
        this.write(
            "log",
            this.buildLine(this.formatTimestamp(), this.formatPrefix(), this.formatLevel("debug")),
            ansis.dim(message),
            ...args
        );
    }

    info(message: string, ...args: unknown[]): void {
        if (!this.shouldLog("info")) return;
        this.write(
            "log",
            this.buildLine(this.formatTimestamp(), this.formatPrefix(), this.formatLevel("info")),
            message,
            ...args
        );
    }

    success(message: string, ...args: unknown[]): void {
        if (!this.shouldLog("success")) return;
        this.write(
            "log",
            this.buildLine(this.formatTimestamp(), this.formatPrefix(), this.formatLevel("success")),
            ansis.hex(this.colors.success)(message),
            ...args
        );
    }

    warn(message: string, ...args: unknown[]): void {
        if (!this.shouldLog("warn")) return;
        this.write(
            "warn",
            this.buildLine(this.formatTimestamp(), this.formatPrefix(), this.formatLevel("warn")),
            ansis.hex(this.colors.warn)(message),
            ...args
        );
    }

    error(message: string, error?: Error, ...args: unknown[]): void {
        if (!this.shouldLog("error")) return;
        this.write(
            "error",
            this.buildLine(this.formatTimestamp(), this.formatPrefix(), this.formatLevel("error")),
            ansis.hex(this.colors.error)(message),
            ...args
        );
        if (error?.stack) {
            this.write("error", ansis.dim(error.stack));
        }
    }

    // --- Structured Output ---

    table(title: string, data: Record<string, unknown>): void {
        this.write("log", this.buildLine(this.formatTimestamp(), this.formatPrefix()), ansis.bold(title));
        for (const [key, value] of Object.entries(data)) {
            const formattedKey = padVisible(ansis.hex(this.colors.warn)(`  ${key}`), 25);
            const formattedValue = ansis.hex(this.colors.muted)(String(value));
            this.write("log", `${formattedKey} ${formattedValue}`);
        }
    }

    section(title: string): void {
        const titleVisible = stripAnsi(title);
        const width = Math.max(30, titleVisible.length + 4);
        const line = "─".repeat(width);
        const paddedTitle = padVisible(ansis.bold.hex(this.colors.text)(title), width);

        this.write("log", ansis.hex(this.colors.muted)(`\n┌─${line}─┐`));
        this.write("log", ansis.hex(this.colors.muted)("│  ") + paddedTitle + ansis.hex(this.colors.muted)("  │"));
        this.write("log", ansis.hex(this.colors.muted)(`└─${line}─┘`));
    }

    /**
     * Starts a spinner and returns a `stop` function.
     * Always call `stop()` — use try/finally to guarantee cleanup.
     * Supports multiple concurrent loaders.
     *
     * @example
     * ```ts
     * const stop = logger.loader("Loading...")
     * try {
     *   await doWork()
     *   stop("Done!")
     * } catch (e) {
     *   stop("Failed")
     * }
     * ```
     */
    loader(message: string): (finalMessage?: string) => void {
        let stopped = false;
        const id = this.nextLoaderId++;

        // Register and initial render
        this.activeLoaders.set(id, { message, frame: SPINNER_FRAMES[0]! });
        const prefix = this.buildLine(this.formatTimestamp(), this.formatPrefix());
        process.stdout.write(`${prefix} ${ansis.hex(this.colors.warn)(SPINNER_FRAMES[0]!)} ${message}\n`);

        this.startRenderLoop();

        return (finalMessage?: string) => {
            if (stopped) return;
            stopped = true;

            this.activeLoaders.delete(id);

            // If no loaders left, stop the loop
            if (this.activeLoaders.size === 0) this.stopRenderLoop();

            // Clear all loader lines and redraw remaining
            const remaining = this.activeLoaders.size;
            const totalLines = remaining + 1; // +1 for this loader's line

            process.stdout.write(`\x1b[${totalLines}A`);
            process.stdout.write("\x1b[J");

            // Print final message for this loader
            const check = ansis.hex(this.colors.success)("✓");
            const p = this.buildLine(this.formatTimestamp(), this.formatPrefix());
            process.stdout.write(`${p} ${check} ${finalMessage ?? message}\n`);

            // Redraw remaining loaders
            for (const [, loader] of this.activeLoaders) {
                const frame = ansis.hex(this.colors.warn)(SPINNER_FRAMES[this.frameIndex]!);
                const pr = this.buildLine(this.formatTimestamp(), this.formatPrefix());
                process.stdout.write(`${pr} ${frame} ${loader.message}\n`);
            }
        };
    }

    /**
     * Renders a two-column startup banner.
     *
     * @example
     * ```ts
     * logger.banner({
     *   name: "STELLA",
     *   version: "1.0.0",
     *   devMode: true,
     *   poweredBy: "Powered by Vimcord v2.0.0",
     *   meta: { Guilds: "12", Prefix: "!", Uptime: "just now" }
     * })
     * ```
     */
    banner(options: BannerOptions): void {
        const { name, version, devMode = false, poweredBy, meta = {} } = options;

        const centerInside = (text: string, width: number): string => {
            const visible = stripAnsi(text).length;
            const total = Math.max(0, width - visible);
            const left = Math.floor(total / 2);
            const right = total - left;
            return " ".repeat(left) + text + " ".repeat(right);
        };

        const paddingLeft = 2;
        const maxWidthBottom = 58; // Max width of the bottom part of the ascii banner
        const _lines = [
            ansis.hex(this.colors.primary)("Powered by"),
            ansis.hex(this.colors.primary)("██╗   ██╗██╗███╗   ███╗ ██████╗ ██████╗ ██████╗ ██████╗"),
            ansis.hex(this.colors.primary)("██║   ██║██║████╗ ████║██╔════╝██╔═══██╗██╔══██╗██╔══██╗"),
            ansis.hex(this.colors.primary)("██║   ██║██║██╔████╔██║██║     ██║   ██║██████╔╝██║  ██║"),
            ansis.hex(this.colors.primary)("╚██╗ ██╔╝██║██║╚██╔╝██║██║     ██║   ██║██╔══██╗██║  ██║"),
            ansis.hex(this.colors.primary)(" ╚████╔╝ ██║██║ ╚═╝ ██║╚██████╗╚██████╔╝██║  ██║██████╔╝"),
            ansis.hex(this.colors.primary)("  ╚═══╝  ╚═╝╚═╝     ╚═╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝"),
            (() => {
                const str1 = "v2.0.0 · ";
                const str2 = ansis.bold.bgHex(this.colors.caution)("  DEV_MODE ⚠  ");
                const padding = maxWidthBottom - str1.length - stripAnsi(str2).length - paddingLeft;
                return ansis.bgHex(this.colors.primary).black(`${" ".repeat(padding)}${str1}${str2}`);
            })(),
            ansis.hex(this.colors.primary)(`${"│".padEnd(maxWidthBottom - 3)}│`),
            ...Object.entries(meta).map(([k, v]) => {
                const keyStyled = ansis.dim.hex(this.colors.muted)(k);
                const valStyled = ansis.hex(this.colors.muted)(v);
                const remainingLength =
                    maxWidthBottom - paddingLeft - stripAnsi(keyStyled).length - stripAnsi(valStyled).length - 6;
                return `${ansis.hex(this.colors.primary)("│")}  ${keyStyled}${" ".repeat(remainingLength)}${valStyled}  ${ansis.hex(this.colors.primary)("│")}`;
            }),
            ansis.hex(this.colors.primary)(`${"│".padEnd(maxWidthBottom - 3)}│`),
            (() => {
                const str = `${ansis.hex(this.colors.primary)("╰──")}${ansis.hex(this.colors.primary)("i0(")} ${ansis.bold(name)} ${ansis.hex(this.colors.muted)(`v${version}`)} ${ansis.hex(this.colors.primary)(")")}`;
                const remainingLength = maxWidthBottom - paddingLeft - stripAnsi(str).length - 1;
                return `${str}${ansis.hex(this.colors.primary)(`─`.repeat(remainingLength))}${ansis.hex(this.colors.primary)("╯")}`;
            })()
        ];

        this.write("log", `\n${_lines.map(l => `${" ".repeat(paddingLeft)}${l}`).join("\n")}\n`);
        this.write(
            "log",
            centerInside(
                `🚀 ${ansis.bold.hex(this.colors.primary)("CLI")} ~ ${ansis.bold("Type /help to view available commands")}`,
                maxWidthBottom
            )
        );
    }

    // --- Configuration ---

    setPrefix(prefix: string | null): this {
        this.prefix = prefix;
        return this;
    }

    setPrefixEmoji(emoji: string | null): this {
        this.prefixEmoji = emoji;
        return this;
    }

    setMinLevel(level: LogLevel): this {
        this.minLevel = level;
        return this;
    }

    setShowTimestamp(show: boolean): this {
        this.showTimestamp = show;
        return this;
    }

    setColors(colors: Partial<ColorScheme>): this {
        this.colors = { ...this.colors, ...colors };
        return this;
    }

    /** Creates a child logger that inherits this logger's config with overrides */
    child(options: LoggerOptions): Logger {
        return new Logger({
            prefix: this.prefix ?? undefined,
            prefixEmoji: this.prefixEmoji ?? undefined,
            minLevel: this.minLevel,
            showTimestamp: this.showTimestamp,
            colors: { ...this.colors, ...options.colors },
            ...options
        });
    }
}
