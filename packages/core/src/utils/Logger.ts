import ansis from "ansis";

// --- Types ---

/** Colors used by logger output. */
export interface ColorScheme {
    /** Brand and prefix color. */
    primary: string;
    /** Success message color. */
    success: string;
    /** Warning message color. */
    warn: string;
    /** Development-mode caution color. */
    caution: string;
    /** Error message color. */
    error: string;
    /** Secondary text color. */
    muted: string;
    /** Informational message color. */
    info: string;
}

/** Logger display and verbosity options. */
export interface LoggerOptions {
    /** Prefix shown before each normal log entry. */
    prefix?: string | null;
    /** Enables diagnostic `debug()` output. @default false */
    verbose?: boolean;
    /** Color overrides. */
    colors?: Partial<ColorScheme>;
}

/** Optional automatic message cycling for a loader. */
export interface LoaderOptions {
    /** Returns the next loader message. */
    cycle?: () => string;
    /** How often to call `cycle` in milliseconds. @default 3000 */
    interval?: number;
}

/** Controls an active terminal loader. Every completion method is idempotent. */
export interface LoaderHandle {
    /** Updates the active loader message. */
    update(message: string): void;
    /** Stops the loader and optionally writes a normal final message. */
    stop(finalMessage?: string): void;
    /** Stops the loader with a success message. */
    succeed(finalMessage?: string): void;
    /** Stops the loader with an error message and optional error details. */
    fail(finalMessage: string, error?: unknown): void;
}

type LoaderEntry = {
    cycle?: () => string;
    cycleInterval: number;
    lastCycleAt: number;
    message: string;
};

type LoaderResolution = "stop" | "success" | "error";

// --- Constants ---

/** Default logger color scheme. */
export const DEFAULT_COLORS: ColorScheme = {
    primary: "#5865F2",
    success: "#57F287",
    warn: "#FEE75C",
    caution: "#FF9D00",
    error: "#ED4245",
    muted: "#747F8D",
    info: "#87CEEB"
};

// Keep the one loader animation local instead of shipping a full spinner catalog.
const SPINNER_FRAMES = ["⠀", "⠂", "⠌", "⡑", "⢕", "⢝", "⣫", "⣟", "⣿", "⣟", "⣫", "⢝", "⢕", "⡑", "⠌", "⠂", "⠀"];
const SPINNER_INTERVAL = 100;
const DEFAULT_LOADER_CYCLE_INTERVAL_MS = 3_000;

// --- Helpers ---

