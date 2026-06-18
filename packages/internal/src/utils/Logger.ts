import ansis from "ansis";
import spinners from "unicode-animations";

// --- Types ---

export type LogLevel = "debug" | "info" | "success" | "warn" | "error";

export type ColorScheme = {
    primary: string;
    success: string;
    warn: string;
    caution: string;
    error: string;
    muted: string;
    info: string;
    text: string;
};

export type LoggerOptions = {
    /** Emoji shown before the prefix. */
    prefixEmoji?: string | null;
    /** Prefix label shown before each message. */
    prefix?: string | null;
    /**
     * Minimum log level to output.
     * @default "debug"
     */
    minLevel?: LogLevel;
    /**
     * Log verbose messages.
     * @default false
     */
    verbose?: boolean;
    /**
     * Show timestamp before each message.
     * @default true
     */
    showTimestamp?: boolean;
    /** Color scheme to use. */
    colors?: Partial<ColorScheme>;
};

type LoaderEntry = {
    getMessage?: () => string;
    message: string;
    messageUpdatedAt: number;
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

export const DEFAULT_COLORS: ColorScheme = {
    primary: "#5865F2",
    success: "#57F287",
    warn: "#FEE75C",
    caution: "#FF9D00",
    error: "#ED4245",
    muted: "#747F8D",
    info: "#87CEEB",
    text: "#FFFFFF"
};

let { frames: SPINNER_FRAMES, interval: SPINNER_INTERVAL } = spinners.breathe;
SPINNER_FRAMES = SPINNER_FRAMES.map(f => ansis.hex(DEFAULT_COLORS.muted)(f));
const LOADER_MESSAGE_UPDATE_INTERVAL_MS = 3_000;

// --- Helpers ---

/** Strips ANSI escape codes from a string for accurate length measurement */
export function stripAnsi(str: string): string {
    return str.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Pads a string by its visible length, ignoring ANSI codes */
function padVisible(str: string, length: number): string {
    const visible = stripAnsi(str).length;
    return str + " ".repeat(Math.max(0, length - visible));
}

// --- Logger ---

export class Logger {
    readonly options: Required<LoggerOptions> & { colors: ColorScheme };

    private activeLoaders: Map<number, LoaderEntry> = new Map();
    private nextLoaderId = 0;
    private renderInterval: ReturnType<typeof setInterval> | null = null;
    private frameIndex = 0;

    constructor(options: LoggerOptions = {}) {
        this.options = {
            prefix: null,
            prefixEmoji: null,
            minLevel: "debug",
            verbose: false,
            showTimestamp: true,
            ...options,
            colors: { ...DEFAULT_COLORS, ...options.colors }
        };
    }

    // --- Loader Rendering ---

    private startLoaderRenderLoop(): void {
        if (this.renderInterval) return;
        this.renderInterval = setInterval(() => {
            this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length;

            // Redraw all loaders in one pass
            const count = this.activeLoaders.size;
            if (count === 0) return;

            // Move cursor up to first loader line
            process.stdout.write(`\x1b[${count}A`);

            for (const [, loader] of this.activeLoaders) {
                this.updateLoaderMessage(loader);

                const frame = SPINNER_FRAMES[this.frameIndex]!;
                const prefix = this.buildLine(this.fmtTimestamp(), this.fmtPrefix());
                process.stdout.write(`\r\x1b[K${prefix} ${frame} ${loader.message}\n`);
            }
        }, SPINNER_INTERVAL);
    }

    private stopLoaderRenderLoop(): void {
        if (!this.renderInterval) return;
        clearInterval(this.renderInterval);
        this.renderInterval = null;
        this.frameIndex = 0;
    }

    private clearLoaders(): void {
        const count = this.activeLoaders.size;
        if (count === 0) return;
        process.stdout.write(`\x1b[${count}A`);
        process.stdout.write("\x1b[J");
    }

    private redrawLoaders(): void {
        for (const [, loader] of this.activeLoaders) {
            this.updateLoaderMessage(loader);

            const frame = ansis.hex(this.options.colors.warn)(loader.frame);
            const prefix = this.buildLine(this.fmtTimestamp(), this.fmtPrefix());
            process.stdout.write(`${prefix} ${frame} ${loader.message}\n`);
        }
    }

    private updateLoaderMessage(loader: LoaderEntry): void {
        if (!loader.getMessage) return;

        const now = Date.now();
        if (now - loader.messageUpdatedAt < LOADER_MESSAGE_UPDATE_INTERVAL_MS) return;

        loader.message = loader.getMessage();
        loader.messageUpdatedAt = now;
    }

    // --- Formatting ---

    protected fmtTimestamp(): string {
        const { showTimestamp, colors } = this.options;
        if (!showTimestamp) return "";
        const now = new Date();
        const time = now.toLocaleTimeString("en-US", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        });
        return ansis.hex(colors.muted)(`[${time}]`);
    }

    protected fmtPrefix(): string {
        const { prefixEmoji, prefix, colors } = this.options;
        if (!prefix) return "";
        const emoji = prefixEmoji ? `${prefixEmoji} ` : "";
        return ansis.bold.hex(colors.primary)(`${emoji}${prefix}`);
    }

    protected fmtLevel(level: LogLevel): string {
        const { colors } = this.options;
        switch (level) {
            case "debug":
                return ansis.hex(colors.muted)("DEBUG");
            case "info":
                return ansis.hex(colors.info)("INFO");
            case "success":
                return ansis.bold.hex(colors.success)("✓ SUCCESS");
            case "warn":
                return ansis.bold.hex(colors.warn)("⚠ WARN");
            case "error":
                return ansis.bold.hex(colors.error)("✕ ERROR");
        }
    }

    protected buildLine(...parts: (string | undefined)[]): string {
        return parts.filter(Boolean).join(" ");
    }

    // --- Core ---

    /** Checks if the given log level should be logged. */
    protected shouldLog(level: LogLevel): boolean {
        return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.options.minLevel];
    }

    /** Writes a line using the builtin `console`. */
    protected write(stream: "log" | "warn" | "error", ...data: unknown[]): void {
        const hasLoaders = this.activeLoaders.size > 0;
        if (hasLoaders) this.clearLoaders();
        console[stream](...data);
        if (hasLoaders) this.redrawLoaders();
    }

    // --- Public Log Methods ---

    log(message: string, ...data: unknown[]): void {
        this.write("log", this.buildLine(this.fmtTimestamp(), this.fmtPrefix()), message, ...data);
    }

    logVerbose(message: string, ...data: unknown[]): void {
        if (!this.options.verbose) return;
        this.log(message, data);
    }

    debug(message: string, ...data: unknown[]): void {
        if (!this.shouldLog("debug")) return;
        this.write(
            "log",
            this.buildLine(this.fmtTimestamp(), this.fmtPrefix(), this.fmtLevel("debug")),
            ansis.dim(message),
            ...data
        );
    }

    debugVerbose(message: string, ...data: unknown[]): void {
        if (!this.options.verbose) return;
        this.debug(message, ...data);
    }

    info(message: string, ...data: unknown[]): void {
        if (!this.shouldLog("info")) return;
        this.write("log", this.buildLine(this.fmtTimestamp(), this.fmtPrefix(), this.fmtLevel("info")), message, ...data);
    }

    infoVerbose(message: string, ...data: unknown[]): void {
        if (!this.options.verbose) return;
        this.info(message, ...data);
    }

    success(message: string, ...data: unknown[]): void {
        if (!this.shouldLog("success")) return;
        this.write(
            "log",
            this.buildLine(this.fmtTimestamp(), this.fmtPrefix(), this.fmtLevel("success")),
            ansis.hex(this.options.colors.success)(message),
            ...data
        );
    }

    successVerbose(message: string, ...data: unknown[]): void {
        if (!this.options.verbose) return;
        this.success(message, ...data);
    }

    warn(message: string, ...data: unknown[]): void {
        if (!this.shouldLog("warn")) return;
        this.write(
            "warn",
            this.buildLine(this.fmtTimestamp(), this.fmtPrefix(), this.fmtLevel("warn")),
            ansis.hex(this.options.colors.warn)(message),
            ...data
        );
    }

    warnVerbose(message: string, ...data: unknown[]): void {
        if (!this.options.verbose) return;
        this.warn(message, data);
    }

    error(message: string, error?: Error, ...data: unknown[]): void {
        if (!this.shouldLog("error")) return;
        this.write(
            "error",
            this.buildLine(this.fmtTimestamp(), this.fmtPrefix(), this.fmtLevel("error")),
            ansis.hex(this.options.colors.error)(message),
            ...data
        );
        if (error?.stack) {
            this.write("error", ansis.dim(error.stack));
        }
    }

    errorVerbose(message: string, error?: Error, ...data: unknown[]): void {
        if (!this.options.verbose) return;
        this.error(message, error, data);
    }

    // --- Structured Output ---

    table(title: string, data: Record<string, unknown>): void {
        const { colors } = this.options;
        this.write("log", this.buildLine(this.fmtTimestamp(), this.fmtPrefix()), ansis.bold(title));
        for (const [key, value] of Object.entries(data)) {
            const formattedKey = padVisible(ansis.hex(colors.warn)(`  ${key}`), 25);
            const formattedValue = ansis.hex(colors.muted)(String(value));
            this.write("log", `${formattedKey} ${formattedValue}`);
        }
    }

    // TODO: Make this prettier, replace it with `header` using the textThroughLine helper
    section(title: string): void {
        const { colors } = this.options;
        const titleVisible = stripAnsi(title);
        const width = Math.max(30, titleVisible.length + 4);
        const line = "─".repeat(width);
        const paddedTitle = padVisible(ansis.bold.hex(colors.text)(title), width);

        this.write("log", ansis.hex(colors.muted)(`\n┌─${line}─┐`));
        this.write("log", ansis.hex(colors.muted)("│  ") + paddedTitle + ansis.hex(colors.muted)("  │"));
        this.write("log", ansis.hex(colors.muted)(`└─${line}─┘`));
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
    loader(message: string, getMessage?: () => string): (finalMessage?: string, clear?: boolean) => void {
        const { colors } = this.options;

        let stopped = false;
        const id = this.nextLoaderId++;

        // Register and initial render
        this.activeLoaders.set(id, { getMessage, message, messageUpdatedAt: Date.now(), frame: SPINNER_FRAMES[0]! });
        const prefix = this.buildLine(this.fmtTimestamp(), this.fmtPrefix());
        process.stdout.write(`${prefix} ${SPINNER_FRAMES[0]!} ${message}\n`);

        this.startLoaderRenderLoop();

        return (finalMessage?: string, clear = false) => {
            if (stopped) return;
            stopped = true;

            this.activeLoaders.delete(id);

            // If no loaders left, stop the loop
            if (this.activeLoaders.size === 0) this.stopLoaderRenderLoop();

            // Clear all loader lines and redraw remaining
            const remaining = this.activeLoaders.size;
            const totalLines = remaining + 1; // +1 for this loader's line

            process.stdout.write(`\x1b[${totalLines}A`);
            process.stdout.write("\x1b[J");

            // Print final message for this loader
            if (clear) {
                if (finalMessage) process.stdout.write(`${finalMessage}\n`);
            } else {
                const check = ansis.hex(colors.success)("✓");
                const p = this.buildLine(this.fmtTimestamp(), this.fmtPrefix());
                process.stdout.write(`${p} ${check} ${finalMessage ?? message}\n`);
            }

            // Redraw remaining loaders
            for (const [, loader] of this.activeLoaders) {
                const frame = SPINNER_FRAMES[this.frameIndex]!;
                const pr = this.buildLine(this.fmtTimestamp(), this.fmtPrefix());
                process.stdout.write(`${pr} ${frame} ${loader.message}\n`);
            }
        };
    }

    // --- Configuration ---

    setLevel(level: LogLevel) {
        this.options.minLevel = level;
    }

    setVerbose(verbose: boolean) {
        this.options.verbose = verbose;
    }

    /** Creates a child logger that inherits this logger's config with overrides */
    clone(options: LoggerOptions): Logger {
        return new Logger({
            prefix: this.options.prefix ?? undefined,
            prefixEmoji: this.options.prefixEmoji ?? undefined,
            minLevel: this.options.minLevel,
            showTimestamp: this.options.showTimestamp,
            colors: { ...this.options.colors, ...options.colors },
            ...options
        });
    }
}
