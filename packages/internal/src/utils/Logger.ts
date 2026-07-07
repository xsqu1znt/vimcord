import ansis from "ansis";
import { spinners } from "unicode-animations";

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
    /** Color scheme to use. */
    colors?: Partial<ColorScheme>;
};

export type LoaderOptions = {
    /** Returns the next loader message while the spinner is active. */
    cycle?: () => string;
    /** How often `cycle` should be called in milliseconds. */
    interval?: number;
};

type LoaderEntry = {
    cycle?: () => string;
    cycleInterval: number;
    lastCycleAt: number;
    message: string;
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

const SPINNER_FRAMES = spinners.breathe.frames.map(f => ansis.hex(DEFAULT_COLORS.muted)(f));
const SPINNER_INTERVAL = spinners.breathe.interval;
const DEFAULT_LOADER_CYCLE_INTERVAL_MS = 3_000;

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

/** Timestamped console logger with level filtering, colors, and optional live terminal loaders. */
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
            ...options,
            colors: { ...DEFAULT_COLORS, ...options.colors }
        };
    }

    private formatPrefix(): string {
        const { prefixEmoji, prefix, colors } = this.options;
        if (!prefix) return "";
        const emoji = prefixEmoji ? `${prefixEmoji.trimEnd()} ` : "";
        return ansis.bold.hex(colors.primary)(`${emoji}${prefix}`);
    }

    private formatLevel(level: LogLevel): string {
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

    /** Checks if the given log level should be logged. */
    private shouldLog(level: LogLevel): boolean {
        return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.options.minLevel];
    }

    /** Returns a colored `[HH:mm:ss]` timestamp for log prefixes. */
    timestamp(): string {
        const { colors } = this.options;
        const now = new Date();
        const time = now.toLocaleTimeString("en-US", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        });

        return ansis.hex(colors.muted)(`[${time}]`);
    }

    /** Writes a line using the builtin `console`, keeping active TTY loaders pinned below the new output. */
    write(stream: "log" | "warn" | "error", ...data: unknown[]): void {
        const loaderCount = this.activeLoaders.size;
        const shouldRedrawLoaders = process.stdout.isTTY === true && loaderCount > 0;

        // TTY loaders are already printed at the bottom. Move up and clear them before writing the real log line.
        if (shouldRedrawLoaders) process.stdout.write(`\x1b[${loaderCount}A\x1b[J`);

        console[stream](...data);

        if (!shouldRedrawLoaders) return;

        const now = Date.now();
        const frame = SPINNER_FRAMES[this.frameIndex]!;

        // Redraw loaders after normal logs so they remain the last visible lines in the terminal.
        for (const [, loader] of this.activeLoaders) {
            if (loader.cycle && now - loader.lastCycleAt >= loader.cycleInterval) {
                loader.message = loader.cycle();
                loader.lastCycleAt = now;
            }

            process.stdout.write(`${this.timestamp()} ${this.formatPrefix()} ${frame} ${loader.message}\n`);
        }
    }

    /** Logs a message without level filtering. */
    log(...data: unknown[]): void {
        this.write("log", this.timestamp(), this.formatPrefix(), ...data);
    }

    logVerbose(...data: unknown[]): void {
        if (!this.options.verbose) return;
        this.log(...data);
    }

    debug(message: string, ...data: unknown[]): void {
        if (!this.shouldLog("debug")) return;
        this.write("log", this.timestamp(), this.formatPrefix(), this.formatLevel("debug"), ansis.dim(message), ...data);
    }

    debugVerbose(message: string, ...data: unknown[]): void {
        if (!this.options.verbose) return;
        this.debug(message, ...data);
    }

    info(...data: unknown[]): void {
        if (!this.shouldLog("info")) return;
        this.write("log", this.timestamp(), this.formatPrefix(), this.formatLevel("info"), ...data);
    }

    infoVerbose(...data: unknown[]): void {
        if (!this.options.verbose) return;
        this.info(...data);
    }

    success(message: string, ...data: unknown[]): void {
        if (!this.shouldLog("success")) return;
        this.write(
            "log",
            this.timestamp(),
            this.formatPrefix(),
            this.formatLevel("success"),
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
            this.timestamp(),
            this.formatPrefix(),
            this.formatLevel("warn"),
            ansis.hex(this.options.colors.warn)(message),
            ...data
        );
    }

    warnVerbose(message: string, ...data: unknown[]): void {
        if (!this.options.verbose) return;
        this.warn(message, ...data);
    }

    error(message: string, error?: Error, ...data: unknown[]): void {
        if (!this.shouldLog("error")) return;
        this.write(
            "error",
            this.timestamp(),
            this.formatPrefix(),
            this.formatLevel("error"),
            ansis.hex(this.options.colors.error)(message),
            ...data
        );
        if (error?.stack) {
            this.write("error", ansis.dim(error.stack));
        }
    }

    errorVerbose(message: string, error?: Error, ...data: unknown[]): void {
        if (!this.options.verbose) return;
        this.error(message, error, ...data);
    }

    // --- Structured Output ---
    /** @deprecated */
    table(title: string, data: Record<string, unknown>): void {
        const { colors } = this.options;
        this.write("log", this.timestamp(), this.formatPrefix(), ansis.bold(title));
        for (const [key, value] of Object.entries(data)) {
            const formattedKey = padVisible(ansis.hex(colors.warn)(`  ${key}`), 25);
            const formattedValue = ansis.hex(colors.muted)(String(value));
            this.write("log", `${formattedKey} ${formattedValue}`);
        }
    }

    // TODO: Make this prettier, replace it with `header` using the textThroughLine helper
    /** @deprecated */
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
     * Starts a loader and returns a `stop` function.
     *
     * In an interactive TTY, loaders render as live spinners pinned below regular logs. In hosted logs, CI,
     * Docker logs, and other non-TTY streams, loaders degrade to normal start/final lines without ANSI cursor codes.
     * Always call `stop()` with `try/finally` so the render loop can be cleaned up.
     *
     * @param message Initial loader message.
     * @param cycleOrOptions Optional message cycle function or options object.
     * @param interval How often to call the cycle function in milliseconds. Defaults to `3000`.
     * @returns A function that stops the loader. Pass `clear: true` to suppress the success line.
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
     *
     * @example
     * ```ts
     * const stop = logger.loader("Starting...", () => "Still starting...", 1000)
     * ```
     */
    loader(message: string, cycle?: () => string, interval?: number): (finalMessage?: string, clear?: boolean) => void;
    loader(message: string, options?: LoaderOptions): (finalMessage?: string, clear?: boolean) => void;
    loader(
        message: string,
        cycleOrOptions?: LoaderOptions | (() => string),
        interval: number = DEFAULT_LOADER_CYCLE_INTERVAL_MS
    ): (finalMessage?: string, clear?: boolean) => void {
        const { colors } = this.options;
        const cycle = typeof cycleOrOptions === "function" ? cycleOrOptions : cycleOrOptions?.cycle;
        const cycleInterval = typeof cycleOrOptions === "function" ? interval : (cycleOrOptions?.interval ?? interval);
        let stopped = false;
        const id = this.nextLoaderId++;
        const prefix = `${this.timestamp()} ${this.formatPrefix()}`;

        this.activeLoaders.set(id, { cycle, cycleInterval, lastCycleAt: Date.now(), message });

        if (process.stdout.isTTY !== true) {
            this.write("log", prefix, message);
        } else {
            process.stdout.write(`${prefix} ${SPINNER_FRAMES[0]!} ${message}\n`);

            if (!this.renderInterval) {
                this.renderInterval = setInterval(() => {
                    const loaderCount = this.activeLoaders.size;
                    if (!loaderCount) return;

                    this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length;

                    // Replace the existing loader block in-place. This only runs for real TTY streams.
                    process.stdout.write(`\x1b[${loaderCount}A\x1b[J`);

                    const now = Date.now();
                    const frame = SPINNER_FRAMES[this.frameIndex]!;

                    for (const [, loader] of this.activeLoaders) {
                        if (loader.cycle && now - loader.lastCycleAt >= loader.cycleInterval) {
                            loader.message = loader.cycle();
                            loader.lastCycleAt = now;
                        }

                        process.stdout.write(`${this.timestamp()} ${this.formatPrefix()} ${frame} ${loader.message}\n`);
                    }
                }, SPINNER_INTERVAL);
            }
        }

        return (finalMessage?: string, clear = false) => {
            if (stopped) return;
            stopped = true;

            this.activeLoaders.delete(id);

            if (this.activeLoaders.size === 0 && this.renderInterval) {
                clearInterval(this.renderInterval);
                this.renderInterval = null;
                this.frameIndex = 0;
            }

            if (process.stdout.isTTY !== true) {
                if (clear) {
                    if (finalMessage) this.write("log", finalMessage);
                    return;
                }

                this.write(
                    "log",
                    `${this.timestamp()} ${this.formatPrefix()}`,
                    ansis.hex(colors.success)("✓"),
                    finalMessage ?? message
                );
                return;
            }

            // Clear the stopped loader plus any remaining loaders that were printed beneath it.
            process.stdout.write(`\x1b[${this.activeLoaders.size + 1}A\x1b[J`);

            if (clear) {
                if (finalMessage) process.stdout.write(`${finalMessage}\n`);
            } else {
                const check = ansis.hex(colors.success)("✓");
                process.stdout.write(`${this.timestamp()} ${this.formatPrefix()} ${check} ${finalMessage ?? message}\n`);
            }

            const frame = SPINNER_FRAMES[this.frameIndex]!;
            for (const [, loader] of this.activeLoaders) {
                process.stdout.write(`${this.timestamp()} ${this.formatPrefix()} ${frame} ${loader.message}\n`);
            }
        };
    }

    /** Sets the minimum log level required for level-filtered messages. */
    setLevel(level: LogLevel): void {
        this.options.minLevel = level;
    }

    /** Enables or disables verbose-only log methods. */
    setVerbose(verbose: boolean): void {
        this.options.verbose = verbose;
    }
}
