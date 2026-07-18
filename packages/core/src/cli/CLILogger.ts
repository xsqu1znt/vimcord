import type { Vimcord } from "@/client/Vimcord.js";
import type { LoaderHandle, LoaderMode } from "@/utils/Logger.js";

import ansis from "ansis";
import { Logger, stripAnsi } from "@/utils/Logger.js";

export interface CLITableColumn {
    /** Row property rendered in this column. */
    key: string;
    /** Column heading. */
    label: string;
    /** Cell alignment. @default "left" */
    align?: "left" | "right";
}

/** Stringifiable cells used by one CLI table row. */
export type CLITableRow = Readonly<Record<string, string | number | null | undefined>>;

/** Formats a concise human-readable target for CLI output. */
export function formatCLIClientTarget(client: Vimcord): string {
    return client.user ? `${client.$name} / ${client.user.tag}` : client.$name;
}

const DEFAULT_TABLE_WIDTH = 100;
const MAX_TABLE_WIDTH = 110;
const MIN_TABLE_COLUMN_WIDTH = 6;
const TABLE_COLUMN_GAP = 2;

function wrapTableCell(value: string, width: number): string[] {
    const lines: string[] = [];

    // Table values are normalized to visible text so ANSI sequences do not corrupt wrapping widths.
    for (const sourceLine of stripAnsi(value).split("\n")) {
        let remaining = sourceLine.trimEnd();
        if (!remaining) {
            lines.push("");
            continue;
        }

        while (remaining.length > width) {
            const candidate = remaining.slice(0, width + 1);
            const spaceIndex = candidate.lastIndexOf(" ");
            const breakIndex = spaceIndex > 0 ? spaceIndex : width;
            lines.push(remaining.slice(0, breakIndex).trimEnd());
            remaining = remaining.slice(breakIndex).trimStart();
        }
        lines.push(remaining);
    }

    return lines;
}

/** Dedicated CLI logger with target headers, groups, fields, tables, JSON, and command loaders. */
export class CLILogger extends Logger {
    constructor(loaders: LoaderMode = "auto") {
        super({ prefix: "CLI", loaders });
    }

    /** Shared styles for core and plugin-provided CLI commands. */
    readonly styles = {
        title: (value: string): string => ansis.bold.hex(this.options.colors.primary)(value),
        target: (value: string): string => ansis.hex(this.options.colors.info)(value),
        label: (value: string): string => ansis.hex(this.options.colors.muted)(value),
        muted: (value: string): string => ansis.dim(value),
        success: (value: string): string => ansis.hex(this.options.colors.success)(value),
        warn: (value: string): string => ansis.hex(this.options.colors.warn)(value),
        error: (value: string): string => ansis.hex(this.options.colors.error)(value),
        command: (value: string): string => ansis.yellow(value)
    };

    /** Writes a command result header and its resolved target. */
    header(title: string, client?: Vimcord | null): void {
        const target = client ? ` ${this.styles.muted("—")} ${this.styles.target(formatCLIClientTarget(client))}` : "";
        this.write("log", `${this.styles.title("[CLI]")} ${ansis.bold(title)}${target}`);
    }

    /** Writes one raw CLI output line. */
    line(value = ""): void {
        this.write("log", value);
    }

    /** Writes an indented group of related lines. */
    group(title: string, lines: readonly string[]): void {
        this.write("log", `${this.styles.label(title)}\n${lines.map(line => `  ${line}`).join("\n")}`);
    }

    /** Writes aligned label/value rows. */
    fields(fields: readonly (readonly [label: string, value: string | number])[]): void {
        if (!fields.length) return;

        const labelWidth = Math.max(...fields.map(([label]) => stripAnsi(label).length));
        const lines = fields.map(([label, value]) => `${this.styles.label(label.padEnd(labelWidth))}  ${String(value)}`);
        this.write("log", lines.join("\n"));
    }

