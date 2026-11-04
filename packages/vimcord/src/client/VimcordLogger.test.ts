import type { VimcordCommandLogData } from "./VimcordLogger.js";

import ansis from "ansis";
import { describe, expect, it } from "vitest";
import { stripAnsi } from "@/utils/Logger.js";
import { VimcordLogger } from "./VimcordLogger.js";

class CapturedLogger extends VimcordLogger {
    readonly entries: unknown[][] = [];

    protected override write(stream: "log" | "warn" | "error", ...data: unknown[]): void {
        this.entries.push([stream, ...data]);
    }
}

const ENTRY: VimcordCommandLogData = { commandName: "balance", userName: "maya", guildName: "Workshop" };

function text(entry: unknown[]) {
    return entry.slice(3).map(p => stripAnsi(String(p)));
}

describe("command usage formatting", () => {
    it("preserves timing order, duplicates, unavailable timings, and failure labels", () => {
        const logger = new CapturedLogger();
        logger.commandUsed({
            ...ENTRY,
            guildId: "unused",
            failed: true,
            timings: [
                { timing: "total", durationMs: 45 },
                { timing: "execute", durationMs: 30 },
                { timing: "delivery" },
                { timing: "total", durationMs: 45 }
            ]
        });
        expect(text(logger.entries[0]!)).toEqual([
            "COMMAND",
            "/balance",
            "used by maya",
            "in Workshop",
            "| total 45.0ms",
            "| exec 30.0ms",
            "| delivery n/a",
            "| total 45.0ms",
            "| failed"
        ]);
    });

    it("keeps legacy durations, empty selections, and unknown guild output", () => {
        const logger = new CapturedLogger();
        logger.commandUsed({ ...ENTRY, guildName: undefined, durationMs: 1.25 });
        logger.commandUsed({ ...ENTRY, durationMs: 5, timings: [] });
        expect(text(logger.entries[0]!)).toEqual(["COMMAND", "/balance", "used by maya", "in Unknown Guild", "| 1.3ms"]);
        expect(text(logger.entries[1]!)).toEqual(["COMMAND", "/balance", "used by maya", "in Workshop"]);
    });

    it("refreshes cached styles when colors change and keeps each entry's values independent", () => {
        const logger = new CapturedLogger({ colors: { muted: "#FF0000", error: "#0000FF" } });
        logger.commandUsed({ ...ENTRY, failed: true });
        logger.options.colors.muted = "#00FF00";
        logger.options.colors.error = "#FF00FF";
        logger.commandUsed({ commandName: "ping", userName: "sam", failed: true });
        expect(logger.entries[0]![3]).toBe(ansis.hex("#FF0000")("COMMAND"));
        expect(logger.entries[0]!.at(-1)).toBe(ansis.hex("#0000FF")("| failed"));
        expect(logger.entries[1]![3]).toBe(ansis.hex("#00FF00")("COMMAND"));
        expect(logger.entries[1]!.at(-1)).toBe(ansis.hex("#FF00FF")("| failed"));
        expect(text(logger.entries[1]!).slice(0, 4)).toEqual(["COMMAND", "/ping", "used by sam", "in Unknown Guild"]);
    });
});