/** Strips ANSI color sequences from a string. */
export function stripAnsi(str: string): string {
    return str.replace(/\x1b\[[0-9;]*m/g, "");
}

// --- Logger ---

/** Timestamped console logger with colors, optional diagnostics, and live terminal loaders. */
export class Logger {
    /** Active logger configuration. */
    readonly options: Required<Omit<LoggerOptions, "colors">> & { colors: ColorScheme };

    private readonly activeLoaders = new Map<number, LoaderEntry>();
    private nextLoaderId = 0;
    private renderInterval: ReturnType<typeof setInterval> | null = null;
    private frameIndex = 0;

    /** Creates a logger with optional prefix, verbosity, and color overrides. */
    constructor(options: LoggerOptions = {}) {
        this.options = {
            prefix: null,
            verbose: false,
            ...options,
            colors: { ...DEFAULT_COLORS, ...options.colors }
        };
    }

    private formatPrefix(): string {
        const { prefix, colors } = this.options;
        return prefix ? ansis.bold.hex(colors.primary)(prefix) : "";
    }

    private formatLabel(type: "debug" | "info" | "success" | "warn" | "error"): string {
        const { colors } = this.options;

        switch (type) {
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

    private formatLoaderLine(loader: LoaderEntry): string {
        const frame = ansis.hex(this.options.colors.muted)(SPINNER_FRAMES[this.frameIndex]!);
        return `${this.timestamp()} ${this.formatPrefix()} ${frame} ${loader.message}`;
    }

    private updateLoaderMessages(now = Date.now()): void {
        for (const loader of this.activeLoaders.values()) {
            if (!loader.cycle || now - loader.lastCycleAt < loader.cycleInterval) continue;

            loader.message = loader.cycle();
            loader.lastCycleAt = now;
        }
    }

    private clearLoaderLines(count = this.activeLoaders.size): void {
        if (process.stdout.isTTY === true && count > 0) process.stdout.write(`\x1b[${count}A\x1b[J`);
    }

    private renderLoaders(): void {
        if (process.stdout.isTTY !== true || !this.activeLoaders.size) return;

        this.updateLoaderMessages();
        for (const loader of this.activeLoaders.values()) process.stdout.write(`${this.formatLoaderLine(loader)}\n`);
    }

    private startLoaderRenderer(): void {
        if (this.renderInterval) return;

        this.renderInterval = setInterval(() => {
            if (!this.activeLoaders.size) return;

            this.clearLoaderLines();
            this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length;
            this.renderLoaders();
        }, SPINNER_INTERVAL);
        this.renderInterval.unref?.();
    }

    private stopLoaderRenderer(): void {
        if (this.activeLoaders.size || !this.renderInterval) return;

        clearInterval(this.renderInterval);
        this.renderInterval = null;
        this.frameIndex = 0;
    }

    private writeLoaderResolution(type: LoaderResolution, message: string, error?: unknown): void {
        if (process.stdout.isTTY !== true) {
            if (type === "success") this.success(message);
            else if (type === "error") this.error(message, error);
            else if (message) this.log(message);
            return;
        }

        if (type === "success") {
            const check = ansis.hex(this.options.colors.success)("✓");
            process.stdout.write(`${this.timestamp()} ${this.formatPrefix()} ${check} ${message}\n`);
        } else if (type === "error") {
            process.stderr.write(
                `${this.timestamp()} ${this.formatPrefix()} ${this.formatLabel("error")} ${ansis.hex(this.options.colors.error)(message)}\n`
            );
            if (error !== undefined) process.stderr.write(`${ansis.dim(this.formatError(error))}\n`);
        } else if (message) {
            process.stdout.write(`${this.timestamp()} ${this.formatPrefix()} ${message}\n`);
        }
    }

    private formatError(error: unknown): string {
        if (error instanceof Error) return error.stack ?? error.message;
        return typeof error === "string" ? error : String(error);
    }

    /** Returns a colored `[HH:mm:ss]` timestamp. */
    protected timestamp(): string {
        const time = new Date().toLocaleTimeString("en-US", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        });

        return ansis.hex(this.options.colors.muted)(`[${time}]`);
    }

    /** Writes directly to a console stream while preserving active TTY loaders. */
    protected write(stream: "log" | "warn" | "error", ...data: unknown[]): void {
        this.clearLoaderLines();
        console[stream](...data);
        this.renderLoaders();
    }

    /** Logs unfiltered application output. */
    log(...data: unknown[]): void {
        this.write("log", this.timestamp(), this.formatPrefix(), ...data);
    }

    /** Logs diagnostic output when verbose mode is enabled. */
    debug(message: string, ...data: unknown[]): void {
        if (!this.options.verbose) return;
        this.write("log", this.timestamp(), this.formatPrefix(), this.formatLabel("debug"), ansis.dim(message), ...data);
    }

    /** Logs informational output. */
    info(...data: unknown[]): void {
        this.write("log", this.timestamp(), this.formatPrefix(), this.formatLabel("info"), ...data);
    }

    /** Logs successful output. */
    success(message: string, ...data: unknown[]): void {
        this.write(
            "log",
            this.timestamp(),
            this.formatPrefix(),
            this.formatLabel("success"),
            ansis.hex(this.options.colors.success)(message),
            ...data
        );
    }

    /** Logs warning output to stderr. */
    warn(message: string, ...data: unknown[]): void {
        this.write(
            "warn",
            this.timestamp(),
            this.formatPrefix(),
            this.formatLabel("warn"),
            ansis.hex(this.options.colors.warn)(message),
            ...data
        );
    }

    /** Logs error output and preserves Error stack details. */
    error(message: string, error?: unknown, ...data: unknown[]): void {
        this.write(
            "error",
            this.timestamp(),
            this.formatPrefix(),
            this.formatLabel("error"),
            ansis.hex(this.options.colors.error)(message),
            ...data
        );
        if (error !== undefined) this.write("error", ansis.dim(this.formatError(error)));
    }

    /** Starts a loader and returns explicit lifecycle controls. */
    loader(message: string, options: LoaderOptions = {}): LoaderHandle {
        const id = this.nextLoaderId++;
        const loader: LoaderEntry = {
            cycle: options.cycle,
            cycleInterval: options.interval ?? DEFAULT_LOADER_CYCLE_INTERVAL_MS,
            lastCycleAt: Date.now(),
            message
        };
        let stopped = false;

        this.activeLoaders.set(id, loader);

        if (process.stdout.isTTY === true) {
            process.stdout.write(`${this.formatLoaderLine(loader)}\n`);
            this.startLoaderRenderer();
        } else {
            this.log(message);
        }

        const finish = (type: LoaderResolution, finalMessage?: string, error?: unknown): void => {
            if (stopped) return;
            stopped = true;

            const loaderCount = this.activeLoaders.size;
            this.clearLoaderLines(loaderCount);
            this.activeLoaders.delete(id);
            this.stopLoaderRenderer();

            const resolvedMessage = finalMessage ?? loader.message;
            this.writeLoaderResolution(type, resolvedMessage, error);
            this.renderLoaders();
        };

        return {
            update: nextMessage => {
                if (stopped) return;

                this.clearLoaderLines();
                loader.message = nextMessage;
                loader.lastCycleAt = Date.now();
                this.renderLoaders();
            },
            stop: finalMessage => finish("stop", finalMessage ?? ""),
            succeed: finalMessage => finish("success", finalMessage),
            fail: (finalMessage, error) => finish("error", finalMessage, error)
        };
    }

    /** Enables or disables diagnostic logging. */
    setVerbose(verbose: boolean): this {
        this.options.verbose = verbose;
        return this;
    }
}
