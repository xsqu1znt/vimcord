import chalk from "chalk";

export interface LoggerOptions {
    colors?: Partial<typeof LOGGER_COLORS>;
    prefix?: string | null;
    prefixEmoji?: string | null;
    minLevel?: LogLevel;
    /** @defaultValue `true` */
    showTimestamp?: boolean;
}

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    SUCCESS = 2,
    WARN = 3,
    ERROR = 4
}

export const LOGGER_COLORS = {
    primary: "#5865F2",
    success: "#57F287",
    warn: "#FEE75C",
    danger: "#ED4245",
    muted: "#747F8D",
    text: "#FFFFFF"
};

/** Reusable functions for using `console.log()`, but in 4k ultra HD retrocolor */
export class Logger {
    private logPrefixEmoji: string | null;
    private logPrefix: string | null;
    private minLevel: LogLevel;
    private showTimestamp: boolean;
    private colorScheme: typeof LOGGER_COLORS;

    constructor(options?: LoggerOptions) {
        const { prefixEmoji = null, prefix = null, minLevel = LogLevel.DEBUG, showTimestamp = true } = options || {};

        this.logPrefixEmoji = prefixEmoji;
        this.logPrefix = prefix;
        this.minLevel = minLevel;
        this.showTimestamp = showTimestamp;

        this.colorScheme = {
            ...LOGGER_COLORS,
            ...options?.colors
        };
    }

    protected formatTimestamp(): string {
        if (!this.showTimestamp) return "";
        const now = new Date();
        const time = now.toLocaleTimeString("en-US", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        });
        return chalk.hex(this.colorScheme.muted)(`[${time}]`);
    }

    protected formatPrefix(): string {
        if (!this.logPrefix) return "";
        return chalk.bold.hex(this.colorScheme.primary)(
            `${this.logPrefixEmoji ? `${this.logPrefixEmoji} ` : ""}${this.logPrefix}`
        );
    }

    protected shouldLog(level: LogLevel): boolean {
        return level >= this.minLevel;
    }

    get prefixEmoji() {
        return this.logPrefixEmoji;
    }

    get prefix() {
        return this.logPrefix;
    }

    get colors() {
        return this.colorScheme;
    }

    extend<Extra extends Record<string, (...args: any) => void>>(extras: Extra & ThisType<Logger>): Logger & Extra {
        for (const [key, fn] of Object.entries(extras as any)) {
            if (typeof fn === "function") {
                (this as any)[key] = function (...args: any[]) {
                    return fn.call(this, ...args);
                };
            }
        }

        return this as any as Logger & Extra;
    }

    setPrefix(prefix: string | null): this {
        this.logPrefix = prefix;
        return this;
    }

    setPrefixEmoji(prefixEmoji: string | null): this {
        this.logPrefixEmoji = prefixEmoji;
        return this;
    }

    setMinLevel(minLevel: LogLevel): this {
        this.minLevel = minLevel;
        return this;
    }

    setShowTimestamp(show: boolean): this {
        this.showTimestamp = show;
        return this;
    }

    setColors(colors: Partial<typeof LOGGER_COLORS>): this {
        this.colorScheme = {
            ...LOGGER_COLORS,
            ...colors
        };
        return this;
    }

    log(message: string, ...args: any[]): void {
        console.log(this.formatTimestamp(), this.formatPrefix(), message, ...args);
    }

    debug(message: string, ...args: any[]): void {
        if (!this.shouldLog(LogLevel.DEBUG)) return;
        console.log(
            this.formatTimestamp(),
            this.formatPrefix(),
            chalk.hex(this.colorScheme.muted)("DEBUG"),
            chalk.dim(message),
            ...args
        );
    }

    info(message: string, ...args: any[]): void {
        if (!this.shouldLog(LogLevel.INFO)) return;
        console.log(this.formatTimestamp(), this.formatPrefix(), chalk.hex("#87CEEB")("INFO"), message, ...args);
    }

    success(message: string, ...args: any[]): void {
        if (!this.shouldLog(LogLevel.SUCCESS)) return;
        console.log(
            this.formatTimestamp(),
            this.formatPrefix(),
            chalk.bold.hex(this.colorScheme.success)("✓ SUCCESS"),
            chalk.hex(this.colorScheme.success)(message),
            ...args
        );
    }

    warn(message: string, ...args: any[]): void {
        if (!this.shouldLog(LogLevel.WARN)) return;
        console.warn(
            this.formatTimestamp(),
            this.formatPrefix(),
            chalk.bold.hex(this.colorScheme.warn)("⚠ WARN"),
            chalk.hex(this.colorScheme.warn)(message),
            ...args
        );
    }

    error(message: string, error?: Error, ...args: any[]): void {
        if (!this.shouldLog(LogLevel.ERROR)) return;
        console.error(
            this.formatTimestamp(),
            this.formatPrefix(),
            chalk.bold.hex(this.colorScheme.danger)("✕ ERROR"),
            chalk.hex(this.colorScheme.danger)(message),
            ...args
        );

        if (error && error.stack) {
            console.error(chalk.dim(error.stack));
        }
    }

    loader(message: string): (newMessage?: string) => void {
        const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
        let i = 0;

        const interval = setInterval(() => {
            process.stdout.write(
                `\r${this.formatTimestamp()} ${this.formatPrefix()} ${chalk.hex(this.colorScheme.warn)(frames[i])} ${message}`
            );
            i = (i + 1) % frames.length;
        }, 100);

        return (newMessage?: string) => {
            clearInterval(interval);
            process.stdout.write(
                `\r${this.formatTimestamp()} ${this.formatPrefix()} ${chalk.hex(this.colorScheme.success)("✓")} ${newMessage || message}\n`
            );
        };
    }

    table(title: string, data: Record<string, any>): void {
        console.log(this.formatTimestamp(), this.formatPrefix(), chalk.bold(title));

        Object.entries(data).forEach(([key, value]) => {
            const formattedKey = chalk.hex(this.colorScheme.warn)(`  ${key}`);
            const formattedValue = chalk.hex(this.colorScheme.muted)(value);
            console.log(`${formattedKey.padEnd(25)} ${formattedValue}`);
        });
    }

    section(title: string): void {
        const line = "─".repeat(Math.max(30, title.length + 4));
        console.log(chalk.hex(this.colorScheme.muted)(`\n┌─${line}─┐`));
        console.log(
            chalk.hex(this.colorScheme.muted)("│  ") +
                chalk.bold.hex(this.colorScheme.text)(title.padEnd(line.length)) +
                chalk.hex(this.colorScheme.muted)("  │")
        );
        console.log(chalk.hex(this.colorScheme.muted)(`└─${line}─┘`));
    }
}

// Export singleton instance
export const logger = new Logger();