    /** Writes an aligned table without relying on terminal-specific table rendering. */
    table(columns: readonly CLITableColumn[], rows: readonly CLITableRow[]): void {
        if (!columns.length) return;
        if (!rows.length) {
            this.write("log", this.styles.muted("No results"));
            return;
        }

        const values = rows.map(row => columns.map(column => String(row[column.key] ?? "")));
        const widths = columns.map((column, columnIndex) =>
            Math.max(stripAnsi(column.label).length, ...values.map(row => stripAnsi(row[columnIndex] ?? "").length))
        );
        const minimumWidths = widths.map((width, index) =>
            Math.min(width, Math.max(stripAnsi(columns[index]!.label).length, MIN_TABLE_COLUMN_WIDTH))
        );
        const terminalWidth = Math.max(20, Math.min(process.stdout.columns ?? DEFAULT_TABLE_WIDTH, MAX_TABLE_WIDTH));
        const gapWidth = TABLE_COLUMN_GAP * Math.max(0, columns.length - 1);

        // Reduce the widest flexible column first until the table fits the useful terminal width.
        while (widths.reduce((total, width) => total + width, gapWidth) > terminalWidth) {
            let columnIndex = -1;
            let availableReduction = 0;
            for (let index = 0; index < widths.length; index++) {
                const reduction = widths[index]! - minimumWidths[index]!;
                if (reduction > availableReduction) {
                    columnIndex = index;
                    availableReduction = reduction;
                }
            }
            if (columnIndex < 0) break;
            widths[columnIndex] = widths[columnIndex]! - 1;
        }

        const formatCell = (value: string, width: number, align: "left" | "right" = "left"): string => {
            const padding = " ".repeat(Math.max(0, width - stripAnsi(value).length));
            return align === "right" ? `${padding}${value}` : `${value}${padding}`;
        };
        const formatRow = (row: readonly string[]): string => {
            const cells = row.map((value, index) => wrapTableCell(value, widths[index]!));
            const lineCount = Math.max(...cells.map(cell => cell.length));

            return Array.from({ length: lineCount }, (_, lineIndex) =>
                cells
                    .map((cell, index) => formatCell(cell[lineIndex] ?? "", widths[index]!, columns[index]!.align))
                    .join("  ")
                    .trimEnd()
            ).join("\n");
        };

        const header = columns
            .map((column, index) => this.styles.label(formatCell(column.label, widths[index]!, column.align)))
            .join("  ");
        const divider = widths.map(width => this.styles.muted("─".repeat(width))).join("  ");
        const body = values.map(formatRow);

        this.write("log", [header, divider, ...body].join("\n"));
    }

    /** Writes serializable data for scripting-friendly command output. */
    json(value: unknown): void {
        this.write("log", JSON.stringify(value, null, 2));
    }

    /** Clears compatible local terminals and hosting dashboards. */
    clear(): void {
        this.write("log", "\x1Bc");
    }

    /** Starts a loader whose message consistently includes its client target. */
    commandLoader(action: string, client?: Vimcord | null): LoaderHandle {
        const target = client ? ` — ${formatCLIClientTarget(client)}` : "";
        const withTarget = (message: string): string => `${message}${target}`;
        const loader = this.loader(withTarget(action));

        // Preserve the target when commands replace the loader message during progress or completion.
        return {
            update: message => loader.update(withTarget(message)),
            stop: finalMessage => loader.stop(finalMessage === undefined ? undefined : withTarget(finalMessage)),
            succeed: finalMessage => loader.succeed(finalMessage === undefined ? undefined : withTarget(finalMessage)),
            fail: (finalMessage, error) => loader.fail(withTarget(finalMessage), error)
        };
    }

    /** Writes a concise command failure using the original error message. */
    failure(title: string, client: Vimcord | null, error: unknown): void {
        this.header(title, client);
        const message = error instanceof Error ? error.message : String(error);
        this.write("error", this.styles.error(`✕ ${message}`));
    }
}
